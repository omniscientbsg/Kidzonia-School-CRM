import { parseArgs } from 'node:util';
import { chooseBackup, createBackupStore, sortBackups } from './backup-store.js';
import { restoreBackup, runScript } from './common.js';
import { loadOpsEnv } from './ops-env.js';
import { createPgTools, describeDatabase, recreateDatabase, sameDatabase } from './pg-tools.js';

/**
 * Restores a backup into another database, for restore drills and disaster
 * recovery.
 *
 *   restore --target <postgres url> [--backup latest|<name>] [--recreate]
 *           [--i-know-this-is-production]
 *
 * --target     where to restore (or RESTORE_TARGET_URL). Must be empty, unless
 * --recreate   drops and creates it first (needs CREATEDB rights).
 * --backup     "latest" (default), a file name, or a full key; `--list` shows them.
 * The target may not be DATABASE_URL (the live database) unless
 * --i-know-this-is-production is given as well.
 */
runScript('restore', async (logger) => {
  const { values } = parseArgs({
    options: {
      target: { type: 'string' },
      backup: { type: 'string', default: 'latest' },
      recreate: { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
      'i-know-this-is-production': { type: 'boolean', default: false },
    },
  });
  const env = loadOpsEnv();
  const store = createBackupStore(env);

  if (values.list) {
    for (const b of sortBackups(await store.list())) {
      logger.info({ key: b.key, takenAt: b.at.toISOString() }, 'Backup');
    }
    return;
  }

  const target = values.target ?? process.env.RESTORE_TARGET_URL;
  if (!target) throw new Error('Give --target <postgres url> (or RESTORE_TARGET_URL)');
  if (
    env.DATABASE_URL &&
    sameDatabase(target, env.DATABASE_URL) &&
    !values['i-know-this-is-production']
  ) {
    throw new Error(
      'The target is DATABASE_URL, the live database. Restore into a new database and switch ' +
        'the app over, or add --i-know-this-is-production if you really mean it.',
    );
  }

  const key = await chooseBackup(store, env.BACKUP_PREFIX, values.backup);
  if (values.recreate) {
    logger.warn({ target: describeDatabase(target) }, 'Dropping and recreating the target');
    await recreateDatabase(target, env.PG_MAINTENANCE_DB);
  }
  const started = Date.now();
  const { objects } = await restoreBackup({
    store,
    tools: createPgTools(env),
    key,
    targetUrl: target,
    logger,
  });
  logger.info({ key, objects, ms: Date.now() - started }, 'Restored');
});
