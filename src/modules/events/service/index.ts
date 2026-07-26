import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { toObjectId } from '../../../common/mongo';
import { Guest, GuestDocument } from '../../guests/schemas';
import { CreateEventDto } from '../dto/create-event';
import { UpdateEventDto } from '../dto/update-event';
import { Event, EventDocument } from '../schemas';

@Injectable()
export class EventsService {
  constructor(
    @InjectModel(Event.name) private readonly eventModel: Model<EventDocument>,
    @InjectModel(Guest.name) private readonly guestModel: Model<GuestDocument>,
  ) {}

  async create(hostId: string, dto: CreateEventDto) {
    return this.eventModel.create({
      ...dto,
      hostId: toObjectId(hostId, 'host id'),
      eventDate: dto.eventDate ? new Date(dto.eventDate) : undefined,
    });
  }

  async findAll(hostId: string) {
    return this.eventModel
      .find({ hostId: toObjectId(hostId, 'host id') })
      .sort({ eventDate: -1, createdAt: -1 })
      .lean()
      .exec();
  }

  async update(hostId: string, eventId: string, dto: UpdateEventDto) {
    const event = await this.eventModel
      .findOneAndUpdate(
        { _id: eventId, hostId: toObjectId(hostId, 'host id') },
        {
          ...dto,
          eventDate: dto.eventDate ? new Date(dto.eventDate) : undefined,
        },
        { new: true },
      )
      .lean()
      .exec();

    if (!event) {
      throw new NotFoundException('Event was not found');
    }

    return event;
  }

  async remove(hostId: string, eventId: string) {
    const filter = { _id: eventId, hostId: toObjectId(hostId, 'host id') };
    const ownedEvent = await this.eventModel
      .findOne(filter)
      .select('_id')
      .lean()
      .exec();

    if (!ownedEvent) {
      throw new NotFoundException('Event was not found');
    }

    await this.guestModel.deleteMany({ eventId: ownedEvent._id }).exec();

    const deletedEvent = await this.eventModel.findOneAndDelete(filter).lean().exec();
    if (!deletedEvent) {
      throw new NotFoundException('Event was not found');
    }

    return deletedEvent;
  }
}
