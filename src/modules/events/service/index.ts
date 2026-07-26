import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { toObjectId } from '../../../common/mongo';
import { Guest, GuestDocument } from '../../guests/schemas';
import { CreateEventDto } from '../dto/create-event';
import { UpdateEventDto } from '../dto/update-event';
import { SeatingTableDto, UpdateSeatingDto } from '../dto/update-seating';
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

  async getSeating(hostId: string, eventId: string) {
    const event = await this.eventModel
      .findOne({ _id: eventId, hostId: toObjectId(hostId, 'host id') })
      .select('seatingTables')
      .lean()
      .exec();

    if (!event) {
      throw new NotFoundException('Event was not found');
    }

    return { tables: event.seatingTables ?? [] };
  }

  async updateSeating(hostId: string, eventId: string, dto: UpdateSeatingDto) {
    const ownershipFilter = { _id: eventId, hostId: toObjectId(hostId, 'host id') };
    const event = await this.eventModel.findOne(ownershipFilter).select('_id').lean().exec();

    if (!event) {
      throw new NotFoundException('Event was not found');
    }

    this.ensureUniqueSeatingAssignments(dto.tables);
    await this.ensureTablesFitGuests(eventId, dto.tables);

    const seatingTables = dto.tables.map((table) => ({
      ...table,
      guestIds: table.guestIds.map((guestId) => toObjectId(guestId, 'guest id')),
    }));
    const updatedEvent = await this.eventModel
      .findOneAndUpdate(ownershipFilter, { $set: { seatingTables } }, { new: true })
      .select('seatingTables')
      .lean()
      .exec();

    if (!updatedEvent) {
      throw new NotFoundException('Event was not found');
    }

    return { tables: updatedEvent.seatingTables ?? [] };
  }

  private ensureUniqueSeatingAssignments(tables: SeatingTableDto[]) {
    const tableIds = new Set<string>();
    const guestIds = new Set<string>();

    for (const table of tables) {
      if (tableIds.has(table.id)) {
        throw new BadRequestException('Table ids must be unique');
      }
      tableIds.add(table.id);

      for (const guestId of table.guestIds) {
        if (guestIds.has(guestId)) {
          throw new BadRequestException('A guest can only be assigned to one table');
        }
        guestIds.add(guestId);
      }
    }
  }

  private async ensureTablesFitGuests(eventId: string, tables: SeatingTableDto[]) {
    const requestedGuestIds = tables.flatMap((table) => table.guestIds);
    if (!requestedGuestIds.length) {
      return;
    }

    const guests = await this.guestModel
      .find({ _id: { $in: requestedGuestIds }, eventId: toObjectId(eventId, 'event id') })
      .select('_id rsvpDetails')
      .lean()
      .exec();
    const guestsById = new Map(guests.map((guest) => [guest._id.toString(), guest]));

    if (guestsById.size !== requestedGuestIds.length) {
      throw new BadRequestException('Every assigned guest must belong to this event');
    }

    for (const table of tables) {
      const occupiedSeats = table.guestIds.reduce((total, guestId) => {
        const guest = guestsById.get(guestId);
        const partySize = (guest?.rsvpDetails?.adults ?? 0) + (guest?.rsvpDetails?.children ?? 0);
        return total + Math.max(partySize, 1);
      }, 0);

      if (occupiedSeats > table.capacity) {
        throw new BadRequestException(`Table ${table.name} exceeds its capacity`);
      }
    }
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
