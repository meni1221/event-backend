import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Client } from 'whatsapp-web.js';
import { Model, Types } from 'mongoose';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import * as path from 'node:path';
import * as QRCode from 'qrcode';
import { Admin, AdminDocument, WhatsappConnection, WhatsappStatus } from '../../admin/schemas';
import { LogLevel, LogSource } from '../../logs/schemas';
import { AppLoggerService } from '../../logs/service';
import { WhatsappGateway } from '../gateway';

export type WhatsappClientSnapshot = {
  connectionId: string;
  displayName: string;
  hostId: string;
  status: WhatsappStatus;
  qrCode: string | null;
};

type ManagedWhatsappClient = {
  client: Client;
  status: WhatsappStatus;
  qrCode: string | null;
  initializing: Promise<WhatsappClientSnapshot> | null;
  waitForFirstSnapshot: (() => Promise<WhatsappClientSnapshot>) | null;
};

@Injectable()
export class WhatsappManagerService implements OnModuleDestroy, OnModuleInit {
  static readonly DEFAULT_CONNECTION_ID = 'default';
  private static readonly STATUS_REFRESH_INTERVAL_MS = 60000;
  private readonly logger = new Logger(WhatsappManagerService.name);
  private readonly clients = new Map<string, ManagedWhatsappClient>();
  private statusRefreshInterval: NodeJS.Timeout | null = null;

  constructor(
    @InjectModel(Admin.name) private readonly adminModel: Model<AdminDocument>,
    private readonly appLogger: AppLoggerService,
    @Inject(forwardRef(() => WhatsappGateway))
    private readonly gateway?: WhatsappGateway,
  ) {}

  onModuleInit() {
    void this.restoreSavedClients();
    this.statusRefreshInterval = setInterval(() => {
      void this.refreshManagedClientStatuses();
    }, WhatsappManagerService.STATUS_REFRESH_INTERVAL_MS);
  }

  async ensureClient(hostId: string, connectionId = WhatsappManagerService.DEFAULT_CONNECTION_ID, displayName = ''): Promise<WhatsappClientSnapshot> {
    const normalizedConnectionId = this.normalizeConnectionId(connectionId);
    const key = this.clientKey(hostId, normalizedConnectionId);
    const existing = this.clients.get(key);
    if (existing) {
      if (existing.initializing) {
        return existing.waitForFirstSnapshot
          ? Promise.race([existing.waitForFirstSnapshot(), existing.initializing])
          : existing.initializing;
      }

      if (existing.status === WhatsappStatus.DISCONNECTED && !existing.qrCode) {
        await existing.client.destroy().catch((error) => {
          this.logger.warn(`Failed destroying stale WhatsApp client: ${error instanceof Error ? error.message : String(error)}`);
        });
        this.clients.delete(key);
      } else {
      return this.snapshot(hostId, normalizedConnectionId, displayName, existing);
      }
    }

    const admin = await this.adminModel.findById(hostId).exec();
    if (!admin) {
      throw new NotFoundException('Host admin was not found');
    }

    const persistedConnection = this.findConnection(admin.whatsappConnections, normalizedConnectionId);
    const resolvedDisplayName = displayName.trim() || persistedConnection?.displayName || this.defaultDisplayName(normalizedConnectionId);
    const managed = await this.createManagedClient(hostId, normalizedConnectionId, resolvedDisplayName);
    this.clients.set(key, managed);
    managed.initializing = this.initialize(hostId, normalizedConnectionId, resolvedDisplayName, managed);

    return managed.waitForFirstSnapshot
      ? Promise.race([managed.waitForFirstSnapshot(), managed.initializing])
      : managed.initializing;
  }

  async getQrCode(hostId: string, connectionId?: string): Promise<WhatsappClientSnapshot> {
    const normalizedConnectionId = this.normalizeConnectionId(connectionId);
    const managed = this.clients.get(this.clientKey(hostId, normalizedConnectionId));
    if (managed?.status === WhatsappStatus.QR_READY && managed.qrCode) {
      return this.snapshot(hostId, normalizedConnectionId, this.defaultDisplayName(normalizedConnectionId), managed);
    }

    return this.resetClient(hostId, normalizedConnectionId);
  }

