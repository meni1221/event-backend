import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Event, EventDocument } from '../../events/schemas';
import { Guest, GuestDocument } from '../../guests/schemas';
import { LogLevel, LogSource } from '../../logs/schemas';
import { AppLoggerService } from '../../logs/service';
import { SendWhatsappBatchDto, SendWhatsappTestDto, WhatsappRecipientDto } from '../dto';
import { WhatsappGateway } from '../gateway';
import { WhatsappManagerService } from '../manager';

type QueueItemStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
type QueueStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'STOPPING' | 'DONE' | 'FAILED' | 'CANCELLED';

type QueueItem = {
  id: string;
  fullName?: string;
  guestId?: string;
  inviteLink?: string;
  phoneNumber: string;
  reason?: string;
  status: QueueItemStatus;
};

export type QueueSnapshot = {
  batchId: string | null;
  completedAt?: string;
  createdAt?: string;
  eventId?: string;
  items: QueueItem[];
  messageTemplate?: string;
  nextRecipient?: string;
  progress: {
    failed: number;
    queued: number;
    sent: number;
    skipped: number;
    total: number;
  };
  status: QueueStatus;
};

type MissingWhatsappRecipient = {
  fullName?: string;
  phoneNumber: string;
};

type BatchHistoryEntry = {
  batchId: string;
  createdAt: string;
  eventId?: string;
  failed: number;
  messagePreview: string;
  sent: number;
  skipped: number;
  total: number;
};

type SendBatchResult = {
  failed: QueueItem[];
  queued: number;
  sent: number;
  skipped: number;
};

@Injectable()
export class WhatsappMessageQueueService {
  private static readonly MIN_BATCH_INTERVAL_MS = 10000;
  private readonly logger = new Logger(WhatsappMessageQueueService.name);
  private readonly hostQueues = new Map<string, Promise<void>>();
  private readonly lastBatchAtByHost = new Map<string, number>();
  private readonly snapshots = new Map<string, QueueSnapshot>();
  private readonly history = new Map<string, BatchHistoryEntry[]>();
  private readonly cancelRequests = new Set<string>();
  private readonly pauseRequests = new Set<string>();

  constructor(
    private readonly whatsappManager: WhatsappManagerService,
    private readonly appLogger: AppLoggerService,
    @InjectModel(Event.name) private readonly eventModel: Model<EventDocument>,
    @InjectModel(Guest.name) private readonly guestModel: Model<GuestDocument>,
    @Inject(forwardRef(() => WhatsappGateway))
    private readonly gateway?: WhatsappGateway,
  ) {}

  getQueueState(hostId: string, connectionId = WhatsappManagerService.DEFAULT_CONNECTION_ID): QueueSnapshot {
    return this.sanitizeSnapshot(this.snapshots.get(this.queueKey(hostId, connectionId)) ?? this.emptySnapshot());
  }

  getHistory(hostId: string, eventId?: string, connectionId = WhatsappManagerService.DEFAULT_CONNECTION_ID): BatchHistoryEntry[] {
    const entries = this.history.get(this.queueKey(hostId, connectionId)) ?? [];
    return eventId ? entries.filter((entry) => entry.eventId === eventId) : entries;
  }

  stopCurrentBatch(hostId: string, connectionId = WhatsappManagerService.DEFAULT_CONNECTION_ID) {
    const key = this.queueKey(hostId, connectionId);
    const snapshot = this.snapshots.get(key) ?? this.emptySnapshot();
    if (snapshot.status !== 'RUNNING') {
      return snapshot;
    }

    this.cancelRequests.add(key);
    this.pauseRequests.delete(key);
    const nextSnapshot = { ...snapshot, status: 'STOPPING' as QueueStatus };
    this.snapshots.set(key, nextSnapshot);
    this.emitQueueSnapshot(hostId, connectionId, nextSnapshot);
    return this.sanitizeSnapshot(nextSnapshot);
  }

