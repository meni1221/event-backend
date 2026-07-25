import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import { Admin, AdminAccountStatus, AdminDocument, AdminRole } from '../../admin/schemas';
import { SessionAuthorizationService } from '.';

describe('SessionAuthorizationService', () => {
  const exec = jest.fn();
  const lean = jest.fn(() => ({ exec }));
  const select = jest.fn(() => ({ lean }));
  const findById = jest.fn(() => ({ select }));
  const adminModel = { findById } as unknown as Model<AdminDocument>;
  const verifyAsync = jest.fn();
  const jwt = { verifyAsync } as unknown as JwtService;
  const service = new SessionAuthorizationService(adminModel, jwt);

  beforeEach(() => {
    jest.clearAllMocks();
    verifyAsync.mockResolvedValue({ sessionVersion: 2, sub: 'admin-1' });
    exec.mockResolvedValue({
      _id: 'admin-1',
      accountStatus: AdminAccountStatus.APPROVED,
      email: 'current@example.com',
      role: AdminRole.HOST,
      sessionVersion: 2,
    } satisfies Partial<Admin> & { _id: string });
  });

  it('returns the current database identity for an approved session', async () => {
    await expect(service.authorize('valid-token')).resolves.toEqual({
      email: 'current@example.com',
      hostId: 'admin-1',
      role: AdminRole.HOST,
    });
    expect(findById).toHaveBeenCalledWith('admin-1');
  });

  it.each([AdminAccountStatus.PENDING_APPROVAL, AdminAccountStatus.SUSPENDED])(
    'rejects an account with status %s',
    async (accountStatus) => {
      exec.mockResolvedValue({
        _id: 'admin-1',
        accountStatus,
        email: 'blocked@example.com',
        role: AdminRole.HOST,
        sessionVersion: 2,
      });

      await expect(service.authorize('blocked-token')).rejects.toThrow(
        'Invalid, expired, or revoked authorization token',
      );
    },
  );

  it('rejects a token issued before the current session version', async () => {
    exec.mockResolvedValue({
      _id: 'admin-1',
      accountStatus: AdminAccountStatus.APPROVED,
      email: 'current@example.com',
      role: AdminRole.HOST,
      sessionVersion: 3,
    });

    await expect(service.authorize('revoked-token')).rejects.toThrow(
      'Invalid, expired, or revoked authorization token',
    );
  });

  it('rejects legacy tokens without a session version', async () => {
    verifyAsync.mockResolvedValue({ sub: 'admin-1' });

    await expect(service.authorize('legacy-token')).rejects.toThrow(
      'Invalid, expired, or revoked authorization token',
    );
  });
});
