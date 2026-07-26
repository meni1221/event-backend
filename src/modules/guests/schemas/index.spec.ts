import { GuestSchema } from '.';

jest.mock('nanoid', () => ({ nanoid: () => 'test-invite-id' }));

describe('GuestSchema indexes', () => {
  it('keeps invite ids globally unique for deterministic public links', () => {
    const inviteIndex = GuestSchema.indexes().find(([fields]) => fields.inviteId === 1);

    expect(inviteIndex).toBeDefined();
    expect(inviteIndex?.[0]).toEqual({ inviteId: 1 });
    expect(inviteIndex?.[1]).toMatchObject({ unique: true });
  });

  it('prevents duplicate phone numbers inside the same event', () => {
    const phoneIndex = GuestSchema.indexes().find(([fields]) => fields.eventId === 1 && fields.phoneNumber === 1);

    expect(phoneIndex?.[1]).toMatchObject({ unique: true });
  });
});
