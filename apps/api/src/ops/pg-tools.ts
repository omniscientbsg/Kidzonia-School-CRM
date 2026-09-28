import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import type { OpsEnv } from './ops-env.js';

/**
 * Running pg_dump and pg_restore, and the small amount of database
 * administration the operations scripts need. Passwords travel in PGPASSWORD,
 * never on a command line where `ps` would show them.
 */

/** Query parameters libpq understands; Prisma-only ones (`schema`, `connection_limit`) are dropped. */
const LIBPQ_PARAMS = new Set([
  'sslmode',
  'sslrootcert',
  'sslcert',
  'sslkey',
  'sslcrl',
  'channel_binding',
  'connect_timeout',
  'application_name',
  'options',
  'target_session_attrs',
]);

export interface PgTarget {
  /** The URL without its password, safe to pass as an argument. */
  url: string;
  password: string;
  host: string;
  port: number;
  database: string;
}

export function parseDatabaseUrl(raw: string): PgTarget {
  const u = new URL(raw);
  const password = decodeURIComponent(u.password);
  u.password = '';
  for (const key of [...u.searchParams.keys()]) {
    if (!LIBPQ_PARAMS.has(key)) u.searchParams.delete(key);
  }
  return {
    url: u.toString(),
    password,
    host: u.hostname.toLowerCase(),
    port: u.port ? Number(u.port) : 5432,
    database: decodeURIComponent(u.pathname.slice(1)),
  };
}

/** For logs: which server and database, never the user or password. */
export function describeDatabase(raw: string): string {
  const t = parseDatabaseUrl(raw);
  return `${t.host}:${t.port}/${t.database}`;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** True when two URLs point at the same database (same server, port and name). */
export function sameDatabase(a: string, b: string): boolean {
  const x = parseDatabaseUrl(a);
  const y = parseDatabaseUrl(b);
  const host = (h: string) => (LOOPBACK.has(h) ? 'localhost' : h);
  return host(x.host) === host(y.host) && x.port === y.port && x.database === y.database;
}

/** The same server, another database (to drop or create the first one). */
export function withDatabase(raw: string, database: string): string {
  const u = new URL(raw);
  u.pathname = `/${encodeURIComponent(database)}`;
  return u.toString();
}

export interface PgTools {
  /** Writes a custom-format dump of `databaseUrl` to `localFile`. */
  dump(databaseUrl: string, localFile: string): Promise<void>;
  /** The dump's table of contents (pg_restore --list), proving the file is readable. */
  list(localFile: string): Promise<string>;
  /** Restores `localFile` into `databaseUrl`, stopping at the first error. */
  restore(databaseUrl: string, localFile: string, listFile?: string): Promise<void>;
}

interface RunOptions {
  env?: Record<string, string>;
  /** Command output is kept for errors, capped so a huge TOC can't exhaust memory. */
  captureStdout?: boolean;
}

function run(command: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (b: Buffer) => {
      if (options.captureStdout) out.push(b);
    });
    child.stderr.on('data', (b: Buffer) => {
      if (err.length < 20_000) err += b.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString());
      else
        reject(new Error(`${path.basename(command)} exited with ${String(code)}: ${err.trim()}`));
    });
  });
}

const DUMP_ARGS = ['--format=custom', '--compress=6', '--no-sync'];
/**
 * --no-owner/--no-privileges: managed Postgres gives each database its own
 * roles, so the dump's owners and grants won't exist on the target.
 */
const RESTORE_ARGS = ['--no-owner', '--no-privileges', '--exit-on-error'];

/** pg_dump and pg_restore installed on this machine or in the image (PG_BIN or PATH). */
export class NativePgTools implements PgTools {
  constructor(private readonly binDir: string | undefined) {}

  private bin(name: string) {
    return this.binDir ? path.join(this.binDir, name) : name;
  }

  async dump(databaseUrl: string, localFile: string) {
    const t = parseDatabaseUrl(databaseUrl);
    await run(this.bin('pg_dump'), [...DUMP_ARGS, `--file=${localFile}`, `--dbname=${t.url}`], {
      env: { PGPASSWORD: t.password },
    });
  }

  list(localFile: string) {
    return run(this.bin('pg_restore'), ['--list', localFile], { captureStdout: true });
  }

  async restore(databaseUrl: string, localFile: string, listFile?: string) {
    const t = parseDatabaseUrl(databaseUrl);
    const args = [...RESTORE_ARGS, `--dbname=${t.url}`];
    if (listFile) args.push(`--use-list=${listFile}`);
    await run(this.bin('pg_restore'), [...args, localFile], { env: { PGPASSWORD: t.password } });
  }
}

