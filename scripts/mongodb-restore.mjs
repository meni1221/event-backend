import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildRestoreArguments,
  getRequiredEnvironment,
  parseRestoreOptions,
  runMongoTool,
} from './lib/mongodb-tools.mjs';

const main = async () => {
  const uri = getRequiredEnvironment(process.env, 'MONGODB_URI');
  const options = parseRestoreOptions(process.argv.slice(2));
  const archivePath = resolve(options.archive);
  const archive = await stat(archivePath);
  if (!archive.isFile() || archive.size === 0) {
    throw new Error('The restore archive must be a non-empty file');
  }

  const mode = options.execute ? 'EXECUTE' : 'DRY RUN';
  process.stdout.write(`[restore] ${mode} using ${archivePath}\n`);
  await runMongoTool('mongorestore', buildRestoreArguments(uri, archivePath, options.execute));
  process.stdout.write(`[restore] ${mode} completed successfully\n`);
};

void main().catch((cause) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  process.stderr.write(`[restore] Failed: ${message}\n`);
  process.exitCode = 1;
});
