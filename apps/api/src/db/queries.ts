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

export interface ChainLink {
  id: string;
  fullName: string;
  active: boolean;
}

/**
 * The people above `userId`, nearest first (manager, their manager, …).
 * Used to find who approves a change when the direct manager is inactive.
 */
export async function managerChain(
  prisma: PrismaClient,
  organisationId: string,
  userId: string,
): Promise<ChainLink[]> {
  const rows = await prisma.$queryRaw<{ id: string; full_name: string; active: boolean }[]>`
    WITH RECURSIVE chain(id, depth) AS (
      SELECT u.reports_to_user_id, 1
        FROM users u
       WHERE u.organisation_id = ${organisationId}::uuid AND u.id = ${userId}::uuid
      UNION ALL
      SELECT u.reports_to_user_id, c.depth + 1
        FROM users u JOIN chain c ON u.id = c.id
       WHERE u.organisation_id = ${organisationId}::uuid AND c.depth < 50
    )
    SELECT u.id::text AS id, u.full_name,
           (u.status <> 'inactive' AND u.deleted_at IS NULL) AS active
      FROM chain c JOIN users u ON u.id = c.id AND u.organisation_id = ${organisationId}::uuid
     ORDER BY c.depth`;
  return rows.map((r) => ({ id: r.id, fullName: r.full_name, active: r.active }));
}

/** People who hold the Owner role and can still sign in. */
export async function activeOwnerIds(
  prisma: PrismaClient,
  organisationId: string,
): Promise<string[]> {
  const rows = await prisma.roleAssignment.findMany({
    where: {
      organisationId,
      role: { isOwner: true, deletedAt: null },
      user: { deletedAt: null, status: { not: 'inactive' } },
    },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** Round-trip check used by /health. */
export async function pingDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}
