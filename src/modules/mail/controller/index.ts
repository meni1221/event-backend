import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth';
import { routeRateLimits } from '../../../common/security';
import { SendInvitationEmailBatchDto } from '../dto';
import { MailService } from '../service';

@ApiTags('Mail')
@ApiBearerAuth('access-token')
@Controller('mail')
@UseGuards(JwtAuthGuard)
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post('send-invitations')
  @Throttle(routeRateLimits.mail.sendBatch)
  @HttpCode(StatusCodes.ACCEPTED)
  sendInvitationEmails(@Body() dto: SendInvitationEmailBatchDto) {
    return this.mailService.sendInvitationEmails(dto.recipients, dto.message);
  }
}
