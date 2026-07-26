import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildBackupArguments,
  buildRestoreArguments,
  createBackupFileName,
  getRequiredEnvironment,
  parseRestoreOptions,
} from './mongodb-tools.mjs';

describe('MongoDB recovery tools', () => {
  it('requires configured environment values without exposing them', () => {
    assert.equal(getRequiredEnvironment({ MONGODB_URI: ' mongodb://localhost/ishru ' }, 'MONGODB_URI'), 'mongodb://localhost/ishru');
    assert.throws(() => getRequiredEnvironment({}, 'MONGODB_URI'), /MONGODB_URI is required/);
  });

  it('creates filesystem-safe timestamped archive names', () => {
    assert.equal(
      createBackupFileName(new Date('2026-07-26T12:34:56.789Z')),
      'ishru-2026-07-26T12-34-56-789Z.archive.gz',
    );
  });

  it('builds compressed archive backup arguments', () => {
    assert.deepEqual(buildBackupArguments('mongodb://database/ishru', 'backup.archive.gz'), [
      '--uri=mongodb://database/ishru',
      '--archive=backup.archive.gz',
      '--gzip',
    ]);
  });

  it('defaults restore operations to dry-run mode', () => {
    assert.deepEqual(parseRestoreOptions(['--archive=backup.archive.gz']), {
      archive: 'backup.archive.gz',
      execute: false,
    });
    const args = buildRestoreArguments('mongodb://database/ishru', 'backup.archive.gz', false);
    assert.ok(args.includes('--dryRun'));
    assert.ok(!args.includes('--drop'));
  });

  it('requires explicit confirmation before a destructive restore', () => {
    assert.throws(
      () => parseRestoreOptions(['--archive=backup.archive.gz', '--execute']),
      /--confirm=RESTORE/,
    );

    assert.deepEqual(
      parseRestoreOptions(['--archive=backup.archive.gz', '--execute', '--confirm=RESTORE']),
      { archive: 'backup.archive.gz', execute: true },
    );
  });

  it('uses drop and stop-on-error only for an approved restore', () => {
    const args = buildRestoreArguments('mongodb://database/ishru', 'backup.archive.gz', true);

    assert.ok(args.includes('--drop'));
    assert.ok(args.includes('--stopOnError'));
    assert.ok(!args.includes('--dryRun'));
  });
});
