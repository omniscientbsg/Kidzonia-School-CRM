import { describe, expect, it } from 'vitest';
import {
  accessFromMe,
  createAccess,
  describePower,
  navigationFor,
  powerAdded,
  powerBeyond,
  scopeWithin,
} from '../src/index.js';
import type { Me } from '../src/index.js';
import { registry } from '../src/modules/index.js';
import {
  ctx,
  deptHeadRole,
  facts,
  grant,
  ids,
  ownerRole,
  principalRole,
  role,
  rule,
  teacherRole,
} from './fixtures.js';

const franchiseOwnerRole = role({
  tasks: grant(['view', 'create', 'edit', 'delete', 'assign', 'approve'], 'school'),
  users: grant(['view', 'create', 'edit'], 'school'),
  hrms_staff: grant(['view', 'create', 'edit'], 'school'),
  schools: grant(['view']),
});

describe('power rule: no more powerful than your own', () => {
  it('lets an Owner give anything, including the Owner role', () => {
    expect(powerBeyond(registry, ownerRole, ownerRole)).toEqual([]);
    expect(powerBeyond(registry, deptHeadRole, ownerRole)).toEqual([]);
  });

  it('never lets anyone else give the Owner role', () => {
    expect(powerBeyond(registry, ownerRole, deptHeadRole).map((v) => v.key)).toEqual(['owner']);
  });

  it('stops a franchise owner giving a Department head role (all-schools reach)', () => {
    const v = powerBeyond(registry, deptHeadRole, franchiseOwnerRole);
    expect(v.map((x) => x.key)).toContain('tasks:reach');
    expect(v.map((x) => x.key)).toContain('task_reports:view');
    expect(describePower(v)).toMatch(/more access than your own role/);
  });

  it('allows giving roles that are within your own (teacher, principal under franchise owner)', () => {
    // The teacher role can view task reports, which this franchise owner can't.
    expect(powerBeyond(registry, teacherRole, franchiseOwnerRole).map((v) => v.key)).toEqual([
      'task_reports:view',
      'task_reports:reach',
    ]);
    const fo = role({ ...franchiseOwnerRole.modules, task_reports: grant(['view'], 'school') });
    expect(powerBeyond(registry, teacherRole, fo)).toEqual([]);
  });

  it('counts field access: a visible field is more than a hidden one', () => {
    const hider = role({ users: grant(['view'], 'all') }, { users: { mobile: rule('hidden') } });
    const shower = role({ users: grant(['view'], 'all') });
    expect(powerBeyond(registry, shower, hider).map((v) => v.key)).toEqual(['users.mobile']);
    expect(powerBeyond(registry, hider, shower)).toEqual([]);
  });

  it('counts own-record edit and skipping approval as extra power', () => {
    const holder = role(
      { hrms_staff: grant(['view'], 'own') },
      { hrms_staff: { bankDetails: rule('view', { ownRecord: 'edit', needsApproval: true }) } },
    );
    const noApproval = role(
      { hrms_staff: grant(['view'], 'own') },
      { hrms_staff: { bankDetails: rule('view', { ownRecord: 'edit' }) } },
    );
    expect(powerBeyond(registry, noApproval, holder).map((v) => v.key)).toEqual([
      'hrms_staff.bankDetails:approval',
    ]);
  });

  it('when editing, only counts power the edit adds (addition b)', () => {
    // An editor weaker than the role may still rename or reduce it…
    expect(powerAdded(registry, deptHeadRole, deptHeadRole, principalRole)).toEqual([]);
    const reduced = role({ ...deptHeadRole.modules, users: undefined });
    expect(powerAdded(registry, deptHeadRole, reduced, principalRole)).toEqual([]);
    // …but can't add anything beyond their own role.
    const grown = role({ ...teacherRole.modules, users: grant(['view', 'delete'], 'all') });
    expect(powerAdded(registry, teacherRole, grown, principalRole).map((v) => v.key)).toEqual([
      'users:delete',
      'users:reach',
    ]);
  });

  it('keeps a given scope inside the giver’s own', () => {
    const jh = { allSchools: false, schoolIds: [ids.schoolJH] };
    const both = { allSchools: false, schoolIds: [ids.schoolJH, ids.schoolGB] };
    const all = { allSchools: true, schoolIds: [] };
    expect(scopeWithin(jh, both, false)).toBe(true);
    expect(scopeWithin(both, jh, false)).toBe(false);
    expect(scopeWithin(all, jh, false)).toBe(false);
    expect(scopeWithin(all, jh, true)).toBe(true);
    expect(scopeWithin(both, all, false)).toBe(true);
  });
});

