import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chooseBackup, createBackupStore } from './backup-store.js';
import { apiRoot, restoreBackup, runScript } from './common.js';
import { loadOpsEnv, required } from './ops-env.js';
import {
  createPgTools,
  describeDatabase,
  recreateDatabase,
  sameDatabase,
  smokeCheck,
} from './pg-tools.js';

/**
 * Lesson 14: migrations are tested on a copy of real data before each release.
 *
 * 1. Drop and recreate STAGING_DATABASE_URL, restore the latest backup into it.
 * 2. Run `prisma migrate deploy` with the migrations of the build being released.
 * 3. Smoke check: the database answers, organisations and users are readable
 *    and not fewer than before, no failed rows in `_prisma_migrations`, and
 *    `prisma migrate status` reports nothing pending.
 *
 * Exits non-zero on any failure, which blocks the release.
 *   --backup <name>   test against a specific backup instead of the latest
 */
function prisma(args: string[], databaseUrl: string): Promise<string> {
  const cli = path.join(
    path.dirname(createRequire(import.meta.url).resolve('prisma/package.json')),
    'build/index.js',
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: apiRoot(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    const collect = (b: Buffer) => {
      if (out.length < 50_000) out += b.toString();
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`prisma ${args.join(' ')} exited with ${String(code)}:\n${out}`));
    });
  });
}

runScript('staging-migrate-test', async (logger) => {
  const env = loadOpsEnv();
  const staging = required(env.STAGING_DATABASE_URL, 'STAGING_DATABASE_URL');
  // This script drops the staging database, so it must never be the live one.
  if (env.DATABASE_URL && sameDatabase(staging, env.DATABASE_URL)) {
    throw new Error('STAGING_DATABASE_URL is the same database as DATABASE_URL; refusing');
  }
  const store = createBackupStore(env);
  const { values } = parseArgs({ options: { backup: { type: 'string', default: 'latest' } } });
  const key = await chooseBackup(store, env.BACKUP_PREFIX, values.backup);

  logger.info({ staging: describeDatabase(staging), key }, 'Recreating staging database');
  await recreateDatabase(staging, env.PG_MAINTENANCE_DB);
  await restoreBackup({ store, tools: createPgTools(env), key, targetUrl: staging, logger });

  const before = await smokeCheck(staging);
  logger.info(before, 'Restored copy');
  if (before.migrationsFailed > 0) {
    throw new Error('The backup itself has failed migrations; fix production first');
  }

  const started = Date.now();
  const deployOutput = await prisma(['migrate', 'deploy'], staging);
  logger.info({ ms: Date.now() - started }, 'Migrations applied');
  logger.debug({ output: deployOutput }, 'prisma migrate deploy');

  const after = await smokeCheck(staging);
  // `migrate status` exits non-zero when anything is pending or failed.
  await prisma(['migrate', 'status'], staging);

  const problems: string[] = [];
  if (after.migrationsFailed > 0) problems.push(`${after.migrationsFailed} failed migrations`);
  if (after.organisations < before.organisations) problems.push('organisations were lost');
  if (after.users < before.users) problems.push('users were lost');
  if (problems.length) throw new Error(`Smoke check failed: ${problems.join('; ')}`);

  logger.info(
    {
      key,
      organisations: after.organisations,
      users: after.users,
      migrationsBefore: before.migrationsApplied,
      migrationsAfter: after.migrationsApplied,
      newMigrations: after.migrationsApplied - before.migrationsApplied,
    },
    'Staging migration test passed',
  );
});
