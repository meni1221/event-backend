import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Event, EventSchema } from '../events/schemas';
import { Guest, GuestSchema } from '../guests/schemas';
import { MailModule } from '../mail';
import { AdminController } from './controller';
import { Admin, AdminSchema } from './schemas';
import { AdminService } from './service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Admin.name, schema: AdminSchema },
      { name: Event.name, schema: EventSchema },
      { name: Guest.name, schema: GuestSchema },
    ]),
    MailModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [MongooseModule],
})
export class AdminModule {}
