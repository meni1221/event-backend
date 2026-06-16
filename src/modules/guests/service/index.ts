import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Event, EventDocument } from '../../events/schemas';
import { CreateGuestDto } from '../dto/create-guest';
import { UpdateGuestDto } from '../dto/update-guest';
import { UpdateRsvpDto } from '../dto/update-rsvp';
import { ensureGenderCountsFit, getInviteFilter } from '../helpers';
import { PublicGuestRecord, toPublicInvite } from '../mappers';
import { Guest, GuestDocument } from '../schemas';

@Injectable()
export class GuestsService {
  constructor(
    @InjectModel(Event.name) private readonly eventModel: Model<EventDocument>,
    @InjectModel(Guest.name) private readonly guestModel: Model<GuestDocument>,
  ) {}

  async findByHost(hostId: string) {
    const events = await this.eventModel
      .find({ hostId: new Types.ObjectId(hostId) })
      .select('_id')
      .lean()
      .exec();
    const eventIds = events.map((event) => event._id);

    return this.guestModel
      .find({ eventId: { $in: eventIds } })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async createForEvent(hostId: string, eventId: string, dto: CreateGuestDto) {
    const event = await this.eventModel
      .findOne({ _id: eventId, hostId: new Types.ObjectId(hostId) })
      .select('_id')
      .lean()
      .exec();

    if (!event) {
      throw new NotFoundException('Event was not found');
    }

    const maxAllowed = dto.maxAllowed ?? 2;
    const menCount = dto.menCount ?? 0;
    const womenCount = dto.womenCount ?? 0;
    const adults = dto.adults ?? 0;
    const children = dto.children ?? 0;

    if (adults + children > maxAllowed) {
      throw new BadRequestException(`Guest count exceeds max allowed guests (${maxAllowed})`);
    }

    ensureGenderCountsFit(maxAllowed, menCount, womenCount);

    return this.guestModel.create({
      ...dto,
      eventId: new Types.ObjectId(eventId),
      rsvpDetails: {
        adults,
        children,
        notes: dto.notes,
        updatedAt: new Date(),
      },
    });
  }

  async remove(hostId: string, guestId: string) {
    const eventIds = await this.getHostEventIds(hostId);
    const guest = await this.guestModel
      .findOneAndDelete({ _id: guestId, eventId: { $in: eventIds } })
      .lean()
      .exec();

    if (!guest) {
      throw new NotFoundException('Guest was not found');
    }

    return guest;
  }

  async update(hostId: string, guestId: string, dto: UpdateGuestDto) {
    const eventIds = await this.getHostEventIds(hostId);
    const existingGuest = await this.guestModel
      .findOne({ _id: guestId, eventId: { $in: eventIds } })
      .lean()
      .exec();

    if (!existingGuest) {
      throw new NotFoundException('Guest was not found');
    }

    const maxAllowed = dto.maxAllowed ?? existingGuest.maxAllowed;
    const menCount = dto.menCount ?? existingGuest.menCount ?? 0;
    const womenCount = dto.womenCount ?? existingGuest.womenCount ?? 0;
    const adults = dto.adults ?? existingGuest.rsvpDetails?.adults ?? 0;
    const children = dto.children ?? existingGuest.rsvpDetails?.children ?? 0;

    if (adults + children > maxAllowed) {
      throw new BadRequestException(`Guest count exceeds max allowed guests (${maxAllowed})`);
    }

    ensureGenderCountsFit(maxAllowed, menCount, womenCount);

    const updatedAt = new Date();
    const updatePayload = {
      ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
      ...(dto.phoneNumber !== undefined ? { phoneNumber: dto.phoneNumber } : {}),
      ...(dto.email !== undefined ? { email: dto.email } : {}),
      ...(dto.language !== undefined ? { language: dto.language } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.maxAllowed !== undefined ? { maxAllowed: dto.maxAllowed } : {}),
      ...(dto.menCount !== undefined ? { menCount } : {}),
      ...(dto.womenCount !== undefined ? { womenCount } : {}),
      rsvpDetails: {
        adults,
        children,
        notes: dto.notes ?? existingGuest.rsvpDetails?.notes,
        updatedAt,
      },
    };

    const guest = await this.guestModel
      .findOneAndUpdate(
        { _id: guestId, eventId: { $in: eventIds } },
        {
          $set: updatePayload,
          $push: {
            journey: {
              event: 'admin_updated',
              timestamp: updatedAt,
              meta: {
                status: dto.status,
              },
            },
          },
        },
        { new: true },
      )
      .lean()
      .exec();

    if (!guest) {
      throw new NotFoundException('Guest was not found');
    }

    return guest;
  }

  private async getHostEventIds(hostId: string) {
    const events = await this.eventModel
      .find({ hostId: new Types.ObjectId(hostId) })
      .select('_id')
      .lean()
      .exec();
    return events.map((event) => event._id);
  }

  async findByInviteId(inviteId: string) {
    const guest = await this.guestModel.findOne({ inviteId }).lean().exec();
    return this.buildPublicInvite(guest);
  }

  async findByEventInviteId(eventId: string, inviteId: string) {
    if (!Types.ObjectId.isValid(eventId)) {
      throw new NotFoundException('Invitation was not found');
    }

    const guest = await this.guestModel
      .findOne({ eventId: new Types.ObjectId(eventId), inviteId })
      .lean()
      .exec();
    return this.buildPublicInvite(guest);
  }

  private async buildPublicInvite(guest: PublicGuestRecord | null) {
    if (!guest) {
      throw new NotFoundException('Invitation was not found');
    }

    const event = await this.eventModel.findById(guest.eventId).lean().exec();
    if (!event) {
      throw new NotFoundException('Event was not found for this invitation');
    }

    return toPublicInvite(event, guest);
  }

  async updateRsvp(inviteId: string, dto: UpdateRsvpDto, eventId?: string) {
    const updatedAt = new Date();
    const requestedGuests = dto.status === 'declined' ? 0 : (dto.adults ?? 0) + (dto.children ?? 0);
    const filter = getInviteFilter(inviteId, eventId);
    const existingGuest = await this.guestModel.findOne(filter).select('maxAllowed').lean().exec();
    if (!existingGuest) {
      throw new NotFoundException('Invitation was not found');
    }

    if (requestedGuests > existingGuest.maxAllowed) {
      throw new BadRequestException(`RSVP exceeds max allowed guests (${existingGuest.maxAllowed})`);
    }

    const guest = await this.guestModel
      .findOneAndUpdate(
        filter,
        {
          status: dto.status,
          rsvpDetails: {
            adults: dto.status === 'declined' ? 0 : dto.adults ?? 0,
            children: dto.status === 'declined' ? 0 : dto.children ?? 0,
            notes: dto.notes,
            updatedAt,
          },
          $push: {
            journey: {
              event: 'rsvp_updated',
              timestamp: updatedAt,
              meta: {
                status: dto.status,
              },
            },
          },
        },
        { new: true },
      )
      .lean()
      .exec();

    if (!guest) {
      throw new NotFoundException('Invitation was not found');
    }

    return {
      inviteId: guest.inviteId,
      fullName: guest.fullName,
      status: guest.status,
      rsvpDetails: guest.rsvpDetails,
    };
  }

}
