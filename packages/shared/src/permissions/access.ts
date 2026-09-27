import type { FieldAccess } from '../registry/index.js';
import { can, fieldAccess, serialize } from './engine.js';
import { navigationFor } from './navigation.js';
import type { AppNav, Navigation } from './navigation.js';
import { reachScope } from './scope.js';
import type { ReachScope } from './scope.js';
import type { PermissionContext, RecordFacts } from './types.js';

const RANK: Record<FieldAccess, number> = { hidden: 0, view: 1, edit: 2 };

/**
 * What one request may see and do. Normally that is one person's context.
 * In "Preview as this role" it is two: the person being previewed and the
 * person previewing. Everything must be allowed to BOTH, so a preview never
 * shows the previewer more than their own role allows.
 */
export interface Access {
  /** The person the request acts as (the previewed person during a preview). */
  readonly userId: string;
  readonly primary: PermissionContext;
  readonly contexts: readonly PermissionContext[];
  /** Previews are read-only. */
  readonly readOnly: boolean;
  can(moduleKey: string, action: string, facts?: RecordFacts): boolean;
  fieldAccess(moduleKey: string, fieldKey: string, facts?: RecordFacts): FieldAccess;
  serialize<T extends object>(moduleKey: string, record: T, facts: RecordFacts): Partial<T>;
  /**
   * Every scope must match; the server ANDs them into its query. The school
   * switcher adds its limit unless `narrow` is false (the bell, notifications
   * and your own approvals are never narrowed: Phase 5 answer 5).
   */
  scopes(moduleKey: string, action?: string, narrow?: boolean): ReachScope[];
  /** The school the switcher narrows lists to, if any. */
  readonly schoolFilter: string | null;
  navigation(): Navigation;
}

function intersectNavigation(navs: Navigation[]): Navigation {
  const [first, ...rest] = navs;
  if (!first) return { hasAccess: false, apps: [] };
  const apps: AppNav[] = [];
  for (const app of first.apps) {
    const others = rest.map((n) => n.apps.find((a) => a.app.key === app.app.key));
    if (others.some((o) => !o)) continue;
    const allowed = (path: string) =>
      others.every((o) => o?.groups.some((g) => g.pages.some((p) => p.path === path)));
    const groups = app.groups
      .map((g) => ({ label: g.label, pages: g.pages.filter((p) => allowed(p.path)) }))
      .filter((g) => g.pages.length > 0);
    const firstPage = groups[0]?.pages[0];
    apps.push({
      app: app.app,
      groups,
      path: app.app.comingSoon || !firstPage ? app.path : firstPage.path,
    });
  }
  return { hasAccess: apps.length > 0, apps };
}

export interface AccessOptions {
  /**
   * School switcher (brief 7.6): narrows every list scope to this school
   * (own records always stay). Checked against the scope before it gets here.
   */
  schoolFilter?: string | null;
}

export function createAccess(
  primary: PermissionContext,
  also: readonly PermissionContext[] = [],
  readOnly = false,
  options: AccessOptions = {},
): Access {
  const contexts = [primary, ...also];
  const school = options.schoolFilter ?? null;
  const narrow: ReachScope[] = school
    ? [{ kind: 'some', userIds: [primary.userId], schoolIds: [school], watched: false }]
    : [];
  return {
    userId: primary.userId,
    primary,
    contexts,
    readOnly,
    can: (m, a, f) => contexts.every((c) => can(c, m, a, f)),
    fieldAccess(m, field, f) {
      let lowest: FieldAccess = 'edit';
      for (const c of contexts) {
        const v = fieldAccess(c, m, field, f);
        if (RANK[v] < RANK[lowest]) lowest = v;
      }
      return readOnly && lowest === 'edit' ? 'view' : lowest;
    },
    serialize(m, record, facts) {
      const out = serialize(primary, m, record, facts);
      if (also.length === 0) return out;
      // Drop anything any other context can't see.
      const mod = primary.registry.module(m);
      const hidden = new Set<string>();
      for (const c of also) {
        if (!can(c, m, 'view', facts)) throw new Error(`serialize() outside the previewer's reach`);
        for (const field of mod.fields ?? []) {
          if (fieldAccess(c, m, field.key, facts) === 'hidden') {
            (field.props ?? [field.key]).forEach((p) => hidden.add(p));
          }
        }
      }
      return Object.fromEntries(Object.entries(out).filter(([k]) => !hidden.has(k))) as typeof out;
    },
    scopes: (m, a = 'view', narrowed = true) => [
      ...contexts.map((c) => reachScope(c, m, a)),
      ...(narrowed ? narrow : []),
    ],
    schoolFilter: school,
    navigation: () => intersectNavigation(contexts.map((c) => navigationFor(c))),
  };
}
