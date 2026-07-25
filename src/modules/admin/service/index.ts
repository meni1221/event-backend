import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Model } from 'mongoose';
import { toObjectId } from '../../../common/mongo';
import { EventOverviewRecord, toOwnerEvent } from '../../events/mappers';
import { Event, EventDocument } from '../../events/schemas';
import { Guest, GuestDocument } from '../../guests/schemas';
import { AppLoggerService } from '../../logs/service';
import { LogLevel, LogSource } from '../../logs/schemas';
import { MailService } from '../../mail/service';
import { ChangePasswordDto, UpdateAdminOnboardingDto, UpdateAdminProfileDto } from '../dto';
import { isOwnerEmail, normalizeAdminPhone } from '../helpers';
import { AdminOverviewRecord, toAdminProfile, toApprovedOwnerUser, toOwnerUser } from '../mappers';
import { Admin, AdminAccountStatus, AdminDocument, AdminRole } from '../schemas';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Admin.name) private readonly adminModel: Model<AdminDocument>,
    @InjectModel(Event.name) private readonly eventModel: Model<EventDocument>,
    @InjectModel(Guest.name) private readonly guestModel: Model<GuestDocument>,
    private readonly config: ConfigService,
    private readonly mailService: MailService,
    private readonly logger: AppLoggerService,
  ) {}

  async deleteHostData(hostId: string) {
    const hostObjectId = toObjectId(hostId, 'host id');
    const eventIds = await this.eventModel.find({ hostId: hostObjectId }).distinct('_id').exec();
    const guestDeleteResult = eventIds.length
      ? await this.guestModel.deleteMany({ eventId: { $in: eventIds } }).exec()
      : { deletedCount: 0 };
    const eventDeleteResult = await this.eventModel.deleteMany({ hostId: hostObjectId }).exec();
    const adminDeleteResult = await this.adminModel.deleteOne({ _id: hostObjectId }).exec();

    if (!adminDeleteResult.deletedCount) {
      throw new NotFoundException('Host was not found');
    }

    void this.logger.write({
      category: 'admin.delete_data',
      hostId,
      level: LogLevel.WARN,
      message: 'Host data was deleted',
      meta: {
        deletedAdmin: adminDeleteResult.deletedCount,
        deletedEvents: eventDeleteResult.deletedCount ?? 0,
        deletedGuests: guestDeleteResult.deletedCount ?? 0,
      },
      source: LogSource.BACKEND,
    });

    return {
      deletedAdmin: adminDeleteResult.deletedCount,
      deletedEvents: eventDeleteResult.deletedCount ?? 0,
      deletedGuests: guestDeleteResult.deletedCount ?? 0,
    };
  }

  async getCurrentProfile(hostId: string) {
    toObjectId(hostId, 'host id');

    const admin = await this.adminModel
      .findById(hostId)
      .select('email fullName phoneNumber profileCompleted onboardingCompleted onboardingSkipped role accountStatus')
      .lean<AdminOverviewRecord>()
      .exec();

    if (!admin) {
      throw new NotFoundException('Admin was not found');
    }

    void this.logger.write({
      category: 'admin.profile.updated',
      hostId,
      level: LogLevel.INFO,
      message: 'Admin profile updated',
      source: LogSource.BACKEND,
      userEmail: admin.email,
    });

    return toAdminProfile(admin);
  }

  async updateCurrentProfile(hostId: string, dto: UpdateAdminProfileDto) {
    const hostObjectId = toObjectId(hostId, 'host id');

    const normalizedEmail = dto.email.trim().toLowerCase();
    const currentAdmin = await this.adminModel.findById(hostObjectId).select('role').lean<{ role: AdminRole }>().exec();
    if (!currentAdmin) {
      throw new NotFoundException('Admin was not found');
    }

    if (currentAdmin.role !== AdminRole.OWNER && isOwnerEmail(this.config, normalizedEmail)) {
      throw new ForbiddenException('This email address is reserved for an owner account');
    }

    const existingAdmin = await this.adminModel
      .findOne({ email: normalizedEmail, _id: { $ne: hostObjectId } })
      .select('_id')
      .lean()
      .exec();

    if (existingAdmin) {
      throw new ConflictException('Email is already used by another admin');
    }

    const fullName = dto.fullName.trim();
    const phoneNumber = normalizeAdminPhone(dto.phoneNumber);
    const admin = await this.adminModel
      .findByIdAndUpdate(
        hostId,
        {
          email: normalizedEmail,
          fullName,
          phoneNumber,
          profileCompleted: Boolean(fullName && phoneNumber),
        },
        { new: true },
      )
      .select('email fullName phoneNumber profileCompleted onboardingCompleted onboardingSkipped role accountStatus')
      .lean<AdminOverviewRecord>()
      .exec();

    if (!admin) {
      throw new NotFoundException('Admin was not found');
    }

    return toAdminProfile(admin);
  }

  async updateCurrentOnboarding(hostId: string, dto: UpdateAdminOnboardingDto) {
    toObjectId(hostId, 'host id');

    const completed = dto.completed ?? false;
    const skipped = completed ? false : dto.skipped ?? false;
    const admin = await this.adminModel
      .findByIdAndUpdate(
        hostId,
        {
          onboardingCompleted: completed,
          onboardingSkipped: skipped,
        },
        { new: true },
      )
      .select('email fullName phoneNumber profileCompleted onboardingCompleted onboardingSkipped role accountStatus')
      .lean<AdminOverviewRecord>()
      .exec();

    if (!admin) {
      throw new NotFoundException('Admin was not found');
    }

    void this.logger.write({
      category: 'admin.onboarding.updated',
      hostId,
      level: LogLevel.INFO,
      message: 'Admin onboarding status updated',
      meta: { completed, skipped },
      source: LogSource.BACKEND,
      userEmail: admin.email,
    });

    return toAdminProfile(admin);
  }

  async changeCurrentPassword(hostId: string, dto: ChangePasswordDto) {
    toObjectId(hostId, 'host id');

    const admin = await this.adminModel.findById(hostId).select('+passwordHash +sessionVersion email').exec();
    const isCurrentPasswordValid = admin ? await bcrypt.compare(dto.currentPassword, admin.passwordHash) : false;

    if (!admin || !isCurrentPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    admin.passwordHash = await bcrypt.hash(dto.newPassword, 12);
    admin.sessionVersion = (admin.sessionVersion ?? 0) + 1;
    await admin.save();

    void this.logger.write({
      category: 'admin.password.changed',
      hostId,
      level: LogLevel.INFO,
      message: 'Admin password was changed from profile settings',
      source: LogSource.BACKEND,
      userEmail: admin.email,
    });

    return { ok: true };
  }

  async getOwnerOverview() {
    const admins = await this.adminModel
      .find()
      .select('email fullName phoneNumber profileCompleted role accountStatus whatsappStatus createdAt updatedAt')
      .sort({ createdAt: -1 })
      .lean<AdminOverviewRecord[]>()
      .exec();
    const events = await this.eventModel
      .find()
      .select('hostId eventName eventDate venueName theme createdAt')
      .sort({ eventDate: -1, createdAt: -1 })
      .lean<EventOverviewRecord[]>()
      .exec();
    const guestCounts = await this.guestModel.aggregate<{ _id: string; totalGuests: number }>([
      { $group: { _id: '$eventId', totalGuests: { $sum: 1 } } },
    ]);
    const guestCountByEventId = new Map(guestCounts.map((entry) => [String(entry._id), entry.totalGuests]));

    return {
      users: admins.map(toOwnerUser),
      events: events.map((event) => toOwnerEvent(event, guestCountByEventId.get(String(event._id)) ?? 0)),
    };
  }

  async approveHost(adminId: string) {
    toObjectId(adminId, 'admin id');

    const admin = await this.adminModel
      .findByIdAndUpdate(
        adminId,
        { accountStatus: AdminAccountStatus.APPROVED },
        { new: true },
      )
      .select('email fullName phoneNumber profileCompleted role accountStatus whatsappStatus updatedAt')
      .lean<AdminOverviewRecord>()
      .exec();

    if (!admin) {
      throw new NotFoundException('Admin was not found');
    }

    try {
      await this.mailService.sendAdminApproved(admin.email);
    } catch (cause) {
      void this.logger.write({
        category: 'admin.approved.email_failed',
        hostId: String(admin._id),
        level: LogLevel.WARN,
        message: 'Failed to send admin approved email',
        meta: { cause: cause instanceof Error ? cause.message : 'unknown' },
        source: LogSource.BACKEND,
        userEmail: admin.email,
      });
    }
    void this.logger.write({
      category: 'admin.approved',
      hostId: String(admin._id),
      level: LogLevel.INFO,
      message: 'Host admin was approved by owner',
      source: LogSource.BACKEND,
      userEmail: admin.email,
    });

    return toApprovedOwnerUser(admin);
  }

}
