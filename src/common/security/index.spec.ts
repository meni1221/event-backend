import { getPositiveInteger, routeRateLimits } from '.';

describe('security configuration', () => {
  describe('getPositiveInteger', () => {
    it('returns a configured positive integer', () => {
      expect(getPositiveInteger('250', 100)).toBe(250);
    });

    it.each([undefined, '', '0', '-1', '2.5', 'invalid'])(
      'returns the fallback for invalid input: %s',
      (value) => {
        expect(getPositiveInteger(value, 100)).toBe(100);
      },
    );
  });

  it('keeps sensitive routes stricter than the global API limit', () => {
    expect(routeRateLimits.auth.login.default.limit).toBeLessThan(120);
    expect(routeRateLimits.auth.forgotPassword.default.limit).toBeLessThan(120);
    expect(routeRateLimits.invitations.rsvp.default.limit).toBeLessThan(120);
    expect(routeRateLimits.mail.sendBatch.default.limit).toBeLessThan(120);
    expect(routeRateLimits.whatsapp.sendBatch.default.limit).toBeLessThan(120);
  });
});
