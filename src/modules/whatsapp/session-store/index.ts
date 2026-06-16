import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Model } from 'mongoose';
import { AdminDocument, WhatsappSession } from '../../admin/schemas';

type RemoteAuthStorePayload = {
  session: string;
  path?: string;
};

export class AdminMongoRemoteAuthStore {
  constructor(
    private readonly adminModel: Model<AdminDocument>,
    private readonly dataPath = path.resolve(process.cwd(), '.wwebjs_auth'),
  ) {}

  async sessionExists({ session }: RemoteAuthStorePayload): Promise<boolean> {
    const hostId = this.hostIdFromSession(session);
    const admin = await this.adminModel.findById(hostId).select('whatsappSession').lean().exec();
    return Boolean(this.getArchiveBuffer(admin?.whatsappSession));
  }

  async save({ session }: RemoteAuthStorePayload): Promise<void> {
    const hostId = this.hostIdFromSession(session);
    const archivePath = this.archivePath(session);
    await fs.mkdir(path.dirname(archivePath), { recursive: true });
    const archive = await fs.readFile(archivePath);
    const whatsappSession: WhatsappSession = {
      sessionName: session,
      archive,
      savedAt: new Date(),
    };

    await this.adminModel.findByIdAndUpdate(hostId, { whatsappSession }).exec();
  }

  async extract({ session, path: targetArchivePath }: RemoteAuthStorePayload): Promise<void> {
    const hostId = this.hostIdFromSession(session);
    const admin = await this.adminModel.findById(hostId).select('whatsappSession').lean().exec();
    const archive = this.getArchiveBuffer(admin?.whatsappSession);

    if (!archive) {
      return;
    }

    const targetPath = targetArchivePath ?? this.archivePath(session);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, archive);
  }

  async delete({ session }: RemoteAuthStorePayload): Promise<void> {
    const hostId = this.hostIdFromSession(session);
    await this.adminModel.findByIdAndUpdate(hostId, { whatsappSession: null }).exec();
  }

  private archivePath(session: string) {
    return path.join(this.dataPath, `${session}.zip`);
  }

  private hostIdFromSession(session: string) {
    return session.replace(/^RemoteAuth-/, '');
  }

  private getArchiveBuffer(session?: WhatsappSession | null) {
    const archive = session?.archive as unknown;

    if (!archive) {
      return null;
    }

    if (Buffer.isBuffer(archive)) {
      return archive.length ? archive : null;
    }

    if (archive instanceof Uint8Array) {
      return archive.byteLength ? Buffer.from(archive) : null;
    }

    return null;
  }
}
