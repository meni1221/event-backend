import { spawn } from 'node:child_process';

export const getRequiredEnvironment = (environment, key) => {
  const value = environment[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }

  return value;
};

export const createBackupFileName = (date = new Date()) =>
  `ishru-${date.toISOString().replace(/[:.]/g, '-')}.archive.gz`;

export const runMongoTool = (binary, args, spawnTool = spawn) => new Promise((resolve, reject) => {
  const child = spawnTool(binary, args, {
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  });

  child.once('error', (cause) => {
    reject(new Error(`Could not start ${binary}. Install MongoDB Database Tools and add them to PATH.`, { cause }));
  });
  child.once('exit', (code, signal) => {
    if (code === 0) {
      resolve();
      return;
    }

    reject(new Error(`${binary} failed${signal ? ` with signal ${signal}` : ` with exit code ${code ?? 'unknown'}`}`));
  });
});

export const buildBackupArguments = (uri, archivePath) => [
  `--uri=${uri}`,
  `--archive=${archivePath}`,
  '--gzip',
];
