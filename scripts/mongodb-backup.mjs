import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildBackupArguments,
  createBackupFileName,
  getRequiredEnvironment,
  runMongoTool,
} from './lib/mongodb-tools.mjs';

const main = async () => {
  const uri = getRequiredEnvironment(process.env, 'MONGODB_URI');
  const backupDirectory = resolve(process.env.MONGODB_BACKUP_DIR?.trim() || 'backups');
  const archivePath = resolve(backupDirectory, createBackupFileName());

  await mkdir(backupDirectory, { recursive: true });
  process.stdout.write(`[backup] Creating compressed MongoDB archive in ${backupDirectory}\n`);
  await runMongoTool('mongodump', buildBackupArguments(uri, archivePath));

  const archive = await stat(archivePath);
  if (!archive.isFile() || archive.size === 0) {
    throw new Error('mongodump completed without creating a non-empty archive');
  }

  process.stdout.write(`[backup] Completed ${archivePath} (${archive.size} bytes)\n`);
};

void main().catch((cause) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  process.stderr.write(`[backup] Failed: ${message}\n`);
  process.exitCode = 1;
});
