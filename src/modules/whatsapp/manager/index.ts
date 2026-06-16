import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Client } from 'whatsapp-web.js';
import { Model, Types } from 'mongoose';
import * as QRCode from 'qrcode';
import { Admin, AdminDocument, WhatsappStatus } from '../../admin/schemas';
import { WhatsappGateway } from '../gateway';
import { AdminMongoRemoteAuthStore } from '../session-store';

export type WhatsappClientSnapshot = {
  hostId: string;
  status: WhatsappStatus;
  qrCode: string | null;
};

type ManagedWhatsappClient = {
  client: Client;
  status: WhatsappStatus;
  qrCode: string | null;
  initializing: Promise<WhatsappClientSnapshot> | null;
};

@Injectable()
export class WhatsappManagerService implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsappManagerService.name);
  private readonly clients = new Map<string, ManagedWhatsappClient>();

  constructor(
    @InjectModel(Admin.name) private readonly adminModel: Model<AdminDocument>,
    @Inject(forwardRef(() => WhatsappGateway))
    private readonly gateway?: WhatsappGateway,
  ) {}

  async ensureClient(hostId: string): Promise<WhatsappClientSnapshot> {
    const existing = this.clients.get(hostId);
    if (existing) {
      if (existing.initializing) {
        return existing.initializing;
      }

      return this.snapshot(hostId, existing);
    }

    const admin = await this.adminModel.findById(hostId).exec();
    if (!admin) {
      throw new NotFoundException('Host admin was not found');
    }

    const managed = await this.createManagedClient(hostId);
    this.clients.set(hostId, managed);
    managed.initializing = this.initialize(hostId, managed);

    return managed.initializing;
  }

  async getQrCode(hostId: string): Promise<WhatsappClientSnapshot> {
    return this.ensureClient(hostId);
  }

  async getStatus(hostId: string): Promise<WhatsappClientSnapshot> {
    const managed = this.clients.get(hostId);
    if (managed) {
      return this.snapshot(hostId, managed);
    }

    const admin = await this.adminModel.findById(hostId).select('whatsappSession whatsappStatus').exec();
    if (!admin) {
      throw new NotFoundException('Host admin was not found');
    }

    if (admin.whatsappSession) {
      return this.ensureClient(hostId);
    }

    return {
      hostId,
      status: admin.whatsappStatus,
      qrCode: null,
    };
  }

  async disconnect(hostId: string): Promise<void> {
    const managed = this.clients.get(hostId);
    if (managed) {
      await managed.client.destroy();
      this.clients.delete(hostId);
    }

    await this.adminModel
      .findByIdAndUpdate(hostId, {
        whatsappStatus: WhatsappStatus.DISCONNECTED,
        whatsappSession: null,
      })
      .exec();
  }

  async sendMessage(hostId: string, phoneNumber: string, message: string): Promise<void> {
    const managed = await this.getConnectedClient(hostId);
    await managed.client.sendMessage(this.toChatId(phoneNumber), message);
  }

  async hasWhatsapp(hostId: string, phoneNumber: string): Promise<boolean> {
    const managed = await this.getConnectedClient(hostId);
    return managed.client.isRegisteredUser(this.toChatId(phoneNumber));
  }

  private async getConnectedClient(hostId: string) {
    const existing = this.clients.get(hostId);
    if (!existing) {
      const admin = await this.adminModel.findById(hostId).select('whatsappSession whatsappStatus').lean().exec();
      if (!admin?.whatsappSession) {
        throw new BadRequestException(`WhatsApp client is not connected. Current status: ${admin?.whatsappStatus ?? WhatsappStatus.DISCONNECTED}`);
      }
    }

    const snapshot = await this.ensureClient(hostId);
    const managed = this.clients.get(hostId);

    if (!managed || managed.status !== WhatsappStatus.CONNECTED) {
      throw new BadRequestException(`WhatsApp client is not connected. Current status: ${snapshot.status}`);
    }

    return managed;
  }

  async onModuleDestroy() {
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

  private async createManagedClient(hostId: string): Promise<ManagedWhatsappClient> {
    const { Client, RemoteAuth } = await import('whatsapp-web.js');
    const client = new Client({
      authStrategy: new RemoteAuth({
        clientId: hostId,
        store: new AdminMongoRemoteAuthStore(this.adminModel),
        backupSyncIntervalMs: 300000,
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
    };

    client.on('qr', async (qr: string) => {
      managed.qrCode = await QRCode.toDataURL(qr);
      managed.status = WhatsappStatus.QR_READY;
      await this.persistStatus(hostId, managed.status);
      this.emit(hostId, managed);
    });

    client.on('authenticated', async () => {
      managed.status = WhatsappStatus.CONNECTED;
      managed.qrCode = null;
      await this.persistStatus(hostId, managed.status);
      this.emit(hostId, managed);
    });

    client.on('ready', async () => {
      managed.status = WhatsappStatus.CONNECTED;
      managed.qrCode = null;
      await this.persistStatus(hostId, managed.status);
      this.emit(hostId, managed);
    });

    client.on('remote_session_saved', async () => {
      this.logger.log(`WhatsApp remote session saved for host ${hostId}`);
      await this.persistStatus(hostId, WhatsappStatus.CONNECTED);
    });

    client.on('disconnected', async (reason: string) => {
      this.logger.warn(`WhatsApp host ${hostId} disconnected: ${reason}`);
      managed.status = WhatsappStatus.DISCONNECTED;
      managed.qrCode = null;
      this.clients.delete(hostId);
      await this.persistStatus(hostId, managed.status);
      this.emit(hostId, managed);
    });

    client.on('auth_failure', async (message: string) => {
      this.logger.error(`WhatsApp auth failed for host ${hostId}: ${message}`);
      managed.status = WhatsappStatus.DISCONNECTED;
      managed.qrCode = null;
      this.clients.delete(hostId);
      await this.adminModel
        .findByIdAndUpdate(hostId, {
          whatsappStatus: WhatsappStatus.DISCONNECTED,
          whatsappSession: null,
        })
        .exec();
      this.emit(hostId, managed);
    });

    return managed;
  }

  private async initialize(hostId: string, managed: ManagedWhatsappClient): Promise<WhatsappClientSnapshot> {
    try {
      await managed.client.initialize();
      return this.snapshot(hostId, managed);
    } catch (error) {
      this.logger.error(`WhatsApp initialize failed for host ${hostId}: ${error instanceof Error ? error.message : String(error)}`);
      managed.status = WhatsappStatus.DISCONNECTED;
      managed.qrCode = null;
      this.clients.delete(hostId);
      await this.persistStatus(hostId, managed.status);
      this.emit(hostId, managed);
      throw error;
    } finally {
      managed.initializing = null;
    }
  }

  private async persistStatus(hostId: string, status: WhatsappStatus) {
    if (!Types.ObjectId.isValid(hostId)) {
      throw new NotFoundException('Invalid host id');
    }

    await this.adminModel.findByIdAndUpdate(hostId, { whatsappStatus: status }).exec();
  }

  private snapshot(hostId: string, managed: ManagedWhatsappClient): WhatsappClientSnapshot {
    return {
      hostId,
      status: managed.status,
      qrCode: managed.qrCode,
    };
  }

  private emit(hostId: string, managed: ManagedWhatsappClient) {
    this.gateway?.emitSnapshot(hostId, this.snapshot(hostId, managed));
  }

  private toChatId(phoneNumber: string) {
    const digits = phoneNumber.replace(/\D/g, '');
    const normalized = digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
    return `${normalized}@c.us`;
  }
}
