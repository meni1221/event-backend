import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EventDocument = HydratedDocument<Event>;

export enum EventTheme {
  BRIT = 'brit',
  WEDDING = 'wedding',
  BAR_MITZVAH = 'bar_mitzvah',
  BIRTHDAY = 'birthday',
  CORPORATE = 'corporate',
}

export enum EventSeatingMode {
  MIXED = 'mixed',
  SEPARATE = 'separate',
}

@Schema({ _id: false })
export class SeatingTable {
  @Prop({ required: true, trim: true, maxlength: 64 })
  id!: string;

  @Prop({ required: true, trim: true, maxlength: 80 })
  name!: string;

  @Prop({ required: true, trim: true, maxlength: 80 })
  zone!: string;

  @Prop({ required: true, min: 1, max: 100 })
  capacity!: number;

  @Prop({ type: [Types.ObjectId], ref: 'Guest', default: [] })
  guestIds!: Types.ObjectId[];
}

@Schema({ timestamps: true, collection: 'events' })
export class Event {
  @Prop({ type: Types.ObjectId, ref: 'Admin', required: true, index: true })
  hostId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  eventName!: string;

  @Prop({ type: Date })
  eventDate?: Date;

  @Prop({ trim: true })
  venueName?: string;

  @Prop({ trim: true })
  address?: string;

  @Prop({ trim: true })
  wazeLink?: string;

  @Prop({ trim: true })
  bitLink?: string;

  @Prop({ trim: true })
  adminPhoneNumber?: string;

  @Prop({ trim: true })
  googleCalendarEventId?: string;

  @Prop({
    type: String,
    enum: Object.values(EventTheme),
    default: EventTheme.BRIT,
    index: true,
  })
  theme!: EventTheme;

  @Prop({
    type: String,
    enum: Object.values(EventSeatingMode),
    default: EventSeatingMode.MIXED,
    index: true,
  })
  seatingMode!: EventSeatingMode;

  @Prop({ type: [SeatingTable], default: [] })
  seatingTables!: SeatingTable[];

  @Prop({ trim: true, default: 'classic' })
  invitationTemplateKey!: string;

  @Prop({ trim: true, maxlength: 120 })
  invitationTitle?: string;

  @Prop({ trim: true, maxlength: 1200 })
  invitationMessage?: string;
}

export const EventSchema = SchemaFactory.createForClass(Event);

EventSchema.index({ hostId: 1, eventDate: -1 });
EventSchema.index({ hostId: 1, eventName: 1 });
EventSchema.index({ hostId: 1, theme: 1 });
