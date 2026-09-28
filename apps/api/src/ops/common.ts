import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../lib/logger.js';
import type { Logger } from '../lib/logger.js';
import { scrubText } from '../lib/scrub.js';
import type { BackupStore } from './backup-store.js';
import type { PgTools } from './pg-tools.js';
import { describeDatabase, restorableList, tocEntryCount, userTableCount } from './pg-tools.js';

/**
 * A private scratch folder for one run, always removed afterwards: dumps hold
 * every parent's phone number and must not linger on the host.
 */
export async function withScratchDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kz-ops-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Runs a script's main function: JSON logs, a non-zero exit on any failure
 * (so cron, CI and the release pipeline notice), and scrubbed error text.
 */
export function runScript(name: string, main: (logger: Logger) => Promise<void>): void {
  const logger = createLogger(process.env.LOG_LEVEL ?? 'info').child({ script: name });
  main(logger).then(
    () => process.exit(0),
    (err: unknown) => {
      logger.error(
        { err: err instanceof Error ? err : new Error(scrubText(String(err))) },
        'Failed',
      );
      process.exit(1);
    },
  );
}

/** The API package folder (where prisma.config.ts lives), from source or from dist. */
export function apiRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, 'prisma.config.ts'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Could not find the API folder (prisma.config.ts)');
}

/**
 * Downloads a backup and restores it into an empty database. Stops at the
 * first error; a partial restore is never reported as success.
 */
export async function restoreBackup(options: {
  store: BackupStore;
  tools: PgTools;
  key: string;
  targetUrl: string;
  logger: Logger;
}): Promise<{ objects: number }> {
  const { store, tools, key, targetUrl, logger } = options;
  const tables = await userTableCount(targetUrl);
  if (tables > 0) {
    throw new Error(
      `${describeDatabase(targetUrl)} already has ${tables} tables; restore only into an empty database`,
    );
  }
  return withScratchDir(async (dir) => {
    const dump = path.join(dir, 'restore.dump');
    const list = path.join(dir, 'restore.list');
    logger.info({ key }, 'Downloading backup');
    await store.download(key, dump);
    const toc = await tools.list(dump);
    await writeFile(list, restorableList(toc), { mode: 0o600 });
    logger.info({ target: describeDatabase(targetUrl), objects: tocEntryCount(toc) }, 'Restoring');
    await tools.restore(targetUrl, dump, list);
    return { objects: tocEntryCount(toc) };
  });
}
