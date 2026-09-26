import type { PermissionContext, RecordFacts } from './types.js';

/**
 * A database-friendly description of which records someone can act on in a
 * module. The server turns it into a WHERE clause; `scopeMatches` evaluates it
 * in memory. Tests check it always agrees with `can()` record by record.
 */
export type ReachScope =
  | { kind: 'none' }
  | { kind: 'all' }
  | {
      kind: 'some';
      /** Records about any of these people. */
      userIds: readonly string[];
      /** Records in these schools; 'any' means any school (not head office). */
      schoolIds: readonly string[] | 'any';
      /** Records the person watches. */
      watched: boolean;
    };

export function reachScope(ctx: PermissionContext, moduleKey: string, action = 'view'): ReachScope {
  const mod = ctx.registry.module(moduleKey);
  if (!ctx.role) return { kind: 'none' };
  if (ctx.role.isOwner) return { kind: 'all' };

  const grant = ctx.role.modules[mod.key];
  const derived = mod.derivedActions?.[action];
  const roleHolds =
    grant?.actions.includes('view') === true &&
    (derived
      ? derived.some((a) => grant.actions.includes(a))
      : (grant.actions as readonly string[]).includes(action));

  const userIds = new Set<string>();
  let schoolIds: readonly string[] | 'any' = [];

  if (roleHolds) {
    const reach = mod.hasReach ? (grant.reach ?? 'own') : 'all';
    if (reach === 'all') return { kind: 'all' };
    userIds.add(ctx.userId);
    if (reach === 'team') ctx.teamUserIds.forEach((id) => userIds.add(id));
    if (reach === 'school') schoolIds = ctx.scope.allSchools ? 'any' : ctx.scope.schoolIds;
  }

  const managerGrant =
    ctx.teamUserIds.size > 0 &&
    (mod.managerSwitches ?? []).some(
      (s) => s.grants.includes(action) && (ctx.managerSwitches[s.key] ?? s.defaultOn),
    );
  if (managerGrant) ctx.teamUserIds.forEach((id) => userIds.add(id));

  const watched = mod.supportsWatchers === true && (action === 'view' || action === 'edit');

  if (userIds.size === 0 && schoolIds !== 'any' && schoolIds.length === 0 && !watched) {
    return { kind: 'none' };
  }
  return { kind: 'some', userIds: [...userIds], schoolIds, watched };
}

/**
 * Evaluates a scope against one record. `watcherAccess` is the viewer's own
 * watcher entry, if any; edit through watching needs edit access.
 */
export function scopeMatches(
  scope: ReachScope,
  facts: RecordFacts,
  viewerId: string,
  action = 'view',
): boolean {
  if (scope.kind === 'all') return true;
  if (scope.kind === 'none') return false;
  if (facts.subjectUserIds.some((id) => scope.userIds.includes(id))) return true;
  if (
    scope.schoolIds === 'any'
      ? facts.schoolIds.length > 0
      : facts.schoolIds.some((s) => scope.schoolIds.includes(s))
  ) {
    return true;
  }
  if (scope.watched) {
    const w = facts.watchers?.find((x) => x.userId === viewerId);
    if (w && (action === 'view' || w.access === 'edit')) return true;
  }
  return false;
}
