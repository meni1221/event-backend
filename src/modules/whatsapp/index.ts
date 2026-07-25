import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Admin, AdminSchema } from '../admin/schemas';
import { AuthModule } from '../auth';
import { Event, EventSchema } from '../events/schemas';
import { Guest, GuestSchema } from '../guests/schemas';
import { WhatsappController } from './controller';
import { WhatsappGateway } from './gateway';
import { WhatsappManagerService } from './manager';
import { WhatsappMessageQueueService } from './message-queue';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Admin.name, schema: AdminSchema },
      { name: Event.name, schema: EventSchema },
      { name: Guest.name, schema: GuestSchema },
    ]),
  ],
  controllers: [WhatsappController],
  providers: [WhatsappManagerService, WhatsappGateway, WhatsappMessageQueueService],
  exports: [WhatsappManagerService],
})
export class WhatsappModule {}
