import { describe, expect, it } from 'vitest';
import type { BackupStore } from '../../src/ops/backup-store.js';
import { backupKey, backupTime, backupsToPrune, chooseBackup } from '../../src/ops/backup-store.js';
import { loadOpsEnv } from '../../src/ops/ops-env.js';
import {
  parseDatabaseUrl,
  restorableList,
  sameDatabase,
  tocEntryCount,
} from '../../src/ops/pg-tools.js';

/** The backup, restore and staging scripts' rules; the scripts themselves were run by hand (see the runbook). */
describe('backup names', () => {
  it('names a backup by the UTC moment it was taken and reads it back', () => {
    const at = new Date('2026-09-27T21:30:05.123Z');
    const key = backupKey('db-backups/', at);
    expect(key).toBe('db-backups/kidzonia-20260927T213005Z.dump');
    expect(backupTime(key)?.toISOString()).toBe('2026-09-27T21:30:05.000Z');
    expect(backupTime('db-backups/README.txt')).toBeNull();
  });

  it('prunes backups older than the retention, never the newest, never other files', () => {
    const now = new Date('2026-09-27T12:00:00Z');
    const keys = [
      'b/kidzonia-20260801T020000Z.dump',
      'b/kidzonia-20260827T020000Z.dump',
      'b/kidzonia-20260829T020000Z.dump',
      'b/kidzonia-20260927T020000Z.dump',
      'b/notes.txt',
    ];
    expect(backupsToPrune(keys, now, 30)).toEqual([
      'b/kidzonia-20260801T020000Z.dump',
      'b/kidzonia-20260827T020000Z.dump',
    ]);
    // Backups have been failing for months: the last good one survives.
    expect(backupsToPrune(['b/kidzonia-20260101T020000Z.dump'], now, 30)).toEqual([]);
  });

  it('chooses the newest backup, or a named one', async () => {
    const keys = [
      'b/kidzonia-20260926T020000Z.dump',
      'b/kidzonia-20260927T020000Z.dump',
      'b/kidzonia-20260925T020000Z.dump',
    ];
    const store = { list: () => Promise.resolve(keys) } as unknown as BackupStore;
    await expect(chooseBackup(store, 'b/')).resolves.toBe('b/kidzonia-20260927T020000Z.dump');
    await expect(chooseBackup(store, 'b/', 'kidzonia-20260925T020000Z.dump')).resolves.toBe(
      'b/kidzonia-20260925T020000Z.dump',
    );
    await expect(chooseBackup(store, 'b/', 'missing.dump')).rejects.toThrow(/No backup named/);
  });
});

describe('database URLs', () => {
  it('keeps the password out of the URL and drops Prisma-only parameters', () => {
    const t = parseDatabaseUrl(
      'postgresql://app:p%40ss@DB.example.in:6543/kidzonia?schema=public&sslmode=require&connection_limit=5',
    );
    expect(t.password).toBe('p@ss');
    expect(t.url).not.toContain('p%40ss');
    expect(t.url).toContain('sslmode=require');
    expect(t.url).not.toContain('schema=');
    expect(t).toMatchObject({ host: 'db.example.in', port: 6543, database: 'kidzonia' });
  });

  it('recognises the live database however its URL is spelled', () => {
    const live = 'postgresql://app:x@localhost:5432/kidzonia?sslmode=disable';
    expect(sameDatabase(live, 'postgres://other:y@127.0.0.1/kidzonia')).toBe(true);
    expect(sameDatabase(live, 'postgresql://app:x@localhost:5432/kidzonia_staging')).toBe(false);
    expect(sameDatabase(live, 'postgresql://app:x@db2:5432/kidzonia')).toBe(false);
  });
});

describe('restoring on managed Postgres', () => {
  it('leaves out extension comments, which only a superuser may restore', () => {
    const toc = [
      ';',
      '; Archive created at 2026-09-27',
      '2; 3079 16385 EXTENSION - pg_trgm',
      '4321; 0 0 COMMENT - EXTENSION pg_trgm',
      '220; 1259 16500 TABLE public organisations kidzonia',
    ].join('\n');
    const list = restorableList(toc);
    expect(list).toContain('EXTENSION - pg_trgm');
    expect(list).not.toContain('COMMENT - EXTENSION');
    expect(tocEntryCount(toc)).toBe(3);
  });
});

describe('ops settings', () => {
  it('refuses the local Docker escape hatch in production', () => {
    expect(() => loadOpsEnv({ NODE_ENV: 'production', PG_DOCKER_CONTAINER: 'db' })).toThrow(
      /PG_DOCKER_CONTAINER/,
    );
    expect(loadOpsEnv({ NODE_ENV: 'development', PG_DOCKER_CONTAINER: 'db' })).toMatchObject({
      PG_DOCKER_CONTAINER: 'db',
      BACKUP_KEEP_DAYS: 30,
      BACKUP_PREFIX: 'db-backups/',
    });
  });
});