  pauseCurrentBatch(hostId: string, connectionId = WhatsappManagerService.DEFAULT_CONNECTION_ID) {
    const key = this.queueKey(hostId, connectionId);
    const snapshot = this.snapshots.get(key) ?? this.emptySnapshot();
    if (snapshot.status !== 'RUNNING') {
      return this.sanitizeSnapshot(snapshot);
    }

    this.pauseRequests.add(key);
    const nextSnapshot = { ...snapshot, status: 'PAUSED' as QueueStatus };
    this.snapshots.set(key, nextSnapshot);
    this.emitQueueSnapshot(hostId, connectionId, nextSnapshot);
    return this.sanitizeSnapshot(nextSnapshot);
  }

  resumeCurrentBatch(hostId: string, connectionId = WhatsappManagerService.DEFAULT_CONNECTION_ID) {
    const key = this.queueKey(hostId, connectionId);
    const snapshot = this.snapshots.get(key) ?? this.emptySnapshot();
    if (snapshot.status !== 'PAUSED') {
      return this.sanitizeSnapshot(snapshot);
    }

    this.pauseRequests.delete(key);
    const nextSnapshot = { ...snapshot, status: 'RUNNING' as QueueStatus };
    this.snapshots.set(key, nextSnapshot);
    this.emitQueueSnapshot(hostId, connectionId, nextSnapshot);
    return this.sanitizeSnapshot(nextSnapshot);
  }

  async retryFailed(hostId: string, connectionId = WhatsappManagerService.DEFAULT_CONNECTION_ID): Promise<{ missingWhatsapp: MissingWhatsappRecipient[]; queued: number }> {
    const snapshot = this.snapshots.get(this.queueKey(hostId, connectionId)) ?? this.emptySnapshot();
    const failedItems = snapshot.items.filter((item) => item.status === 'FAILED');

    if (!failedItems.length || !snapshot.messageTemplate) {
      throw new BadRequestException('There are no failed WhatsApp messages to retry.');
    }

    return this.enqueueBatch(hostId, {
      allowResend: true,
      connectionId,
      eventId: snapshot.eventId,
      maxDelayMs: 5000,
      message: snapshot.messageTemplate,
      minDelayMs: 2500,
      recipients: failedItems.map((item) => ({
        fullName: item.fullName,
        guestId: item.guestId,
        inviteLink: item.inviteLink,
        phoneNumber: item.phoneNumber,
      })),
    });
  }

  async sendTest(hostId: string, dto: SendWhatsappTestDto): Promise<{ queued: number }> {
    await this.whatsappManager.sendMessage(hostId, dto.phoneNumber, dto.message, dto.connectionId);
    return { queued: 1 };
  }

