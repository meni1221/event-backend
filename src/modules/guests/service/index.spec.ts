import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { EventDocument } from '../../events/schemas';
import { GuestDocument, GuestStatus } from '../schemas';
import { GuestsService } from '.';

jest.mock('nanoid', () => ({ nanoid: () => 'test-invite-id' }));

const createLeanQuery = (result: unknown) => ({
  lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(result) }),
});

const createSelectQuery = (result: unknown) => ({
  select: jest.fn().mockReturnValue(createLeanQuery(result)),
});

describe('GuestsService critical paths', () => {
  const hostId = new Types.ObjectId().toHexString();
  const eventId = new Types.ObjectId().toHexString();
  const eventFindOne = jest.fn();
  const eventModel = { findOne: eventFindOne } as unknown as Model<EventDocument>;
  const createGuest = jest.fn();
  const guestFindOne = jest.fn();
  const guestFindOneAndUpdate = jest.fn();
  const guestModel = {
    create: createGuest,
    findOne: guestFindOne,
    findOneAndUpdate: guestFindOneAndUpdate,
  } as unknown as Model<GuestDocument>;
  const service = new GuestsService(eventModel, guestModel);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not add a guest when the event is outside the host scope', async () => {
    eventFindOne.mockReturnValue(createSelectQuery(null));

    await expect(service.createForEvent(hostId, eventId, {
      fullName: 'Guest Name',
      phoneNumber: '0501234567',
    })).rejects.toBeInstanceOf(NotFoundException);

    const filter = eventFindOne.mock.calls[0][0] as { _id: string; hostId: Types.ObjectId };
    expect(filter._id).toBe(eventId);
    expect(filter.hostId.toHexString()).toBe(hostId);
    expect(createGuest).not.toHaveBeenCalled();
  });

  it('binds a new guest to the owned event', async () => {
    eventFindOne.mockReturnValue(createSelectQuery({ _id: new Types.ObjectId(eventId) }));
    createGuest.mockResolvedValue({ _id: new Types.ObjectId() });

    await service.createForEvent(hostId, eventId, {
      fullName: 'Guest Name',
      phoneNumber: '0501234567',
      maxAllowed: 2,
    });

    const payload = createGuest.mock.calls[0][0] as { eventId: Types.ObjectId; maxAllowed: number };
    expect(payload.eventId.toHexString()).toBe(eventId);
    expect(payload.maxAllowed).toBe(2);
  });

  it('rejects an RSVP that exceeds the invitation limit before updating', async () => {
    guestFindOne.mockReturnValue(createSelectQuery({ maxAllowed: 2 }));

    await expect(service.updateRsvp('invite-123', {
      status: GuestStatus.CONFIRMED,
      adults: 2,
      children: 1,
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(guestFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('stores zero attendees when an invitation is declined', async () => {
    guestFindOne.mockReturnValue(createSelectQuery({ maxAllowed: 4 }));
    guestFindOneAndUpdate.mockReturnValue(createLeanQuery({
      inviteId: 'invite-123',
      fullName: 'Guest Name',
      status: GuestStatus.DECLINED,
      rsvpDetails: { adults: 0, children: 0 },
    }));

    await service.updateRsvp('invite-123', {
      status: GuestStatus.DECLINED,
      adults: 3,
      children: 1,
    });

    const update = guestFindOneAndUpdate.mock.calls[0][1] as {
      rsvpDetails: { adults: number; children: number };
      status: GuestStatus;
    };
    expect(update.status).toBe(GuestStatus.DECLINED);
    expect(update.rsvpDetails).toMatchObject({ adults: 0, children: 0 });
  });
});
