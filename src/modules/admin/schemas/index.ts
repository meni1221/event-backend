import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AdminDocument = HydratedDocument<Admin>;

export enum WhatsappStatus {
  DISCONNECTED = 'DISCONNECTED',
  QR_READY = 'QR_READY',
  CONNECTED = 'CONNECTED',
}

export enum AdminRole {
  HOST = 'HOST',
  OWNER = 'OWNER',
}

export enum AdminAccountStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  SUSPENDED = 'SUSPENDED',
}

@Schema({ _id: false })
export class WhatsappSession {
  @Prop({ required: true, trim: true })
  sessionName!: string;

  @Prop({ type: Buffer, required: true })
  archive!: Buffer;

  @Prop({ type: Date, required: true })
  savedAt!: Date;
}

@Schema({ timestamps: true, collection: 'admins' })
export class Admin {
  @Prop({ required: true, unique: true, trim: true, lowercase: true, index: true })
  email!: string;

  @Prop({ trim: true, default: '' })
  fullName!: string;

  @Prop({ trim: true, default: '' })
  phoneNumber!: string;

  @Prop({ default: false, index: true })
  profileCompleted!: boolean;

  @Prop({ default: false, index: true })
  onboardingCompleted!: boolean;

  @Prop({ default: false, index: true })
  onboardingSkipped!: boolean;

  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ type: String, select: false, default: null })
  passwordResetTokenHash!: string | null;

  @Prop({ type: Date, select: false, default: null })
  passwordResetExpiresAt!: Date | null;

  @Prop({
    type: String,
    enum: Object.values(AdminRole),
    default: AdminRole.HOST,
    index: true,
  })
  role!: AdminRole;

  @Prop({
    type: String,
    enum: Object.values(AdminAccountStatus),
    default: AdminAccountStatus.PENDING_APPROVAL,
    index: true,
  })
  accountStatus!: AdminAccountStatus;

  @Prop({ type: WhatsappSession, default: null })
  whatsappSession!: WhatsappSession | null;

  @Prop({
    type: String,
    enum: Object.values(WhatsappStatus),
    default: WhatsappStatus.DISCONNECTED,
    index: true,
  })
  whatsappStatus!: WhatsappStatus;

  @Prop({ type: Object, default: null })
  googleConnection!: {
    googleAccountEmail?: string;
    refreshToken?: string;
    scopes?: string[];
    connectedAt?: Date;
  } | null;
}

export const AdminSchema = SchemaFactory.createForClass(Admin);