  async enqueueBatch(hostId: string, dto: SendWhatsappBatchDto): Promise<{ missingWhatsapp: MissingWhatsappRecipient[]; queued: number }> {
    const connectionId = dto.connectionId ?? WhatsappManagerService.DEFAULT_CONNECTION_ID;
    const key = this.queueKey(hostId, connectionId);
    this.assertBatchRateLimit(key);
    await this.assertEventBelongsToHost(hostId, dto.eventId);

    const recipients = await this.prepareRecipients(hostId, dto);
    if (!recipients.length) {
      throw new BadRequestException('No WhatsApp recipients are available. They may have already received this message.');
    }
    const batchId = `wa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const snapshot: QueueSnapshot = {
      batchId,
      createdAt: new Date().toISOString(),
      eventId: dto.eventId,
      items: recipients.map((recipient, index) => ({
        id: `${batchId}_${index}`,
        fullName: recipient.fullName,
        guestId: recipient.guestId,
        inviteLink: recipient.inviteLink,
        phoneNumber: recipient.phoneNumber,
        status: 'QUEUED',
      })),
      messageTemplate: dto.message,
      progress: {
        failed: 0,
        queued: recipients.length,
        sent: 0,
        skipped: 0,
        total: recipients.length,
      },
      status: 'RUNNING',
    };

    this.snapshots.set(key, snapshot);
    this.emitQueueSnapshot(hostId, connectionId, snapshot);
    this.cancelRequests.delete(key);
    void this.writeLog(LogLevel.INFO, 'WhatsApp batch enqueue requested', {
      connectionId,
      recipients: recipients.length,
    }, hostId);

    const queue = this.hostQueues.get(key) ?? Promise.resolve();
    const nextQueue = queue
      .catch(() => undefined)
      .then(() => this.sendBatch(hostId, connectionId, { ...dto, recipients }))
      .then((result) => {
        this.finalizeSnapshot(hostId, connectionId, result);
      })
      .catch((error) => {
        const currentSnapshot = this.snapshots.get(key) ?? this.emptySnapshot();
        const failedSnapshot = { ...currentSnapshot, completedAt: new Date().toISOString(), status: 'FAILED' as QueueStatus };
        this.snapshots.set(key, failedSnapshot);
        this.emitQueueSnapshot(hostId, connectionId, failedSnapshot);
        this.logger.warn(`WhatsApp batch failed for host ${hostId}: ${error instanceof Error ? error.message : String(error)}`);
      });

    this.hostQueues.set(key, nextQueue);

    return {
      missingWhatsapp: [],
      queued: recipients.length,
    };
  }

  private async prepareRecipients(hostId: string, dto: SendWhatsappBatchDto): Promise<WhatsappRecipientDto[]> {
    const unique = new Map<string, WhatsappRecipientDto>();

    for (const recipient of dto.recipients) {
      const normalizedPhone = this.normalizePhone(recipient.phoneNumber);
      if (!unique.has(normalizedPhone)) {
        unique.set(normalizedPhone, recipient);
      }
    }

    const recipients = [...unique.values()];

    if (!dto.eventId || dto.allowResend) {
      return recipients;
    }

    const guestIds = recipients.map((recipient) => recipient.guestId).filter(Boolean);
    const sentGuests = await this.guestModel
      .find({
        _id: { $in: guestIds },
        eventId: new Types.ObjectId(dto.eventId),
        journey: { $elemMatch: { event: 'whatsapp_sent' } },
      })
      .select('_id')
      .lean()
      .exec();
    const sentGuestIds = new Set(sentGuests.map((guest) => String(guest._id)));

    return recipients.filter((recipient) => !recipient.guestId || !sentGuestIds.has(recipient.guestId));
  }

  private async sendBatch(hostId: string, connectionId: string, dto: SendWhatsappBatchDto): Promise<SendBatchResult> {
    const key = this.queueKey(hostId, connectionId);
    const minDelayMs = dto.minDelayMs ?? 2500;
    const maxDelayMs = Math.max(dto.maxDelayMs ?? 5000, minDelayMs + 1000);
    const failed: QueueItem[] = [];
    let sent = 0;
    let skipped = 0;

    for (const [index, recipient] of dto.recipients.entries()) {
      await this.waitWhilePaused(key);

      if (this.cancelRequests.has(key)) {
        skipped += dto.recipients.length - index;
        this.markRemainingSkipped(hostId, connectionId, index, 'Sending was stopped by the user.');
        break;
      }

      this.updateItem(hostId, connectionId, index, { status: 'SENDING' });

      try {
        const message = this.renderMessage(dto.message, recipient);
        await this.whatsappManager.sendMessage(hostId, recipient.phoneNumber, message, connectionId);
        sent += 1;
        this.updateItem(hostId, connectionId, index, { status: 'SENT' });
        await this.recordGuestJourney(recipient.guestId, dto.eventId, 'whatsapp_sent', {
          batchId: this.getQueueState(hostId, connectionId).batchId,
        });
      } catch (error) {
        const reason = this.sanitizeErrorReason(error);
        await this.writeLog(LogLevel.WARN, 'WhatsApp message send failed', {
          connectionId,
          reason,
        }, hostId);

        const failedItem = {
          id: this.getQueueState(hostId, connectionId).items[index]?.id ?? `${index}`,
          fullName: recipient.fullName,
          guestId: recipient.guestId,
          inviteLink: recipient.inviteLink,
          phoneNumber: recipient.phoneNumber,
          reason,
          status: 'FAILED' as QueueItemStatus,
        };
        failed.push(failedItem);
        this.updateItem(hostId, connectionId, index, { reason, status: 'FAILED' });
        await this.recordGuestJourney(recipient.guestId, dto.eventId, 'whatsapp_failed', { reason });
      }

      const isLastMessage = index === dto.recipients.length - 1;
      if (!isLastMessage && !this.cancelRequests.has(key)) {
        await this.sleep(this.randomDelay(minDelayMs, maxDelayMs));
      }
    }

    return {
      failed,
      queued: dto.recipients.length,
      sent,
      skipped,
    };
  }

  private updateItem(hostId: string, connectionId: string, index: number, patch: Partial<QueueItem>) {
    const key = this.queueKey(hostId, connectionId);
    const snapshot = this.snapshots.get(key) ?? this.emptySnapshot();
    const items = snapshot.items.map((item, currentIndex) => currentIndex === index ? { ...item, ...patch } : item);
    const nextSnapshot = {
      ...snapshot,
      items,
      nextRecipient: items.find((item) => item.status === 'QUEUED')?.fullName,
      progress: this.calculateProgress(items),
      status: this.cancelRequests.has(key) ? 'STOPPING' as QueueStatus : snapshot.status,
    };
    this.snapshots.set(key, nextSnapshot);
    this.emitQueueSnapshot(hostId, connectionId, nextSnapshot);
  }

  private markRemainingSkipped(hostId: string, connectionId: string, fromIndex: number, reason: string) {
    const key = this.queueKey(hostId, connectionId);
    const snapshot = this.snapshots.get(key) ?? this.emptySnapshot();
    const items = snapshot.items.map((item, index) => index >= fromIndex && item.status === 'QUEUED'
      ? { ...item, reason, status: 'SKIPPED' as QueueItemStatus }
      : item);
    const nextSnapshot = {
      ...snapshot,
      items,
      progress: this.calculateProgress(items),
      status: 'CANCELLED' as QueueStatus,
    };
    this.snapshots.set(key, nextSnapshot);
    this.emitQueueSnapshot(hostId, connectionId, nextSnapshot);
  }

  private finalizeSnapshot(hostId: string, connectionId: string, result: SendBatchResult) {
    const key = this.queueKey(hostId, connectionId);
    const snapshot = this.snapshots.get(key) ?? this.emptySnapshot();
    const status: QueueStatus = this.cancelRequests.has(key) ? 'CANCELLED' : 'DONE';
    const completedAt = new Date().toISOString();
    const nextSnapshot = {
      ...snapshot,
      completedAt,
      progress: this.calculateProgress(snapshot.items),
      status,
    };
    this.snapshots.set(key, nextSnapshot);
    this.emitQueueSnapshot(hostId, connectionId, nextSnapshot);
    this.cancelRequests.delete(key);
    this.pauseRequests.delete(key);
    this.addHistory(hostId, connectionId, nextSnapshot);
    void this.writeLog(LogLevel.INFO, 'WhatsApp batch finished', {
      failed: result.failed.length,
      queued: result.queued,
      sent: result.sent,
      skipped: result.skipped,
    }, hostId);
  }

  private addHistory(hostId: string, connectionId: string, snapshot: QueueSnapshot) {
    if (!snapshot.batchId || !snapshot.createdAt) {
      return;
    }

    const entry: BatchHistoryEntry = {
      batchId: snapshot.batchId,
      createdAt: snapshot.createdAt,
      eventId: snapshot.eventId,
      failed: snapshot.progress.failed,
      messagePreview: this.sanitizeText((snapshot.messageTemplate ?? '').slice(0, 140)),
      sent: snapshot.progress.sent,
      skipped: snapshot.progress.skipped,
      total: snapshot.progress.total,
    };
    const key = this.queueKey(hostId, connectionId);
    const entries = [entry, ...(this.history.get(key) ?? [])].slice(0, 20);
    this.history.set(key, entries);
  }

  private calculateProgress(items: QueueItem[]) {
    return {
      failed: items.filter((item) => item.status === 'FAILED').length,
      queued: items.filter((item) => item.status === 'QUEUED' || item.status === 'SENDING').length,
      sent: items.filter((item) => item.status === 'SENT').length,
      skipped: items.filter((item) => item.status === 'SKIPPED').length,
      total: items.length,
    };
  }

  private async assertEventBelongsToHost(hostId: string, eventId?: string) {
    if (!eventId) {
      return;
    }

    if (!Types.ObjectId.isValid(eventId)) {
      throw new NotFoundException('Event was not found');
    }

    const event = await this.eventModel
      .findOne({ _id: eventId, hostId: new Types.ObjectId(hostId) })
      .select('_id')
      .lean()
      .exec();

    if (!event) {
      throw new NotFoundException('Event was not found');
    }
  }

  private async recordGuestJourney(guestId: string | undefined, eventId: string | undefined, event: string, meta: Record<string, unknown>) {
    if (!guestId || !eventId || !Types.ObjectId.isValid(guestId) || !Types.ObjectId.isValid(eventId)) {
      return;
    }

    await this.guestModel
      .findOneAndUpdate(
        { _id: guestId, eventId: new Types.ObjectId(eventId) },
        {
          $push: {
            journey: {
              event,
              timestamp: new Date(),
              meta,
            },
          },
        },
      )
      .exec();
  }

  private renderMessage(message: string, recipient: WhatsappRecipientDto) {
    return message
      .replaceAll('{fullName}', recipient.fullName ?? '')
      .replaceAll('{phoneNumber}', recipient.phoneNumber)
      .replaceAll('{inviteLink}', recipient.inviteLink ?? '');
  }

  private normalizePhone(phoneNumber: string) {
    return phoneNumber.replace(/\D/g, '');
  }

  private randomDelay(minDelayMs: number, maxDelayMs: number) {
    return Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
  }

  private sleep(delayMs: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  private async waitWhilePaused(queueKey: string) {
    while (this.pauseRequests.has(queueKey) && !this.cancelRequests.has(queueKey)) {
      await this.sleep(500);
    }
  }

  private assertBatchRateLimit(queueKey: string) {
    const now = Date.now();
    const lastBatchAt = this.lastBatchAtByHost.get(queueKey) ?? 0;

    if (now - lastBatchAt < WhatsappMessageQueueService.MIN_BATCH_INTERVAL_MS) {
      throw new HttpException('Please wait a few seconds before queueing another WhatsApp batch.', HttpStatus.TOO_MANY_REQUESTS);
    }

    this.lastBatchAtByHost.set(queueKey, now);
  }

  private sanitizeErrorReason(error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown send error';
    return this.sanitizeText(message);
  }

  private sanitizeText(value: string) {
    return value.replace(/\+?\d[\d\s().-]{5,}\d/g, '[phone]');
  }

  private maskPhoneNumber(phoneNumber: string) {
    const digits = phoneNumber.replace(/\D/g, '');
    if (digits.length <= 4) {
      return '****';
    }

    return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
  }

  private sanitizeSnapshot(snapshot: QueueSnapshot): QueueSnapshot {
    return {
      ...snapshot,
      messageTemplate: undefined,
      items: snapshot.items.map((item) => ({
        ...item,
        phoneNumber: this.maskPhoneNumber(item.phoneNumber),
      })),
    };
  }

  private emitQueueSnapshot(hostId: string, connectionId: string, snapshot: QueueSnapshot) {
    this.gateway?.emitQueueSnapshot(hostId, connectionId, this.sanitizeSnapshot(snapshot));
  }

  private queueKey(hostId: string, connectionId: string) {
    return `${hostId}:${this.normalizeConnectionId(connectionId)}`;
  }

  private normalizeConnectionId(connectionId = WhatsappManagerService.DEFAULT_CONNECTION_ID) {
    const normalizedConnectionId = connectionId.trim() || WhatsappManagerService.DEFAULT_CONNECTION_ID;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(normalizedConnectionId)) {
      throw new BadRequestException('Invalid WhatsApp connection id');
    }

    return normalizedConnectionId;
  }

  private emptySnapshot(): QueueSnapshot {
    return {
      batchId: null,
      items: [],
      progress: {
        failed: 0,
        queued: 0,
        sent: 0,
        skipped: 0,
        total: 0,
      },
      status: 'IDLE',
    };
  }

  private async writeLog(level: LogLevel, message: string, meta: Record<string, unknown>, hostId: string) {
    try {
      await this.appLogger.write({
        category: 'whatsapp.batch',
        hostId,
        level,
        message,
        meta,
        source: LogSource.BACKEND,
      });
    } catch (error) {
      this.logger.warn(`Failed writing WhatsApp batch log: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
