import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AdminMongoRemoteAuthStore } from './index';

type StoredSession = {
  sessionName: string;
  archive: Buffer;
  savedAt: Date;
} | null;

const createAdminModelMock = () => {
  const sessions = new Map<string, StoredSession>();

  return {
    sessions,
    model: {
      findById: jest.fn((hostId: string) => ({
        select: jest.fn(() => ({
          lean: jest.fn(() => ({
            exec: jest.fn(async () => ({ whatsappSession: sessions.get(hostId) ?? null })),
          })),
          exec: jest.fn(async () => ({ whatsappSession: sessions.get(hostId) ?? null })),
        })),
      })),
      findByIdAndUpdate: jest.fn((hostId: string, update: { whatsappSession?: StoredSession }) => ({
        exec: jest.fn(async () => {
          if ('whatsappSession' in update) {
            sessions.set(hostId, update.whatsappSession ?? null);
          }
        }),
      })),
    },
  };
};

describe('AdminMongoRemoteAuthStore', () => {
  let dataPath: string;

  beforeEach(async () => {
    dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'whatsapp-session-store-'));
  });

  afterEach(async () => {
    await fs.rm(dataPath, { recursive: true, force: true });
  });

  it('stores separate WhatsApp sessions for different hosts', async () => {
    const { model, sessions } = createAdminModelMock();
    const store = new AdminMongoRemoteAuthStore(model as never, dataPath);
    const firstSession = 'RemoteAuth-host-one';
    const secondSession = 'RemoteAuth-host-two';
    const firstArchive = Buffer.from('first-whatsapp-session');
    const secondArchive = Buffer.from('second-whatsapp-session');

    await fs.writeFile(path.join(dataPath, `${firstSession}.zip`), firstArchive);
    await fs.writeFile(path.join(dataPath, `${secondSession}.zip`), secondArchive);

    await store.save({ session: firstSession });
    await store.save({ session: secondSession });

    expect(sessions.get('host-one')?.archive).toEqual(firstArchive);
    expect(sessions.get('host-two')?.archive).toEqual(secondArchive);
    expect(await store.sessionExists({ session: firstSession })).toBe(true);
    expect(await store.sessionExists({ session: secondSession })).toBe(true);

    const extractedFirst = path.join(dataPath, 'extract', `${firstSession}.zip`);
    const extractedSecond = path.join(dataPath, 'extract', `${secondSession}.zip`);

    await store.extract({ session: firstSession, path: extractedFirst });
    await store.extract({ session: secondSession, path: extractedSecond });

    await expect(fs.readFile(extractedFirst)).resolves.toEqual(firstArchive);
    await expect(fs.readFile(extractedSecond)).resolves.toEqual(secondArchive);
  });

  it('deletes only the requested host session', async () => {
    const { model } = createAdminModelMock();
    const store = new AdminMongoRemoteAuthStore(model as never, dataPath);
    const firstSession = 'RemoteAuth-host-one';
    const secondSession = 'RemoteAuth-host-two';

    await fs.writeFile(path.join(dataPath, `${firstSession}.zip`), Buffer.from('first'));
    await fs.writeFile(path.join(dataPath, `${secondSession}.zip`), Buffer.from('second'));
    await store.save({ session: firstSession });
    await store.save({ session: secondSession });

    await store.delete({ session: firstSession });

    expect(await store.sessionExists({ session: firstSession })).toBe(false);
    expect(await store.sessionExists({ session: secondSession })).toBe(true);
  });
});
