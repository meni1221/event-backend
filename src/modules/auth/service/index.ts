import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { Model } from 'mongoose';
import { isOwnerEmail } from '../../admin/helpers';
import { Admin, AdminAccountStatus, AdminDocument, AdminRole } from '../../admin/schemas';
import { AppLoggerService } from '../../logs/service';
import { LogLevel, LogSource } from '../../logs/schemas';
import { MailService } from '../../mail/service';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from '../dto';
import { hashResetToken, isDuplicateMongoKeyError, normalizeEmail } from '../helpers';
import { toAuthSession } from '../mappers';

type GoogleLoginState = {
  nonce: string;
  purpose: 'google_login';
};

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(Admin.name) private readonly adminModel: Model<AdminDocument>,
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly logger: AppLoggerService,
  ) {}

  async register(dto: RegisterDto) {
    const normalizedEmail = normalizeEmail(dto.email);
    const existingAdmin = await this.adminModel.findOne({ email: normalizedEmail }).select('_id').lean().exec();

    if (existingAdmin) {
      throw new ConflictException('Email is already used by another admin');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const role = isOwnerEmail(this.config, normalizedEmail) ? AdminRole.OWNER : AdminRole.HOST;
    const accountStatus = role === AdminRole.OWNER ? AdminAccountStatus.APPROVED : AdminAccountStatus.PENDING_APPROVAL;
    const admin = await this.createAdminAccount({
      accountStatus,
      email: normalizedEmail,
      passwordHash,
      role,
    });

    if (role === AdminRole.OWNER) {
      void this.logger.write({
        category: 'auth.register.owner',
        hostId: admin.id,
        level: LogLevel.INFO,
        message: 'Super admin account registered',
        source: LogSource.BACKEND,
        userEmail: admin.email,
      });
      return this.createSession(admin.id, admin.email, admin.role, admin);
    }

    try {
      await this.mailService.sendAdminApprovalRequest(admin.email);
    } catch (cause) {
      void this.logger.write({
        category: 'auth.register.approval_email_failed',
        hostId: admin.id,
        level: LogLevel.WARN,
        message: 'Failed to send admin approval request email',
        meta: { cause: cause instanceof Error ? cause.message : 'unknown' },
        source: LogSource.BACKEND,
        userEmail: admin.email,
      });
    }
    void this.logger.write({
      category: 'auth.register.pending_approval',
      hostId: admin.id,
      level: LogLevel.INFO,
      message: 'Host admin registered and is pending approval',
      source: LogSource.BACKEND,
      userEmail: admin.email,
    });

    return {
      pendingApproval: true,
      email: admin.email,
    };
  }

  async login(dto: LoginDto) {
    const normalizedEmail = normalizeEmail(dto.email);
    const admin = await this.adminModel
      .findOne({ email: normalizedEmail })
      .select('+passwordHash email fullName phoneNumber profileCompleted onboardingCompleted onboardingSkipped role accountStatus')
      .exec();
    const isValid = admin ? await bcrypt.compare(dto.password, admin.passwordHash) : false;

    if (!admin || !isValid) {
      void this.logger.write({
        category: 'auth.login.failed',
        level: LogLevel.WARN,
        message: 'Admin login failed',
        meta: { email: normalizedEmail },
        source: LogSource.BACKEND,
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    const expectedRole = isOwnerEmail(this.config, admin.email) ? AdminRole.OWNER : admin.role;
    const expectedStatus = expectedRole === AdminRole.OWNER ? AdminAccountStatus.APPROVED : admin.accountStatus;
    if (admin.role !== expectedRole || admin.accountStatus !== expectedStatus) {
      await this.adminModel.findByIdAndUpdate(admin.id, { role: expectedRole, accountStatus: expectedStatus }).exec();
    }

    if (expectedStatus !== AdminAccountStatus.APPROVED) {
      void this.logger.write({
        category: 'auth.login.blocked',
        hostId: admin.id,
        level: LogLevel.WARN,
        message: 'Admin login blocked because account is not approved',
        source: LogSource.BACKEND,
        userEmail: admin.email,
      });
      throw new ForbiddenException('Admin account is waiting for super admin approval');
    }

    void this.logger.write({
      category: 'auth.login.success',
      hostId: admin.id,
      level: LogLevel.INFO,
      message: 'Admin login succeeded',
      source: LogSource.BACKEND,
      userEmail: admin.email,
    });

    return this.createSession(admin.id, admin.email, expectedRole, admin);
  }

  createGoogleAuthUrl() {
    const oauthClient = this.getGoogleLoginClient();

    return {
      authUrl: oauthClient.generateAuthUrl({
        access_type: 'online',
        prompt: 'select_account',
        include_granted_scopes: true,
      scope: ['openid', 'email', 'profile'].join(' '),
      state: this.jwtService.sign(
        {
          nonce: randomBytes(16).toString('hex'),
          purpose: 'google_login',
        } satisfies GoogleLoginState,
        { expiresIn: '10m' },
      ),
      }),
    };
  }

  isGoogleLoginState(state: string | undefined) {
    if (!state) {
      return false;
    }

    const payload = this.jwtService.decode(state) as Partial<GoogleLoginState> | null;
    return payload?.purpose === 'google_login';
  }

  async handleGoogleCallback(code: string | undefined, state: string | undefined, error?: string) {
    const frontendOrigin = this.config.get<string>('FRONTEND_ORIGIN') ?? 'http://localhost:4310';

    try {
      if (error) {
        throw new BadRequestException(`Google rejected the sign-in request: ${error}`);
      }

      if (!code || !state) {
        throw new BadRequestException('Missing Google OAuth code or state');
      }

      await this.verifyGoogleLoginState(state);
      const googleUser = await this.verifyGoogleLoginCode(code);
      const normalizedEmail = normalizeEmail(googleUser.email ?? '');
      if (!normalizedEmail || googleUser.email_verified !== true) {
        throw new BadRequestException('Google account email is missing or not verified');
      }

      const result = await this.loginOrCreateGoogleAdmin(normalizedEmail, googleUser.name);
      const payload = this.encodeGoogleAuthPayload(result);
      return `${frontendOrigin}/auth/google/callback#${payload}`;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Google sign-in failed';
      const params = new URLSearchParams({ error: message });
      return `${frontendOrigin}/auth/google/callback?${params.toString()}`;
    }
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const admin = await this.adminModel.findOne({ email: normalizeEmail(dto.email) }).select('_id email').exec();

    if (!admin) {
      return { ok: true };
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(token);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30);

    await this.adminModel.findByIdAndUpdate(admin.id, {
      passwordResetExpiresAt: expiresAt,
      passwordResetTokenHash: tokenHash,
    }).exec();

    try {
      await this.mailService.sendPasswordReset(admin.email, token);
    } catch (cause) {
      void this.logger.write({
        category: 'auth.password_reset.email_failed',
        hostId: admin.id,
        level: LogLevel.WARN,
        message: 'Failed to send password reset email',
        meta: { cause: cause instanceof Error ? cause.message : 'unknown' },
        source: LogSource.BACKEND,
        userEmail: admin.email,
      });
    }

    return { ok: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = hashResetToken(dto.token);
    const admin = await this.adminModel
      .findOne({
        passwordResetExpiresAt: { $gt: new Date() },
        passwordResetTokenHash: tokenHash,
      })
      .select('+passwordHash +passwordResetTokenHash +passwordResetExpiresAt email role accountStatus fullName phoneNumber profileCompleted onboardingCompleted onboardingSkipped')
      .exec();

    if (!admin) {
      throw new BadRequestException('Password reset link is invalid or expired');
    }

    admin.passwordHash = await bcrypt.hash(dto.password, 12);
    admin.passwordResetTokenHash = null;
    admin.passwordResetExpiresAt = null;
    await admin.save();

    void this.logger.write({
      category: 'auth.password_reset.success',
      hostId: admin.id,
      level: LogLevel.INFO,
      message: 'Admin password was reset by email token',
      source: LogSource.BACKEND,
      userEmail: admin.email,
    });

    return this.createSession(admin.id, admin.email, admin.role, admin);
  }

  private createSession(hostId: string, email: string, role: AdminRole, profile?: { fullName?: string; phoneNumber?: string; profileCompleted?: boolean; onboardingCompleted?: boolean; onboardingSkipped?: boolean }) {
    return toAuthSession({
      accessToken: this.jwtService.sign({ sub: hostId, email, role }),
      email,
      hostId,
      profile,
      role,
    });
  }

  private async createAdminAccount(payload: {
    accountStatus: AdminAccountStatus;
    email: string;
    fullName?: string;
    passwordHash: string;
    role: AdminRole;
  }) {
    try {
      return await this.adminModel.create(payload);
    } catch (cause) {
      if (isDuplicateMongoKeyError(cause)) {
        throw new ConflictException('Email is already used by another admin');
      }

      throw cause;
    }
  }

  private async loginOrCreateGoogleAdmin(email: string, fullName?: string) {
    const existingAdmin = await this.adminModel
      .findOne({ email })
      .select('email fullName phoneNumber profileCompleted onboardingCompleted onboardingSkipped role accountStatus')
      .exec();

    if (existingAdmin) {
      const expectedRole = isOwnerEmail(this.config, existingAdmin.email) ? AdminRole.OWNER : existingAdmin.role;
      const expectedStatus = expectedRole === AdminRole.OWNER ? AdminAccountStatus.APPROVED : existingAdmin.accountStatus;
      if (existingAdmin.role !== expectedRole || existingAdmin.accountStatus !== expectedStatus) {
        await this.adminModel.findByIdAndUpdate(existingAdmin.id, { role: expectedRole, accountStatus: expectedStatus }).exec();
      }

      if (expectedStatus !== AdminAccountStatus.APPROVED) {
        void this.logger.write({
          category: 'auth.google.blocked',
          hostId: existingAdmin.id,
          level: LogLevel.WARN,
          message: 'Google login blocked because account is not approved',
          source: LogSource.BACKEND,
          userEmail: existingAdmin.email,
        });
        return { pendingApproval: true, email: existingAdmin.email };
      }

      void this.logger.write({
        category: 'auth.google.login.success',
        hostId: existingAdmin.id,
        level: LogLevel.INFO,
        message: 'Admin authenticated with Google',
        source: LogSource.BACKEND,
        userEmail: existingAdmin.email,
      });

      return this.createSession(existingAdmin.id, existingAdmin.email, expectedRole, existingAdmin);
    }

    const role = isOwnerEmail(this.config, email) ? AdminRole.OWNER : AdminRole.HOST;
    const accountStatus = role === AdminRole.OWNER ? AdminAccountStatus.APPROVED : AdminAccountStatus.PENDING_APPROVAL;
    const admin = await this.createAdminAccount({
      accountStatus,
      email,
      fullName: fullName?.trim(),
      passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 12),
      role,
    });

    void this.logger.write({
      category: accountStatus === AdminAccountStatus.APPROVED ? 'auth.google.register.owner' : 'auth.google.register.pending_approval',
      hostId: admin.id,
      level: LogLevel.INFO,
      message: accountStatus === AdminAccountStatus.APPROVED ? 'Owner account registered with Google' : 'Host registered with Google and is pending approval',
      source: LogSource.BACKEND,
      userEmail: admin.email,
    });

    if (accountStatus !== AdminAccountStatus.APPROVED) {
      try {
        await this.mailService.sendAdminApprovalRequest(admin.email);
      } catch (cause) {
        void this.logger.write({
          category: 'auth.google.approval_email_failed',
          hostId: admin.id,
          level: LogLevel.WARN,
          message: 'Failed to send Google admin approval request email',
          meta: { cause: cause instanceof Error ? cause.message : 'unknown' },
          source: LogSource.BACKEND,
          userEmail: admin.email,
        });
      }

      return { pendingApproval: true, email: admin.email };
    }

    return this.createSession(admin.id, admin.email, admin.role, admin);
  }

  private async verifyGoogleLoginCode(code: string) {
    const oauthClient = this.getGoogleLoginClient();
    const { tokens } = await oauthClient.getToken(code);
    if (!tokens.id_token) {
      throw new BadRequestException('Google did not return an ID token');
    }

    const ticket = await oauthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.getRequiredConfig('GOOGLE_CLIENT_ID'),
    });
    const payload = ticket.getPayload();
    if (!payload) {
      throw new BadRequestException('Google returned an invalid ID token');
    }

    return payload;
  }

  private async verifyGoogleLoginState(state: string) {
    try {
      const payload = await this.jwtService.verifyAsync<GoogleLoginState>(state, { algorithms: ['HS256'] });
      if (payload.purpose !== 'google_login' || !payload.nonce) {
        throw new Error('Invalid Google login state payload');
      }
    } catch {
      throw new BadRequestException('Invalid or expired Google login state');
    }
  }

  private getGoogleLoginRedirectUri() {
    return this.config.get<string>('GOOGLE_AUTH_REDIRECT_URI')
      ?? this.config.get<string>('GOOGLE_REDIRECT_URI')
      ?? 'http://localhost:3000/api/auth/google/callback';
  }

  private getGoogleLoginClient() {
    return new OAuth2Client(
      this.getRequiredConfig('GOOGLE_CLIENT_ID'),
      this.getRequiredConfig('GOOGLE_CLIENT_SECRET'),
      this.getGoogleLoginRedirectUri(),
    );
  }

  private getRequiredConfig(key: string) {
    const value = this.config.get<string>(key);
    if (!value) {
      throw new BadRequestException(`${key} is not configured`);
    }

    return value;
  }

  private encodeGoogleAuthPayload(payload: unknown) {
    return new URLSearchParams({
      payload: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
    }).toString();
  }
}
