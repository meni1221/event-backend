import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { Throttle } from '@nestjs/throttler';
import { CurrentHost } from '../../../common/decorators/current-host';
import { routeRateLimits } from '../../../common/security';
import { ApiProtectedOperation } from '../../../common/swagger/operations';
import { SendWhatsappBatchDto, SendWhatsappTestDto, WhatsappConnectionQueryDto } from '../dto';
import { WhatsappMessageQueueService } from '../message-queue';
import { WhatsappClientSnapshot, WhatsappManagerService } from '../manager';

@ApiTags('WhatsApp')
@ApiBearerAuth('access-token')
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly whatsappManager: WhatsappManagerService,
    private readonly messageQueue: WhatsappMessageQueueService,
  ) {}

  @Post('connect')
  @ApiProtectedOperation('Start or restore a host WhatsApp connection')
  @Throttle(routeRateLimits.whatsapp.connect)
  @HttpCode(StatusCodes.OK)
  async connect(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    return this.whatsappManager.ensureClient(host.hostId, query.connectionId);
  }

  @Get('qr')
  @ApiProtectedOperation('Get the current WhatsApp pairing QR code')
  async getQr(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    return this.whatsappManager.getQrCode(host.hostId, query.connectionId);
  }

  @Get('status')
  @ApiProtectedOperation('Get sanitized WhatsApp connection status')
  async getStatus(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    return this.sanitizeStatusSnapshot(await this.whatsappManager.getStatus(host.hostId, query.connectionId));
  }

  @Post('disconnect')
  @ApiProtectedOperation('Disconnect the current WhatsApp connection')
  @HttpCode(StatusCodes.OK)
  async disconnect(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    await this.whatsappManager.disconnect(host.hostId, query.connectionId);
    return { status: 'DISCONNECTED' };
  }

  @Post('send-batch')
  @ApiProtectedOperation('Queue a rate-limited WhatsApp message batch')
  @Throttle(routeRateLimits.whatsapp.sendBatch)
  @HttpCode(StatusCodes.ACCEPTED)
  async sendBatch(@CurrentHost() host: { hostId: string }, @Body() dto: SendWhatsappBatchDto) {
    return this.messageQueue.enqueueBatch(host.hostId, dto);
  }

  @Post('send-test')
  @ApiProtectedOperation('Queue a single WhatsApp test message')
  @Throttle(routeRateLimits.whatsapp.sendTest)
  @HttpCode(StatusCodes.ACCEPTED)
  async sendTest(@CurrentHost() host: { hostId: string }, @Body() dto: SendWhatsappTestDto) {
    return this.messageQueue.sendTest(host.hostId, dto);
  }

  @Get('send-state')
  @ApiProtectedOperation('Get current WhatsApp queue state')
  getSendState(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    return this.messageQueue.getQueueState(host.hostId, query.connectionId);
  }

  @Get('send-history')
  @ApiProtectedOperation('Get WhatsApp batch history')
  getSendHistory(@CurrentHost() host: { hostId: string }, @Query('eventId') eventId?: string, @Query('connectionId') connectionId?: string) {
    return this.messageQueue.getHistory(host.hostId, eventId, connectionId);
  }

  @Post('send-stop')
  @ApiProtectedOperation('Stop the active WhatsApp batch')
  @HttpCode(StatusCodes.OK)
  stopCurrentBatch(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    return this.messageQueue.stopCurrentBatch(host.hostId, query.connectionId);
  }

  @Post('send-pause')
  @ApiProtectedOperation('Pause the active WhatsApp batch')
  @HttpCode(StatusCodes.OK)
  pauseCurrentBatch(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    return this.messageQueue.pauseCurrentBatch(host.hostId, query.connectionId);
  }

  @Post('send-resume')
  @ApiProtectedOperation('Resume the paused WhatsApp batch')
  @HttpCode(StatusCodes.OK)
  resumeCurrentBatch(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    return this.messageQueue.resumeCurrentBatch(host.hostId, query.connectionId);
  }

  @Post('send-retry-failed')
  @ApiProtectedOperation('Retry failed recipients from the latest batch')
  @HttpCode(StatusCodes.ACCEPTED)
  retryFailed(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    return this.messageQueue.retryFailed(host.hostId, query.connectionId);
  }

  private sanitizeStatusSnapshot(snapshot: WhatsappClientSnapshot): WhatsappClientSnapshot {
    return {
      ...snapshot,
      qrCode: null,
    };
  }
}