/**
 * LOCAL TESTING ONLY (refused in production): runs the tools inside the
 * docker-compose Postgres container when the host has none. Files are copied
 * in and out with `docker cp`, and the database is reached as the container
 * sees it: its own server on localhost:5432, whatever port the host maps.
 */
export class DockerPgTools implements PgTools {
  constructor(private readonly container: string) {}

  private inside(databaseUrl: string) {
    const u = new URL(databaseUrl);
    u.hostname = 'localhost';
    u.port = '5432';
    return parseDatabaseUrl(u.toString());
  }

  private exec(args: string[], password?: string, captureStdout = false) {
    const env = password ? ['-e', `PGPASSWORD=${password}`] : [];
    return run('docker', ['exec', ...env, this.container, ...args], { captureStdout });
  }

  private async copyIn(localFile: string): Promise<string> {
    const remote = `/tmp/kz-ops-${randomUUID()}${path.extname(localFile)}`;
    await run('docker', ['cp', localFile, `${this.container}:${remote}`]);
    return remote;
  }

  private async removeRemote(...files: string[]) {
    await this.exec(['rm', '-f', ...files]).catch(() => undefined);
  }

  async dump(databaseUrl: string, localFile: string) {
    const t = this.inside(databaseUrl);
    const remote = `/tmp/kz-ops-${randomUUID()}.dump`;
    try {
      await this.exec(
        ['pg_dump', ...DUMP_ARGS, `--file=${remote}`, `--dbname=${t.url}`],
        t.password,
      );
      await run('docker', ['cp', `${this.container}:${remote}`, localFile]);
    } finally {
      await this.removeRemote(remote);
    }
  }

  async list(localFile: string) {
    const remote = await this.copyIn(localFile);
    try {
      return await this.exec(['pg_restore', '--list', remote], undefined, true);
    } finally {
      await this.removeRemote(remote);
    }
  }

  async restore(databaseUrl: string, localFile: string, listFile?: string) {
    const t = this.inside(databaseUrl);
    const remote = await this.copyIn(localFile);
    const remoteList = listFile ? await this.copyIn(listFile) : undefined;
    try {
      const args = [...RESTORE_ARGS, `--dbname=${t.url}`];
      if (remoteList) args.push(`--use-list=${remoteList}`);
      await this.exec(['pg_restore', ...args, remote], t.password);
    } finally {
      await this.removeRemote(remote, ...(remoteList ? [remoteList] : []));
    }
  }
}

export function createPgTools(env: Pick<OpsEnv, 'PG_BIN' | 'PG_DOCKER_CONTAINER'>): PgTools {
  if (env.PG_DOCKER_CONTAINER) return new DockerPgTools(env.PG_DOCKER_CONTAINER);
  return new NativePgTools(env.PG_BIN);
}

/**
 * The restore list without entries a non-superuser can't restore on managed
 * Postgres: comments on extensions (the extension itself is still created).
 */
export function restorableList(toc: string): string {
  return toc
    .split(/\r?\n/)
    .filter((line) => !/\bCOMMENT - EXTENSION\b/.test(line))
    .join('\n');
}

/** Number of objects in a dump's table of contents (comment lines start with ';'). */
export function tocEntryCount(toc: string): number {
  return toc.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith(';')).length;
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Drops (disconnecting anyone still on it) and creates the database in `url`. */
export async function recreateDatabase(url: string, maintenanceDb: string): Promise<void> {
  const { database } = parseDatabaseUrl(url);
  await withClient(withDatabase(url, maintenanceDb), async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${quoteIdent(database)}`);
  });
}

/** Tables outside Postgres's own schemas; a restore target must have none. */
export async function userTableCount(url: string): Promise<number> {
  return withClient(url, async (c) => {
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_catalog.pg_tables
       WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`,
    );
    return Number(r.rows[0]?.n ?? 0);
  });
}

export interface SmokeResult {
  organisations: number;
  users: number;
  migrationsApplied: number;
  migrationsFailed: number;
}

/**
 * The smallest check that the app's data survived: the database answers, the
 * core tables are readable, and Prisma's migration history has no failed or
 * half-applied rows.
 */
export async function smokeCheck(url: string): Promise<SmokeResult> {
  return withClient(url, async (c) => {
    const count = async (sql: string) => {
      const r = await c.query<{ n: string }>(sql);
      return Number(r.rows[0]?.n ?? 0);
    };
    return {
      organisations: await count('SELECT count(*)::text AS n FROM organisations'),
      users: await count('SELECT count(*)::text AS n FROM users'),
      migrationsApplied: await count(
        'SELECT count(*)::text AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
      ),
      // Prisma leaves finished_at empty on a migration that failed or is still running.
      migrationsFailed: await count(
        'SELECT count(*)::text AS n FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL',
      ),
    };
  });
}
