import { Types } from 'mongoose';
import { toPublicInvite } from '.';

describe('toPublicInvite', () => {
  it('returns only fields required by the public invitation experience', () => {
    const eventId = new Types.ObjectId();
    const result = toPublicInvite({
      _id: eventId,
      hostId: new Types.ObjectId(),
      eventName: 'Public event',
      eventDate: new Date('2026-08-01T18:00:00.000Z'),
      venueName: 'Venue',
      address: 'Public address',
      adminPhoneNumber: '0501234567',
      googleCalendarEventId: 'private-google-id',
      theme: 'wedding',
      seatingMode: 'mixed',
      invitationTemplateKey: 'classic',
    } as Parameters<typeof toPublicInvite>[0], {
      _id: new Types.ObjectId(),
      eventId,
      inviteId: 'invite-123',
      fullName: 'Guest Name',
      phoneNumber: '0507654321',
      email: 'guest@example.com',
      language: 'he',
      maxAllowed: 2,
      status: 'pending',
      rsvpDetails: { adults: 0, children: 0 },
      journey: [{ event: 'private-audit-entry', timestamp: new Date(), meta: {} }],
    } as Parameters<typeof toPublicInvite>[1]);

    expect(result.event).toEqual({
      _id: eventId,
      adminPhoneNumber: '0501234567',
      address: 'Public address',
      bitLink: undefined,
      eventDate: new Date('2026-08-01T18:00:00.000Z'),
      eventName: 'Public event',
      invitationMessage: undefined,
      invitationTemplateKey: 'classic',
      invitationTitle: undefined,
      theme: 'wedding',
      venueName: 'Venue',
      wazeLink: undefined,
    });
    expect(result.event).not.toHaveProperty('hostId');
    expect(result.event).not.toHaveProperty('googleCalendarEventId');
    expect(result.guest).not.toHaveProperty('phoneNumber');
    expect(result.guest).not.toHaveProperty('email');
    expect(result.guest).not.toHaveProperty('journey');
  });
});
