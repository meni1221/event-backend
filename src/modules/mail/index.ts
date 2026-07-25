import { Module } from '@nestjs/common';
import { MailController } from './controller';
import { MailService } from './service';

@Module({
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
