import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { EventDocument } from '../../events/schemas';
import type { GuestDocument } from '../../guests/schemas';
import { AppLoggerService } from '../../logs/service';
import { MailService } from '../../mail/service';
import { AdminAccountStatus, AdminDocument, AdminRole, WhatsappStatus } from '../schemas';
import { AdminService } from '.';

jest.mock('nanoid', () => ({ nanoid: () => 'test-invite-id' }));

const createLeanQuery = (result: unknown) => ({
  lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(result) }),
});

const createSelectQuery = (result: unknown) => ({
  select: jest.fn().mockReturnValue(createLeanQuery(result)),
});

describe('AdminService account lifecycle', () => {
  const adminId = new Types.ObjectId();
  const findById = jest.fn();
  const findByIdAndUpdate = jest.fn();
  const adminModel = { findById, findByIdAndUpdate } as unknown as Model<AdminDocument>;
  const logger = { write: jest.fn() } as unknown as AppLoggerService;
  const service = new AdminService(
    adminModel,
    {} as Model<EventDocument>,
    {} as Model<GuestDocument>,
    {} as ConfigService,
    {} as MailService,
    logger,
  );

  const hostRecord = (accountStatus: AdminAccountStatus) => ({
    _id: adminId,
    email: 'host@example.com',
    fullName: 'Host Name',
    phoneNumber: '0501234567',
    profileCompleted: true,
    role: AdminRole.HOST,
    accountStatus,
    whatsappStatus: WhatsappStatus.DISCONNECTED,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('suspends a host and revokes existing sessions atomically', async () => {
    findById.mockReturnValue(createSelectQuery({ role: AdminRole.HOST }));
    findByIdAndUpdate.mockReturnValue(createSelectQuery(hostRecord(AdminAccountStatus.SUSPENDED)));

    const result = await service.suspendHost(adminId.toHexString());

    expect(findByIdAndUpdate).toHaveBeenCalledWith(
      adminId,
      {
        $set: { accountStatus: AdminAccountStatus.SUSPENDED },
        $inc: { sessionVersion: 1 },
      },
      { new: true },
    );
    expect(result.accountStatus).toBe(AdminAccountStatus.SUSPENDED);
  });

  it('restores a host with a new session version', async () => {
    findById.mockReturnValue(createSelectQuery({ role: AdminRole.HOST }));
    findByIdAndUpdate.mockReturnValue(createSelectQuery(hostRecord(AdminAccountStatus.APPROVED)));

    const result = await service.restoreHost(adminId.toHexString());

    const update = findByIdAndUpdate.mock.calls[0][1] as {
      $inc: { sessionVersion: number };
      $set: { accountStatus: AdminAccountStatus };
    };
    expect(update.$set.accountStatus).toBe(AdminAccountStatus.APPROVED);
    expect(update.$inc.sessionVersion).toBe(1);
    expect(result.accountStatus).toBe(AdminAccountStatus.APPROVED);
  });

  it('does not allow lifecycle actions on owner accounts', async () => {
    findById.mockReturnValue(createSelectQuery({ role: AdminRole.OWNER }));

    await expect(service.suspendHost(adminId.toHexString())).rejects.toBeInstanceOf(ForbiddenException);
    expect(findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('returns not found without issuing an update for a missing account', async () => {
    findById.mockReturnValue(createSelectQuery(null));

    await expect(service.restoreHost(adminId.toHexString())).rejects.toBeInstanceOf(NotFoundException);
    expect(findByIdAndUpdate).not.toHaveBeenCalled();
  });
});
