import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * Everyone reporting to `userId`, directly or indirectly, in one round trip.
 * Raw SQL lives here because Prisma can't express recursive queries; the
 * organisation filter is explicit on every step. The database trigger that
 * forbids reports-to loops guarantees this terminates; the depth cap is a
 * second guard.
 */
export async function teamUserIds(
  prisma: PrismaClient,
  organisationId: string,
  userId: string,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE team(id, depth) AS (
      SELECT u.id, 1
        FROM users u
       WHERE u.organisation_id = ${organisationId}::uuid
         AND u.reports_to_user_id = ${userId}::uuid
         AND u.deleted_at IS NULL
      UNION
      SELECT u.id, t.depth + 1
        FROM users u
        JOIN team t ON u.reports_to_user_id = t.id
       WHERE u.organisation_id = ${organisationId}::uuid
         AND u.deleted_at IS NULL
         AND t.depth < 50
    )
    SELECT DISTINCT id::text AS id FROM team`;
  return rows.map((r) => r.id);
}

/** Round-trip check used by /health. */
export async function pingDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
