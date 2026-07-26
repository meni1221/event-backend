import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Guest, GuestSchema } from '../guests/schemas';
import { EventsController } from './controller';
import { Event, EventSchema } from './schemas';
import { EventsService } from './service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: Guest.name, schema: GuestSchema },
    ]),
  ],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [MongooseModule],
})
export class EventsModule {}
