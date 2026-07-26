import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { Throttle } from '@nestjs/throttler';
import { routeRateLimits } from '../../../common/security';
import { ApiProtectedOperation } from '../../../common/swagger/operations';
import { SendInvitationEmailBatchDto } from '../dto';
import { MailService } from '../service';

@ApiTags('Mail')
@ApiBearerAuth('access-token')
@Controller('mail')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post('send-invitations')
  @ApiProtectedOperation('Queue or send an invitation email batch')
  @Throttle(routeRateLimits.mail.sendBatch)
  @HttpCode(StatusCodes.ACCEPTED)
  sendInvitationEmails(@Body() dto: SendInvitationEmailBatchDto) {
    return this.mailService.sendInvitationEmails(dto.recipients, dto.message);
  }
}
