import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { StatusCodes } from 'http-status-codes';
import { CurrentHost } from '../../../common/decorators/current-host';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth';
import { SendWhatsappBatchDto, SendWhatsappTestDto, WhatsappConnectionQueryDto } from '../dto';
import { WhatsappMessageQueueService } from '../message-queue';
import { WhatsappClientSnapshot, WhatsappManagerService } from '../manager';

@ApiTags('WhatsApp')
@ApiBearerAuth('access-token')
@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsappController {
  constructor(
    private readonly whatsappManager: WhatsappManagerService,
    private readonly messageQueue: WhatsappMessageQueueService,
  ) {}

  @Post('connect')
  @HttpCode(StatusCodes.OK)
  async connect(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    return this.whatsappManager.ensureClient(host.hostId, query.connectionId);
  }

  @Get('qr')
  async getQr(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    return this.whatsappManager.getQrCode(host.hostId, query.connectionId);
  }

  @Get('status')
  async getStatus(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    return this.sanitizeStatusSnapshot(await this.whatsappManager.getStatus(host.hostId, query.connectionId));
  }

  @Post('disconnect')
  @HttpCode(StatusCodes.OK)
  async disconnect(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    await this.whatsappManager.disconnect(host.hostId, query.connectionId);
    return { status: 'DISCONNECTED' };
  }

  @Post('send-batch')
  @HttpCode(StatusCodes.ACCEPTED)
  async sendBatch(@CurrentHost() host: { hostId: string }, @Body() dto: SendWhatsappBatchDto) {
    return this.messageQueue.enqueueBatch(host.hostId, dto);
  }

  @Post('send-test')
  @HttpCode(StatusCodes.ACCEPTED)
  async sendTest(@CurrentHost() host: { hostId: string }, @Body() dto: SendWhatsappTestDto) {
    return this.messageQueue.sendTest(host.hostId, dto);
  }

  @Get('send-state')
  getSendState(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    return this.messageQueue.getQueueState(host.hostId, query.connectionId);
  }

  @Get('send-history')
  getSendHistory(@CurrentHost() host: { hostId: string }, @Query('eventId') eventId?: string, @Query('connectionId') connectionId?: string) {
    return this.messageQueue.getHistory(host.hostId, eventId, connectionId);
  }

  @Post('send-stop')
  @HttpCode(StatusCodes.OK)
  stopCurrentBatch(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    return this.messageQueue.stopCurrentBatch(host.hostId, query.connectionId);
  }

  @Post('send-pause')
  @HttpCode(StatusCodes.OK)
  pauseCurrentBatch(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    return this.messageQueue.pauseCurrentBatch(host.hostId, query.connectionId);
  }

  @Post('send-resume')
  @HttpCode(StatusCodes.OK)
  resumeCurrentBatch(@CurrentHost() host: { hostId: string }, @Query() query: WhatsappConnectionQueryDto) {
    return this.messageQueue.resumeCurrentBatch(host.hostId, query.connectionId);
  }

  @Post('send-retry-failed')
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
