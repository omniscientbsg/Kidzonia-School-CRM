import path from 'node:path';
import { parseArgs } from 'node:util';
import { backupKey, backupsToPrune, createBackupStore, sha256File } from './backup-store.js';
import { runScript, withScratchDir } from './common.js';
import { loadOpsEnv, required } from './ops-env.js';
import { createPgTools, describeDatabase, tocEntryCount } from './pg-tools.js';

/**
 * Nightly backup: pg_dump (custom format, already compressed) of DATABASE_URL,
 * checked readable with pg_restore --list, uploaded to BACKUP_BUCKET under a
 * timestamped name with its SHA-256, then backups older than BACKUP_KEEP_DAYS
 * are pruned (never the newest).
 *
 *   node apps/api/dist/src/ops/backup.js            (in the image)
 *   pnpm --filter @kidzonia/api ops:backup          (from a checkout)
 *   --no-prune   keep every old backup this time
 */
runScript('backup', async (logger) => {
  const env = loadOpsEnv();
  const source = required(env.DATABASE_URL, 'DATABASE_URL');
  const store = createBackupStore(env);
  const tools = createPgTools(env);
  const { values } = parseArgs({ options: { 'no-prune': { type: 'boolean', default: false } } });
  const prune = !values['no-prune'];
  const now = new Date();
  const key = backupKey(env.BACKUP_PREFIX, now);

  await withScratchDir(async (dir) => {
    const file = path.join(dir, 'backup.dump');
    const started = Date.now();
    logger.info({ source: describeDatabase(source) }, 'Dumping');
    await tools.dump(source, file);
    // A dump that pg_restore can't read is worse than none: it looks like a backup.
    const objects = tocEntryCount(await tools.list(file));
    if (objects === 0) throw new Error('The dump is empty');
    const sha256 = await sha256File(file);
    await store.upload(key, file, sha256);
    logger.info({ key, objects, sha256, ms: Date.now() - started }, 'Backup uploaded');
  });

  if (prune) {
    const old = backupsToPrune(await store.list(), now, env.BACKUP_KEEP_DAYS);
    await store.delete(old);
    logger.info({ pruned: old.length, keepDays: env.BACKUP_KEEP_DAYS }, 'Old backups pruned');
  }
});
