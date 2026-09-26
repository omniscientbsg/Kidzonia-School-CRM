import type { RecordFacts, ReachScope } from '@kidzonia/shared';
import type { Prisma } from '../../db/index.js';

/** A Users record is about the person themselves, at their home school. */
export function userFacts(u: { id: string; homeSchoolId: string | null }): RecordFacts {
  return { subjectUserIds: [u.id], schoolIds: u.homeSchoolId ? [u.homeSchoolId] : [] };
}

/** Facts for someone who doesn't exist yet (adding a user): only where they'll work. */
export function newUserFacts(homeSchoolId: string | null): RecordFacts {
  return { subjectUserIds: [], schoolIds: homeSchoolId ? [homeSchoolId] : [] };
}

/**
 * A reach scope as a WHERE clause on users. Must agree with `can()`; the shared
 * tests check scope and can() agree record by record.
 */
export function userScopeWhere(scope: ReachScope): Prisma.UserWhereInput {
  if (scope.kind === 'all') return {};
  if (scope.kind === 'none') return { id: { in: [] } };
  const or: Prisma.UserWhereInput[] = [];
  if (scope.userIds.length > 0) or.push({ id: { in: [...scope.userIds] } });
  if (scope.schoolIds === 'any') or.push({ homeSchoolId: { not: null } });
  else if (scope.schoolIds.length > 0) or.push({ homeSchoolId: { in: [...scope.schoolIds] } });
  return or.length > 0 ? { OR: or } : { id: { in: [] } };
}