describe('preview access: only what BOTH people may see (addition a)', () => {
  // The exact case: a teacher may see (and edit, with approval) their own
  // salary; the admin previewing them has a role that hides salary.
  const teacherSeesOwnSalary = role(
    { hrms_staff: grant(['view'], 'own') },
    { hrms_staff: { salary: rule('view') } },
  );
  const adminHidesSalary = role(
    { hrms_staff: grant(['view', 'edit'], 'all'), roles: grant(['view', 'edit']) },
    { hrms_staff: { salary: rule('hidden') } },
  );
  const teacher = ctx({ userId: ids.teacherA, role: teacherSeesOwnSalary });
  const admin = ctx({ userId: ids.owner, role: adminHidesSalary });
  const staffRecord = { id: 'rec', userId: ids.teacherA, salary: 42000, homeAddress: 'x' };
  const teacherFacts = facts([ids.teacherA]);

  it('the teacher alone sees their salary', () => {
    expect(createAccess(teacher).serialize('hrms_staff', staffRecord, teacherFacts)).toHaveProperty(
      'salary',
      42000,
    );
  });

  it('the admin previewing the teacher does not', () => {
    const preview = createAccess(teacher, [admin], true);
    const out = preview.serialize('hrms_staff', staffRecord, teacherFacts);
    expect(out).not.toHaveProperty('salary');
    expect(out).toHaveProperty('homeAddress', 'x');
    expect(preview.fieldAccess('hrms_staff', 'salary', teacherFacts)).toBe('hidden');
  });

  it('is read-only and needs both people for every record and action', () => {
    const preview = createAccess(teacher, [admin], true);
    expect(preview.readOnly).toBe(true);
    expect(preview.fieldAccess('hrms_staff', 'homeAddress', teacherFacts)).toBe('view');
    expect(preview.can('roles', 'view')).toBe(false); // the teacher can't
    expect(preview.can('hrms_staff', 'view', facts([ids.teacherB]))).toBe(false); // not the teacher's
    expect(preview.scopes('hrms_staff')).toHaveLength(2);
  });

  it('shows only the pages both people have', () => {
    const preview = createAccess(teacher, [admin], true);
    expect(preview.navigation().apps.map((a) => a.app.key)).toEqual(['hrms']);
    expect(navigationFor(admin).apps.map((a) => a.app.key)).toContain('settings');
  });

  it('is rebuilt the same way on the client from GET /me', () => {
    const me: Me = {
      user: {
        id: ids.teacherA,
        fullName: 'T',
        jobTitle: null,
        photoUrl: null,
        homeSchoolId: null,
        homeSchoolName: null,
      },
      organisation: {
        id: 'o',
        name: 'O',
        logoUrl: null,
        setupType: 'head_office',
        timezone: 'Asia/Kolkata',
      },
      role: {
        roleId: 'r1',
        roleName: 'Teacher',
        isOwner: false,
        modules: { hrms_staff: { actions: ['view'], reach: 'own' } },
        fields: { hrms_staff: { salary: rule('view') } },
      },
      scope: { allSchools: false, schoolIds: [] },
      teamUserIds: [],
      managerSwitches: {},
      askForAccess: null,
      changesToApprove: 0,
      customLists: [],
      preview: {
        previewer: { id: ids.owner, fullName: 'A', jobTitle: null },
        role: {
          roleId: 'r2',
          roleName: 'Admin',
          isOwner: false,
          modules: { hrms_staff: { actions: ['view', 'edit'], reach: 'all' } },
          fields: { hrms_staff: { salary: rule('hidden') } },
        },
        scope: { allSchools: true, schoolIds: [] },
        teamUserIds: [],
        managerSwitches: {},
      },
    };
    const access = accessFromMe(me, registry);
    expect(access.readOnly).toBe(true);
    expect(access.fieldAccess('hrms_staff', 'salary', teacherFacts)).toBe('hidden');
  });
});
