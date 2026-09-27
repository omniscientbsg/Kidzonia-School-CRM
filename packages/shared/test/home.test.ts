import { describe, expect, it } from 'vitest';
import { mutedByDefault, snapshotSections } from '../src/home.js';
import type { SnapshotFacts } from '../src/home.js';
import { createAccess, reachScope } from '../src/permissions/index.js';
import {
  ctx,
  deptHeadRole,
  grant,
  ids,
  ownerRole,
  principalRole,
  role,
  teacherRole,
} from './fixtures.js';

/**
 * One test per row of docs/home-snapshot.md, so a change to the rule can't
 * silently change someone's Home. Roles here are built from permissions; none
 * of the rules look at a role's name.
 */

const facts = (o: Partial<SnapshotFacts> = {}): SnapshotFacts => ({
  scopeSchools: 1,
  hasTeam: false,
  setsTasksAcrossSchools: false,
  ...o,
});
const allSchools = { allSchools: true, schoolIds: [] };

const franchiseOwnerRole = role({
  tasks: grant(['view', 'create', 'edit', 'delete', 'assign', 'approve'], 'school'),
  users: grant(['view', 'create', 'edit'], 'school'),
  schools: grant(['view']),
});
const areaManagerRole = role({
  tasks: grant(['view', 'create', 'edit', 'assign', 'approve'], 'school'),
  users: grant(['view'], 'school'),
});

describe('Home snapshot rules (docs/home-snapshot.md)', () => {
  it('row 1: Owner of several schools sees "Your schools"', () => {
    const c = ctx({ role: ownerRole, scope: allSchools });
    expect(snapshotSections(c, facts({ scopeSchools: 4, hasTeam: true }))).toEqual(['schools']);
  });

  it('row 2: department head (all schools, sets tasks, no people management) sees tasks they set', () => {
    const c = ctx({ role: deptHeadRole, scope: allSchools });
    expect(snapshotSections(c, facts({ scopeSchools: 4, setsTasksAcrossSchools: true }))).toEqual([
      'set_tasks',
    ]);
  });

  it('row 3: franchise owner (school reach over two schools, manages people, has a team) sees schools and team', () => {
    const c = ctx({
      role: franchiseOwnerRole,
      scope: { allSchools: false, schoolIds: ['a', 'b'] },
    });
    expect(snapshotSections(c, facts({ scopeSchools: 2, hasTeam: true }))).toEqual([
      'schools',
      'team',
    ]);
  });

  it('row 4: principal (team reach, one school) sees their team', () => {
    const c = ctx({ role: principalRole, teamUserIds: new Set([ids.teacherA]) });
    expect(snapshotSections(c, facts({ hasTeam: true }))).toEqual(['team']);
  });

  it('row 5: teacher (own reach) sees Today', () => {
    const c = ctx({ userId: ids.teacherA, role: teacherRole });
    expect(snapshotSections(c, facts())).toEqual(['today']);
  });

  it('row 6: a custom "area manager" (school reach, sets tasks across schools, no people management) gets tasks set plus team', () => {
    const c = ctx({
      role: areaManagerRole,
      scope: { allSchools: false, schoolIds: ['a', 'b', 'c'] },
    });
    expect(
      snapshotSections(c, facts({ scopeSchools: 3, hasTeam: true, setsTasksAcrossSchools: true })),
    ).toEqual(['set_tasks', 'team']);
  });

  it('row 7: someone whose role only reaches their own work but who manages a team sees the team (automatic role)', () => {
    const c = ctx({
      userId: ids.teacherA,
      role: teacherRole,
      teamUserIds: new Set([ids.teacherB]),
    });
    expect(snapshotSections(c, facts({ hasTeam: true }))).toEqual(['team']);
  });

  it('row 8: the school switcher narrowing to one school turns "Your schools" off', () => {
    const c = ctx({ role: ownerRole, scope: allSchools });
    expect(snapshotSections(c, facts({ scopeSchools: 1, hasTeam: false }))).toEqual(['today']);
  });
});

describe('SMS/WhatsApp defaults (Phase 5 answer 3)', () => {
  it('sends assigned and sent back, not due soon unless it blocks logout, and nothing else', () => {
    expect(mutedByDefault('task_assigned', 'sms', false)).toBe(false);
    expect(mutedByDefault('task_sent_back', 'sms', false)).toBe(false);
    expect(mutedByDefault('task_due_soon', 'sms', false)).toBe(true);
    expect(mutedByDefault('task_due_soon', 'sms', true)).toBe(false);
    expect(mutedByDefault('task_approved', 'sms', false)).toBe(true);
    expect(mutedByDefault('task_approved', 'in_app', false)).toBe(false);
  });
});

describe('school switcher narrowing (brief 7.6)', () => {
  it('adds a school limit to every list scope, keeping the person’s own records', () => {
    const c = ctx({ role: ownerRole, scope: allSchools });
    const narrowed = createAccess(c, [], false, { schoolFilter: 's-kp' });
    expect(narrowed.schoolFilter).toBe('s-kp');
    expect(narrowed.scopes('tasks')).toEqual([
      reachScope(c, 'tasks'),
      { kind: 'some', userIds: [c.userId], schoolIds: ['s-kp'], watched: false },
    ]);
    expect(createAccess(c).scopes('tasks')).toHaveLength(1);
  });
});
