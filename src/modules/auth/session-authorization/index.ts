import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Admin, AdminAccountStatus, AdminDocument, AdminRole } from '../../admin/schemas';

export type AuthorizedSessionUser = {
  email: string;
  hostId: string;
  role: AdminRole;
};

type SessionJwtPayload = {
  sessionVersion: number;
  sub: string;
};

type SessionAdmin = {
  _id: unknown;
  accountStatus: AdminAccountStatus;
  email: string;
  role: AdminRole;
  sessionVersion?: number;
};

@Injectable()
export class SessionAuthorizationService {
  constructor(
    @InjectModel(Admin.name) private readonly adminModel: Model<AdminDocument>,
    private readonly jwt: JwtService,
  ) {}

  async authorize(token: string): Promise<AuthorizedSessionUser> {
    try {
      const payload = await this.jwt.verifyAsync<SessionJwtPayload>(token, { algorithms: ['HS256'] });
      if (!payload.sub || !Number.isInteger(payload.sessionVersion)) {
        throw new Error('Invalid session payload');
      }

      const admin = await this.adminModel
        .findById(payload.sub)
        .select('+sessionVersion email role accountStatus')
        .lean<SessionAdmin>()
        .exec();

      if (
        !admin
        || admin.accountStatus !== AdminAccountStatus.APPROVED
        || (admin.sessionVersion ?? 0) !== payload.sessionVersion
      ) {
        throw new Error('Session is no longer authorized');
      }

      return {
        email: admin.email,
        hostId: String(admin._id),
        role: admin.role,
      };
    } catch {
      throw new UnauthorizedException('Invalid, expired, or revoked authorization token');
    }
  }
}
