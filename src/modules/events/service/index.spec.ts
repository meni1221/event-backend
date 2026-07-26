import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import type { GuestDocument } from '../../guests/schemas';
import { UpdateEventDto } from '../dto/update-event';
import { EventDocument } from '../schemas';
import { EventsService } from '.';

jest.mock('nanoid', () => ({ nanoid: () => 'test-invite-id' }));

const createLeanQuery = (result: unknown) => ({
  lean: jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue(result),
  }),
});

const createSelectQuery = (result: unknown) => ({
  select: jest.fn().mockReturnValue(createLeanQuery(result)),
});

describe('EventsService tenant isolation', () => {
  const hostId = new Types.ObjectId().toHexString();
  const eventId = new Types.ObjectId().toHexString();
  const find = jest.fn();
  const findOne = jest.fn();
  const findOneAndDelete = jest.fn();
  const findOneAndUpdate = jest.fn();
  const eventModel = {
    find,
    findOne,
    findOneAndDelete,
    findOneAndUpdate,
  } as unknown as Model<EventDocument>;
  const deleteMany = jest.fn();
  const guestFind = jest.fn();
  const guestModel = { deleteMany, find: guestFind } as unknown as Model<GuestDocument>;
  const service = new EventsService(eventModel, guestModel);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists only events owned by the current host', async () => {
    const query = createLeanQuery([]);
    find.mockReturnValue({
      sort: jest.fn().mockReturnValue(query),
    });

    await service.findAll(hostId);

    const filter = find.mock.calls[0][0] as { hostId: Types.ObjectId };
    expect(filter.hostId.toHexString()).toBe(hostId);
  });

  it('requires host ownership when updating an event', async () => {
    findOneAndUpdate.mockReturnValue(createLeanQuery({ _id: eventId }));

    await service.update(hostId, eventId, { eventName: 'Updated event' } as UpdateEventDto);

    const filter = findOneAndUpdate.mock.calls[0][0] as { _id: string; hostId: Types.ObjectId };
    expect(filter._id).toBe(eventId);
    expect(filter.hostId.toHexString()).toBe(hostId);
  });

  it('requires host ownership when deleting an event', async () => {
    const ownedEventId = new Types.ObjectId(eventId);
    findOne.mockReturnValue(createSelectQuery({ _id: ownedEventId }));
    const deleteGuests = jest.fn().mockResolvedValue({ deletedCount: 2 });
    deleteMany.mockReturnValue({ exec: deleteGuests });
    findOneAndDelete.mockReturnValue(createLeanQuery({ _id: eventId }));

    await service.remove(hostId, eventId);

    const ownershipFilter = findOne.mock.calls[0][0] as { _id: string; hostId: Types.ObjectId };
    expect(ownershipFilter._id).toBe(eventId);
    expect(ownershipFilter.hostId.toHexString()).toBe(hostId);
    expect(deleteMany).toHaveBeenCalledWith({ eventId: ownedEventId });
    const filter = findOneAndDelete.mock.calls[0][0] as { _id: string; hostId: Types.ObjectId };
    expect(filter._id).toBe(eventId);
    expect(filter.hostId.toHexString()).toBe(hostId);
    expect(deleteMany.mock.invocationCallOrder[0]).toBeLessThan(findOneAndDelete.mock.invocationCallOrder[0]);
  });

  it('does not delete guests when the event is outside the host scope', async () => {
    findOne.mockReturnValue(createSelectQuery(null));

    await expect(service.remove(hostId, eventId)).rejects.toBeInstanceOf(NotFoundException);

    expect(deleteMany).not.toHaveBeenCalled();
    expect(findOneAndDelete).not.toHaveBeenCalled();
  });

  it('does not reveal an event that is outside the host scope', async () => {
    findOneAndUpdate.mockReturnValue(createLeanQuery(null));

    await expect(service.update(hostId, eventId, { eventName: 'Updated event' } as UpdateEventDto))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects duplicate guest assignments before persisting seating', async () => {
    findOne.mockReturnValue(createSelectQuery({ _id: new Types.ObjectId(eventId) }));

    await expect(service.updateSeating(hostId, eventId, {
      tables: [
        { id: 'table_1', name: 'One', zone: 'A', capacity: 10, guestIds: [hostId] },
        { id: 'table_2', name: 'Two', zone: 'B', capacity: 10, guestIds: [hostId] },
      ],
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(guestFind).not.toHaveBeenCalled();
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a table whose assigned parties exceed capacity', async () => {
    const guestId = new Types.ObjectId();
    findOne.mockReturnValue(createSelectQuery({ _id: new Types.ObjectId(eventId) }));
    guestFind.mockReturnValue(createSelectQuery([{
      _id: guestId,
      rsvpDetails: { adults: 2, children: 1 },
    }]));

    await expect(service.updateSeating(hostId, eventId, {
      tables: [{ id: 'table_1', name: 'One', zone: 'A', capacity: 2, guestIds: [guestId.toHexString()] }],
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });
});
