import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventsController } from './controller';
import { Event, EventSchema } from './schemas';
import { EventsService } from './service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Event.name, schema: EventSchema }])],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [MongooseModule],
})
export class EventsModule {}