  async resetClient(hostId: string, connectionId = WhatsappManagerService.DEFAULT_CONNECTION_ID): Promise<WhatsappClientSnapshot> {
    const normalizedConnectionId = this.normalizeConnectionId(connectionId);
    await this.disconnect(hostId, normalizedConnectionId, true);
    return this.ensureClient(hostId, normalizedConnectionId);
  }

  async getStatus(hostId: string, connectionId = WhatsappManagerService.DEFAULT_CONNECTION_ID): Promise<WhatsappClientSnapshot> {
    const normalizedConnectionId = this.normalizeConnectionId(connectionId);
    const managed = this.clients.get(this.clientKey(hostId, normalizedConnectionId));
    if (managed) {
      return this.snapshot(hostId, normalizedConnectionId, this.defaultDisplayName(normalizedConnectionId), managed);
    }

    const admin = await this.adminModel.findById(hostId).select('whatsappConnections whatsappSession whatsappStatus').exec();
    if (!admin) {
      throw new NotFoundException('Host admin was not found');
    }

    const connection = this.findConnection(admin.whatsappConnections, normalizedConnectionId);
    const persistedStatus = this.getInactivePersistedStatus(hostId, admin, connection, normalizedConnectionId);
    return {
      connectionId: normalizedConnectionId,
      displayName: connection?.displayName || this.defaultDisplayName(normalizedConnectionId),
      hostId,
      status: persistedStatus,
      qrCode: null,
    };
  }

