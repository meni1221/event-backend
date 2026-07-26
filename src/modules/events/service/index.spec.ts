import { NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { UpdateEventDto } from '../dto/update-event';
import { EventDocument } from '../schemas';
import { EventsService } from '.';

const createLeanQuery = (result: unknown) => ({
  lean: jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue(result),
  }),
});

describe('EventsService tenant isolation', () => {
  const hostId = new Types.ObjectId().toHexString();
  const eventId = new Types.ObjectId().toHexString();
  const find = jest.fn();
  const findOneAndDelete = jest.fn();
  const findOneAndUpdate = jest.fn();
  const eventModel = {
    find,
    findOneAndDelete,
    findOneAndUpdate,
  } as unknown as Model<EventDocument>;
  const service = new EventsService(eventModel);

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
    findOneAndDelete.mockReturnValue(createLeanQuery({ _id: eventId }));

    await service.remove(hostId, eventId);

    const filter = findOneAndDelete.mock.calls[0][0] as { _id: string; hostId: Types.ObjectId };
    expect(filter._id).toBe(eventId);
    expect(filter.hostId.toHexString()).toBe(hostId);
  });

  it('does not reveal an event that is outside the host scope', async () => {
    findOneAndUpdate.mockReturnValue(createLeanQuery(null));

    await expect(service.update(hostId, eventId, { eventName: 'Updated event' } as UpdateEventDto))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
