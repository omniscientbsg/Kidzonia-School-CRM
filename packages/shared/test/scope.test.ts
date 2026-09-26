import { describe, expect, it } from 'vitest';
import { can, reachScope, scopeMatches } from '../src/permissions/index.js';
import type { PermissionContext, RecordFacts } from '../src/permissions/index.js';
import { ctx, deptHeadRole, facts, ids, ownerRole, principalCtx, teacherCtx } from './fixtures.js';

const people = Object.values(ids).filter((v) => v.startsWith('u-'));
const schools = [ids.schoolJH, ids.schoolGB];

/** Deterministic pseudo-random generator so failures are reproducible. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

function randomFacts(next: () => number): RecordFacts {
  const pick = <T>(xs: readonly T[]) => xs.filter(() => next() < 0.3);
  const watchers = pick(people).map((userId) => ({
    userId,
    access: next() < 0.5 ? ('view' as const) : ('edit' as const),
  }));
  return facts(pick(people), pick(schools), watchers);
}

const contexts: [string, PermissionContext][] = [
  ['no role', ctx({ role: null })],
  ['owner', ctx({ userId: ids.owner, role: ownerRole })],
  ['dept head', ctx({ userId: ids.deptHead, role: deptHeadRole })],
  ['principal', principalCtx()],
  ['principal, all schools', principalCtx({ scope: { allSchools: true, schoolIds: [] } })],
  ['teacher', teacherCtx()],
  ['teacher who manages', teacherCtx({ teamUserIds: new Set([ids.teacherB]) })],
  [
    'manager, switches off',
    teacherCtx({
      teamUserIds: new Set([ids.teacherB]),
      managerSwitches: { manager_sees_team_tasks: false, manager_approves_team_work: false },
    }),
  ],
];

describe('reachScope agrees with can() on every record', () => {
  const cases: [string, string][] = [
    ['tasks', 'view'],
    ['tasks', 'edit'],
    ['tasks', 'approve'],
    ['tasks', 'release'],
    ['users', 'view'],
    ['task_reports', 'view'],
    ['schools', 'view'],
  ];
  for (const [name, c] of contexts) {
    for (const [mod, action] of cases) {
      it(`${name}: ${mod}.${action}`, () => {
        const next = rng(name.length * 31 + mod.length * 7 + action.length);
        const scope = reachScope(c, mod, action);
        for (let i = 0; i < 300; i++) {
          const f = randomFacts(next);
          expect(scopeMatches(scope, f, c.userId, action), JSON.stringify(f)).toBe(
            can(c, mod, action, f),
          );
        }
      });
    }
  }

  it('is none for someone with no role and all for the Owner', () => {
    expect(reachScope(ctx({ role: null }), 'tasks')).toEqual({ kind: 'none' });
    expect(reachScope(ctx({ role: ownerRole }), 'tasks')).toEqual({ kind: 'all' });
  });
});