  async disconnect(hostId: string, connectionId = WhatsappManagerService.DEFAULT_CONNECTION_ID, removeLocalSession = false): Promise<void> {
    const normalizedConnectionId = this.normalizeConnectionId(connectionId);
    const key = this.clientKey(hostId, normalizedConnectionId);
    const managed = this.clients.get(key);
    if (managed) {
      await managed.client.destroy().catch((error) => {
        this.logger.warn(`Failed destroying WhatsApp client for host ${hostId}, connection ${normalizedConnectionId}: ${error instanceof Error ? error.message : String(error)}`);
      });
      this.clients.delete(key);
    }

    await this.adminModel
      .findByIdAndUpdate(hostId, {
        $pull: { whatsappConnections: { connectionId: normalizedConnectionId } },
        ...(normalizedConnectionId === WhatsappManagerService.DEFAULT_CONNECTION_ID ? { whatsappStatus: WhatsappStatus.DISCONNECTED, whatsappSession: null } : {}),
      })
      .exec();

    if (removeLocalSession) {
      await rm(this.localAuthSessionPath(hostId, normalizedConnectionId), { force: true, recursive: true }).catch((error) => {
        this.logger.warn(`Failed removing WhatsApp local session for host ${hostId}, connection ${normalizedConnectionId}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  async sendMessage(hostId: string, phoneNumber: string, message: string, connectionId?: string): Promise<void> {
    const managed = await this.getConnectedClient(hostId, connectionId);
    const normalizedConnectionId = this.normalizeConnectionId(connectionId);
    const chatId = await this.resolveChatId(managed.client, phoneNumber);
    const sentMessage = await managed.client.sendMessage(chatId, message);
    await this.writeLog(LogLevel.INFO, 'WhatsApp message sent', {
      connectionId: normalizedConnectionId,
      messageAck: sentMessage.ack,
    }, hostId);
  }

  async hasWhatsapp(hostId: string, phoneNumber: string, connectionId?: string): Promise<boolean> {
    const managed = await this.getConnectedClient(hostId, connectionId);
    return Boolean(await this.getNumberId(managed.client, phoneNumber));
  }

  private async getConnectedClient(hostId: string, connectionId = WhatsappManagerService.DEFAULT_CONNECTION_ID) {
    const normalizedConnectionId = this.normalizeConnectionId(connectionId);
    const existing = this.clients.get(this.clientKey(hostId, normalizedConnectionId));
    if (!existing) {
      const admin = await this.adminModel.findById(hostId).select('whatsappConnections whatsappSession whatsappStatus').lean().exec();
      const connection = this.findConnection(admin?.whatsappConnections, normalizedConnectionId);
      const hasSession = this.hasSavedSession(hostId, normalizedConnectionId, admin, connection);
      if (!hasSession) {
        throw new BadRequestException(`WhatsApp connection ${normalizedConnectionId} has no saved session. Reconnect WhatsApp by scanning the QR code before sending messages.`);
      }
    }

    const snapshot = await this.ensureClient(hostId, normalizedConnectionId);
    const managed = this.clients.get(this.clientKey(hostId, normalizedConnectionId));

    if (!managed || managed.status !== WhatsappStatus.CONNECTED) {
      throw new BadRequestException(`WhatsApp connection ${normalizedConnectionId} is not connected. Current status: ${snapshot.status}`);
    }

    return managed;
  }

  async onModuleDestroy() {
    if (this.statusRefreshInterval) {
      clearInterval(this.statusRefreshInterval);
      this.statusRefreshInterval = null;
    }

    await Promise.all(
      [...this.clients.values()].map(async (managed) => {
        try {
          await managed.client.destroy();
        } catch (error) {
          this.logger.warn(`Failed destroying WhatsApp client: ${(error as Error).message}`);
        }
      }),
    );
  }

  private async restoreSavedClients() {
    const admins = await this.adminModel
      .find({ whatsappConnections: { $exists: true, $ne: [] } })
      .select('whatsappConnections')
      .lean()
      .exec();

    await Promise.allSettled(
      admins.flatMap((admin) => {
        const hostId = String(admin._id);
        return (admin.whatsappConnections ?? [])
          .filter((connection) => connection.status === WhatsappStatus.CONNECTED && this.localSessionExists(hostId, connection.connectionId))
          .map(async (connection) => {
            try {
              await this.ensureClient(hostId, connection.connectionId, connection.displayName);
              await this.writeLog(LogLevel.INFO, 'WhatsApp saved session restored', {
                connectionId: connection.connectionId,
                displayName: connection.displayName,
              }, hostId);
            } catch (error) {
              await this.persistStatus(hostId, connection.connectionId, connection.displayName, WhatsappStatus.DISCONNECTED);
              await this.writeLog(LogLevel.WARN, 'WhatsApp saved session restore failed', {
                connectionId: connection.connectionId,
                displayName: connection.displayName,
                reason: error instanceof Error ? error.message : String(error),
              }, hostId);
            }
          });
      }),
    );
  }

  private async refreshManagedClientStatuses() {
    await Promise.allSettled(
      [...this.clients.entries()].map(async ([key, managed]) => {
        const [hostId, connectionId] = key.split(':');
        if (!hostId || !connectionId || managed.initializing) {
          return;
        }

        try {
          const state = await managed.client.getState();
          if (state === 'CONNECTED') {
            if (managed.status !== WhatsappStatus.CONNECTED) {
              managed.status = WhatsappStatus.CONNECTED;
              await this.persistStatus(hostId, connectionId, this.defaultDisplayName(connectionId), managed.status);
              this.emit(hostId, connectionId, this.defaultDisplayName(connectionId), managed);
            }
            return;
          }

          managed.status = WhatsappStatus.DISCONNECTED;
          managed.qrCode = null;
          await this.persistStatus(hostId, connectionId, this.defaultDisplayName(connectionId), managed.status);
          this.emit(hostId, connectionId, this.defaultDisplayName(connectionId), managed);
        } catch (error) {
          managed.status = WhatsappStatus.DISCONNECTED;
          managed.qrCode = null;
          await this.persistStatus(hostId, connectionId, this.defaultDisplayName(connectionId), managed.status);
          await this.writeLog(LogLevel.WARN, 'WhatsApp status refresh failed', {
            connectionId,
            reason: error instanceof Error ? error.message : String(error),
          }, hostId);
          this.emit(hostId, connectionId, this.defaultDisplayName(connectionId), managed);
        }
      }),
    );
  }

  private async createManagedClient(hostId: string, connectionId: string, displayName: string): Promise<ManagedWhatsappClient> {
    const { Client, LocalAuth } = await import('whatsapp-web.js');
    const clientId = this.authClientId(hostId, connectionId);
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId,
        dataPath: this.authDataPath(),
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run'],
      },
    });

    const managed: ManagedWhatsappClient = {
      client,
      status: WhatsappStatus.DISCONNECTED,
      qrCode: null,
      initializing: null,
      waitForFirstSnapshot: null,
    };

    managed.waitForFirstSnapshot = this.createFirstSnapshotWaiter(hostId, connectionId, displayName, managed);

    client.on('qr', async (qr: string) => {
      try {
        managed.qrCode = await QRCode.toDataURL(qr);
        managed.status = WhatsappStatus.QR_READY;
        await this.persistStatus(hostId, connectionId, displayName, managed.status);
        await this.writeLog(LogLevel.INFO, 'WhatsApp QR code is ready', { connectionId, displayName }, hostId);
        this.emit(hostId, connectionId, displayName, managed);
      } catch (error) {
        this.logger.error(`Failed handling WhatsApp QR event for host ${hostId}, connection ${connectionId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    client.on('authenticated', async () => {
      try {
        managed.status = WhatsappStatus.CONNECTED;
        managed.qrCode = null;
        await this.persistStatus(hostId, connectionId, displayName, managed.status);
        await this.writeLog(LogLevel.INFO, 'WhatsApp client authenticated', { connectionId, displayName }, hostId);
        this.emit(hostId, connectionId, displayName, managed);
      } catch (error) {
        this.logger.error(`Failed handling WhatsApp authenticated event for host ${hostId}, connection ${connectionId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    client.on('ready', async () => {
      try {
        managed.status = WhatsappStatus.CONNECTED;
        managed.qrCode = null;
        await this.persistStatus(hostId, connectionId, displayName, managed.status);
        await this.writeLog(LogLevel.INFO, 'WhatsApp client is ready', { connectionId, displayName }, hostId);
        this.emit(hostId, connectionId, displayName, managed);
      } catch (error) {
        this.logger.error(`Failed handling WhatsApp ready event for host ${hostId}, connection ${connectionId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    client.on('disconnected', async (reason: string) => {
      try {
        this.logger.warn(`WhatsApp host ${hostId}, connection ${connectionId} disconnected: ${reason}`);
        managed.status = WhatsappStatus.DISCONNECTED;
        managed.qrCode = null;
        this.clients.delete(this.clientKey(hostId, connectionId));
        await this.persistStatus(hostId, connectionId, displayName, managed.status);
        await this.writeLog(LogLevel.WARN, 'WhatsApp client disconnected', { connectionId, displayName, reason }, hostId);
        this.emit(hostId, connectionId, displayName, managed);
      } catch (error) {
        this.logger.error(`Failed handling WhatsApp disconnected event for host ${hostId}, connection ${connectionId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    client.on('auth_failure', async (message: string) => {
      try {
        this.logger.error(`WhatsApp auth failed for host ${hostId}, connection ${connectionId}: ${message}`);
        managed.status = WhatsappStatus.DISCONNECTED;
        managed.qrCode = null;
        this.clients.delete(this.clientKey(hostId, connectionId));
        await this.disconnect(hostId, connectionId);
        await this.writeLog(LogLevel.ERROR, 'WhatsApp authentication failed', { connectionId, displayName, reason: message }, hostId);
        this.emit(hostId, connectionId, displayName, managed);
      } catch (error) {
        this.logger.error(`Failed handling WhatsApp auth failure event for host ${hostId}, connection ${connectionId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    return managed;
  }

  private async initialize(hostId: string, connectionId: string, displayName: string, managed: ManagedWhatsappClient): Promise<WhatsappClientSnapshot> {
    try {
      await managed.client.initialize();
      return this.snapshot(hostId, connectionId, displayName, managed);
    } catch (error) {
      this.logger.error(`WhatsApp initialize failed for host ${hostId}, connection ${connectionId}: ${error instanceof Error ? error.message : String(error)}`);
      managed.status = WhatsappStatus.DISCONNECTED;
      managed.qrCode = null;
      this.clients.delete(this.clientKey(hostId, connectionId));
      await this.persistStatus(hostId, connectionId, displayName, managed.status);
      await this.writeLog(LogLevel.ERROR, 'WhatsApp initialize failed', {
        connectionId,
        displayName,
        reason: error instanceof Error ? error.message : String(error),
      }, hostId);
      this.emit(hostId, connectionId, displayName, managed);
      throw error;
    } finally {
      managed.initializing = null;
      managed.waitForFirstSnapshot = null;
    }
  }

  private createFirstSnapshotWaiter(hostId: string, connectionId: string, displayName: string, managed: ManagedWhatsappClient) {
    return () =>
      new Promise<WhatsappClientSnapshot>((resolve) => {
        const interval = setInterval(() => {
          if (managed.status === WhatsappStatus.QR_READY || managed.status === WhatsappStatus.CONNECTED) {
            clearInterval(interval);
            resolve(this.snapshot(hostId, connectionId, displayName, managed));
          }
        }, 250);
      });
  }

  private async persistStatus(hostId: string, connectionId: string, displayName: string, status: WhatsappStatus) {
    if (!Types.ObjectId.isValid(hostId)) {
      throw new NotFoundException('Invalid host id');
    }

    const updateExisting = await this.adminModel
      .findOneAndUpdate(
        { _id: hostId, 'whatsappConnections.connectionId': connectionId },
        {
          $set: {
            'whatsappConnections.$.displayName': displayName,
            'whatsappConnections.$.status': status,
            ...(connectionId === WhatsappManagerService.DEFAULT_CONNECTION_ID ? { whatsappStatus: status } : {}),
          },
        },
      )
      .exec();

    if (updateExisting) {
      return;
    }

    await this.adminModel
      .findByIdAndUpdate(hostId, {
        $push: {
          whatsappConnections: {
            connectionId,
            displayName,
            sessionName: this.localAuthSessionName(hostId, connectionId),
            archive: Buffer.alloc(0),
            savedAt: new Date(),
            status,
          },
        },
        ...(connectionId === WhatsappManagerService.DEFAULT_CONNECTION_ID ? { whatsappStatus: status } : {}),
      })
      .exec();
  }

  private snapshot(hostId: string, connectionId: string, displayName: string, managed: ManagedWhatsappClient): WhatsappClientSnapshot {
    return {
      connectionId,
      displayName,
      hostId,
      status: managed.status,
      qrCode: managed.qrCode,
    };
  }

  private emit(hostId: string, connectionId: string, displayName: string, managed: ManagedWhatsappClient) {
    this.gateway?.emitSnapshot(hostId, this.snapshot(hostId, connectionId, displayName, managed));
  }

  private toChatId(phoneNumber: string) {
    const digits = phoneNumber.replace(/\D/g, '');
    const normalized = this.toWhatsappDigits(digits);
    return `${normalized}@c.us`;
  }

  private async resolveChatId(client: Client, phoneNumber: string) {
    const numberId = await this.getNumberId(client, phoneNumber);

    if (!numberId?._serialized) {
      throw new BadRequestException('Recipient phone number is not registered on WhatsApp');
    }

    return numberId._serialized;
  }

  private async getNumberId(client: Client, phoneNumber: string) {
    const digits = phoneNumber.replace(/\D/g, '');
    const normalized = this.toWhatsappDigits(digits);
    return client.getNumberId(normalized);
  }

  private toWhatsappDigits(digits: string) {
    if (digits.startsWith('00972')) {
      const localDigits = digits.slice(5);
      return `972${localDigits.startsWith('0') ? localDigits.slice(1) : localDigits}`;
    }

    if (digits.startsWith('972')) {
      const localDigits = digits.slice(3);
      return `972${localDigits.startsWith('0') ? localDigits.slice(1) : localDigits}`;
    }

    if (digits.startsWith('0')) {
      return `972${digits.slice(1)}`;
    }

    if (digits.length === 9 && digits.startsWith('5')) {
      return `972${digits}`;
    }

    return digits;
  }

  private clientKey(hostId: string, connectionId: string) {
    return `${hostId}:${connectionId}`;
  }

  private defaultDisplayName(connectionId: string) {
    return connectionId === WhatsappManagerService.DEFAULT_CONNECTION_ID ? 'Main WhatsApp' : connectionId;
  }

  private findConnection(connections: WhatsappConnection[] | undefined | null, connectionId: string) {
    return connections?.find((connection) => connection.connectionId === connectionId) ?? null;
  }

  private hasArchive(connection: { archive?: Buffer | Uint8Array | null } | undefined | null) {
    const archive = connection?.archive;
    if (!archive) {
      return false;
    }

    return Buffer.isBuffer(archive) ? archive.length > 0 : archive.byteLength > 0;
  }

  private hasSavedSession(
    hostId: string,
    connectionId: string,
    admin?: Pick<Admin, 'whatsappSession'> | null,
    connection?: WhatsappConnection | undefined | null,
  ) {
    return this.localSessionExists(hostId, connectionId)
      || this.hasArchive(connection)
      || (connectionId === WhatsappManagerService.DEFAULT_CONNECTION_ID && this.hasArchive(admin?.whatsappSession));
  }

  private localSessionExists(hostId: string, connectionId: string) {
    return existsSync(this.localAuthSessionPath(hostId, connectionId));
  }

  private getInactivePersistedStatus(
    hostId: string,
    admin: Pick<Admin, 'whatsappSession' | 'whatsappStatus'>,
    connection: WhatsappConnection | undefined | null,
    connectionId: string,
  ) {
    const status = connection?.status ?? (connectionId === WhatsappManagerService.DEFAULT_CONNECTION_ID ? admin.whatsappStatus : WhatsappStatus.DISCONNECTED);
    const hasSession = this.hasSavedSession(hostId, connectionId, admin, connection);

    if (!hasSession && status === WhatsappStatus.CONNECTED) {
      return WhatsappStatus.DISCONNECTED;
    }

    return status;
  }

  private normalizeConnectionId(connectionId = WhatsappManagerService.DEFAULT_CONNECTION_ID) {
    const normalizedConnectionId = connectionId.trim() || WhatsappManagerService.DEFAULT_CONNECTION_ID;
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(normalizedConnectionId)) {
      throw new BadRequestException('Invalid WhatsApp connection id');
    }

    return normalizedConnectionId;
  }

  private authDataPath() {
    return path.resolve(__dirname, '../../../../.wwebjs_auth');
  }

  private authClientId(hostId: string, connectionId: string) {
    return `${hostId}_${connectionId}`;
  }

  private localAuthSessionName(hostId: string, connectionId: string) {
    return `session-${this.authClientId(hostId, connectionId)}`;
  }

  private localAuthSessionPath(hostId: string, connectionId: string) {
    return path.join(this.authDataPath(), this.localAuthSessionName(hostId, connectionId));
  }

  private async writeLog(level: LogLevel, message: string, meta: Record<string, unknown>, hostId: string) {
    try {
      await this.appLogger.write({
        category: 'whatsapp.connection',
        hostId,
        level,
        message,
        meta,
        source: LogSource.BACKEND,
      });
    } catch (error) {
      this.logger.warn(`Failed writing WhatsApp connection log: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
