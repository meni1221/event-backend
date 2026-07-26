import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { nanoid } from 'nanoid';
import { HydratedDocument, Types } from 'mongoose';

export type GuestDocument = HydratedDocument<Guest>;

export enum GuestLanguage {
  HE = 'he',
  EN = 'en',
  ES = 'es',
}

export enum GuestStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  MAYBE = 'maybe',
  DECLINED = 'declined',
  REMINDED = 'reminded',
  THANKED = 'thanked',
}

@Schema({ _id: false })
export class RsvpDetails {
  @Prop({ min: 0, default: 0 })
  adults?: number;

  @Prop({ min: 0, default: 0 })
  children?: number;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: Date })
  updatedAt?: Date;
}

@Schema({ _id: false })
export class GuestJourneyEntry {
  @Prop({ required: true, trim: true })
  event!: string;

  @Prop({ type: Date, default: Date.now })
  timestamp!: Date;

  @Prop({ type: Object, default: {} })
  meta!: Record<string, unknown>;
}

@Schema({ timestamps: true, collection: 'guests' })
export class Guest {
  @Prop({ type: Types.ObjectId, ref: 'Event', required: true, index: true })
  eventId!: Types.ObjectId;

  @Prop({ required: true, default: () => nanoid(12) })
  inviteId!: string;

  @Prop({ required: true, trim: true })
  fullName!: string;

  @Prop({ required: true, trim: true })
  phoneNumber!: string;

  @Prop({ trim: true, lowercase: true, default: '' })
  email!: string;

  @Prop({
    type: String,
    enum: Object.values(GuestLanguage),
    default: GuestLanguage.HE,
  })
  language!: GuestLanguage;

  @Prop({
    type: String,
    enum: Object.values(GuestStatus),
    default: GuestStatus.PENDING,
    index: true,
  })
  status!: GuestStatus;

  @Prop({ type: Number, default: 2, min: 1, max: 20 })
  maxAllowed!: number;

  @Prop({ type: Number, default: 0, min: 0, max: 20 })
  menCount!: number;

  @Prop({ type: Number, default: 0, min: 0, max: 20 })
  womenCount!: number;

  @Prop({ type: RsvpDetails, default: {} })
  rsvpDetails!: RsvpDetails;

  @Prop({ type: [GuestJourneyEntry], default: [] })
  journey!: GuestJourneyEntry[];
}

export const GuestSchema = SchemaFactory.createForClass(Guest);

GuestSchema.index({ eventId: 1, phoneNumber: 1 }, { unique: true });
GuestSchema.index({ eventId: 1, email: 1 });
GuestSchema.index({ inviteId: 1 }, { unique: true });
GuestSchema.index({ eventId: 1, status: 1 });
