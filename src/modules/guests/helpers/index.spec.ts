import { Types } from 'mongoose';
import { getInviteFilter } from '.';

describe('getInviteFilter', () => {
  it('uses the globally unique invite id for legacy links', () => {
    expect(getInviteFilter('invite-123')).toEqual({ inviteId: 'invite-123' });
  });

  it('scopes modern invite links to their event', () => {
    const eventId = new Types.ObjectId();
    const filter = getInviteFilter('invite-123', eventId.toHexString());

    expect(filter).toEqual({ eventId, inviteId: 'invite-123' });
  });

  it('never matches when the event id is invalid', () => {
    expect(getInviteFilter('invite-123', 'not-an-object-id')).toEqual({ inviteId: '__invalid__' });
  });
});
