import type { PrismaClient } from '../generated/prisma/client.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db', 'postgres']);

/** True only for a database on this machine (or the compose/CI service). */
export function isLocalDatabase(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export async function countOrganisations(prisma: PrismaClient): Promise<number> {
  return prisma.organisation.count();
}

/**
 * Empties every application table, keeping the schema and migration history.
 * Refuses anything that isn't a local database; callers also refuse in
 * production. Used by `pnpm seed --reset` and by tests between cases.
 */
export async function resetDatabase(prisma: PrismaClient, url: string): Promise<void> {
  if (!isLocalDatabase(url)) {
    throw new Error('Refusing to reset a database that is not local');
  }
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename.replace(/"/g, '""')}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
