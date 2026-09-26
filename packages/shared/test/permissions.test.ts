import { describe, expect, it } from 'vitest';
import {
  can,
  canConfigureFields,
  checkOwnerHolderRemoval,
  checkRoleDelete,
  checkRoleEdit,
  checkWrite,
  fieldAccess,
  fieldDecision,
  normalizeActions,
  reachOf,
  serialize,
  toggleAction,
  withinReach,
} from '../src/permissions/index.js';
import { registry } from '../src/modules/index.js';
import {
  ctx,
  deptHeadRole,
  facts,
  grant,
  ids,
  ownerRole,
  principalCtx,
  role,
  rule,
  teacherCtx,
  teacherRole,
} from './fixtures.js';

const taskOf = (assignee: string, school: string = ids.schoolJH) => facts([assignee], [school]);

describe('rule 1: nothing is allowed unless a role allows it', () => {
  const noRole = ctx({ userId: ids.teacherA, role: null });

  it('denies every action on every module to someone with no role', () => {
    for (const m of registry.modules) {
      for (const a of m.actions) expect(can(noRole, m.key, a)).toBe(false);
    }
  });

  it('denies even their own records and records they watch', () => {
    const watched = facts([ids.otherTeacher], [], [{ userId: ids.teacherA, access: 'edit' }]);
    expect(can(noRole, 'tasks', 'view', taskOf(ids.teacherA))).toBe(false);
    expect(can(noRole, 'tasks', 'view', watched)).toBe(false);
  });

  it('denies modules the role has no row for', () => {
    expect(can(teacherCtx(), 'roles', 'view')).toBe(false);
    expect(can(teacherCtx(), 'dayend', 'view')).toBe(false);
  });

  it('gives no reach and hides every field', () => {
    expect(reachOf(noRole, 'tasks')).toBeNull();
    expect(fieldAccess(noRole, 'users', 'mobile')).toBe('hidden');
  });

  it('throws on unknown modules, actions and fields instead of quietly denying', () => {
    expect(() => can(teacherCtx(), 'nope', 'view')).toThrow(/Unknown module/);
    expect(() => can(teacherCtx(), 'tasks', 'export')).toThrow(/no action/);
    expect(() => fieldAccess(teacherCtx(), 'tasks', 'nope')).toThrow(/no field/);
  });
});

describe('rule 2: the Owner has everything', () => {
  const owner = ctx({ userId: ids.owner, role: ownerRole });

  it('can do every action, including derived ones, on every module', () => {
    for (const m of registry.modules) {
      for (const a of m.actions) expect(can(owner, m.key, a)).toBe(true);
    }
    expect(can(owner, 'tasks', 'release', taskOf(ids.otherTeacher, ids.schoolGB))).toBe(true);
  });

  it('reaches every record and edits every field', () => {
    expect(reachOf(owner, 'tasks')).toBe('all');
    expect(fieldAccess(owner, 'hrms_staff', 'salary', facts([ids.hoStaff]))).toBe('edit');
    expect(fieldDecision(owner, 'users', 'mobile').needsApproval).toBe(false);
  });

  it('refuses to edit or delete the Owner role', () => {
    expect(checkRoleEdit({ isOwner: true })).toMatchObject({ ok: false });
    expect(checkRoleDelete({ isOwner: true })).toMatchObject({ ok: false });
    expect(checkRoleEdit({ isOwner: false })).toEqual({ ok: true });
    expect(checkRoleDelete({ isOwner: false })).toEqual({ ok: true });
  });

  it('refuses to remove the last person holding the Owner role', () => {
    expect(checkOwnerHolderRemoval(1)).toMatchObject({ ok: false });
    expect(checkOwnerHolderRemoval(0)).toMatchObject({ ok: false });
    expect(checkOwnerHolderRemoval(2)).toEqual({ ok: true });
  });
});

describe('rule 3: any action implies view; no view clears the module', () => {
  const tasks = registry.module('tasks');

  it('ticks view when another action is ticked', () => {
    expect(normalizeActions(tasks, ['approve'])).toEqual(['view', 'approve']);
    expect(toggleAction(tasks, [], 'create', true)).toEqual(['view', 'create']);
  });

  it('clears everything when view is unticked', () => {
    expect(toggleAction(tasks, ['view', 'create', 'approve'], 'view', false)).toEqual([]);
  });

  it('keeps view when another action is unticked', () => {
    expect(toggleAction(tasks, ['view', 'create'], 'create', false)).toEqual(['view']);
  });

  it('drops actions the module does not have and keeps canonical order', () => {
    expect(
      normalizeActions(registry.module('task_reports'), ['export', 'approve', 'view']),
    ).toEqual(['view', 'export']);
  });

  it('treats a stored grant without view as switched off', () => {
    const broken = teacherCtx({ role: role({ tasks: grant(['create', 'edit'], 'all') }) });
    expect(can(broken, 'tasks', 'create')).toBe(false);
    expect(can(broken, 'tasks', 'view')).toBe(false);
  });
});

describe('rule 4: reach decides whose records someone can act on', () => {
  it('own: only records assigned to or created by them', () => {
    const t = teacherCtx();
    expect(can(t, 'tasks', 'view', taskOf(ids.teacherA))).toBe(true);
    expect(can(t, 'tasks', 'view', facts([ids.principal, ids.teacherA]))).toBe(true);
    // Brief 6.4: a teacher can't see someone else's task even with its id.
    expect(can(t, 'tasks', 'view', taskOf(ids.teacherB))).toBe(false);
  });

  it('team: themselves plus direct and indirect reports', () => {
    const vp = 'u-vice-principal';
    const p = principalCtx({ teamUserIds: new Set([vp, ids.teacherA]) }); // teacherA reports to vp
    expect(can(p, 'tasks', 'view', taskOf(ids.principal))).toBe(true);
    expect(can(p, 'tasks', 'view', taskOf(vp))).toBe(true);
    expect(can(p, 'tasks', 'view', taskOf(ids.teacherA))).toBe(true);
    expect(can(p, 'tasks', 'view', taskOf(ids.otherTeacher))).toBe(false);
  });

  it('team: a principal cannot approve work of someone outside their team', () => {
    const p = principalCtx();
    expect(can(p, 'tasks', 'approve', taskOf(ids.teacherA))).toBe(true);
    expect(can(p, 'tasks', 'approve', taskOf(ids.otherTeacher, ids.schoolJH))).toBe(false);
  });

  it('school: everyone in the schools in their scope, never head office', () => {
    const p = principalCtx();
    const user = (id: string, school?: string) => facts([id], school ? [school] : []);
    expect(can(p, 'users', 'view', user(ids.otherTeacher, ids.schoolJH))).toBe(true);
    expect(can(p, 'users', 'view', user(ids.otherTeacher, ids.schoolGB))).toBe(false);
    expect(can(p, 'users', 'view', user(ids.hoStaff))).toBe(false);
    expect(can(p, 'users', 'view', user(ids.principal))).toBe(true); // always themselves
  });

  it('school: an all-schools scope covers every school but still not head office', () => {
    const p = principalCtx({ scope: { allSchools: true, schoolIds: [] } });
    expect(can(p, 'users', 'view', facts([ids.otherTeacher], [ids.schoolGB]))).toBe(true);
    expect(can(p, 'users', 'view', facts([ids.hoStaff], []))).toBe(false);
  });

  it('all: everyone in the organisation', () => {
    const d = ctx({ userId: ids.deptHead, role: deptHeadRole });
    expect(can(d, 'tasks', 'view', taskOf(ids.otherTeacher, ids.schoolGB))).toBe(true);
    expect(can(d, 'users', 'view', facts([ids.hoStaff]))).toBe(true);
  });

  it('modules without reach ignore record facts', () => {
    const d = ctx({ userId: ids.deptHead, role: deptHeadRole });
    expect(can(d, 'schools', 'view', facts([], [ids.schoolGB]))).toBe(true);
    expect(reachOf(d, 'schools')).toBe('all');
  });

  it('withinReach always includes the person themselves', () => {
    const t = teacherCtx();
    for (const r of ['own', 'team', 'school', 'all'] as const) {
      expect(withinReach(t, r, facts([ids.teacherA]))).toBe(true);
    }
  });
});

describe('rule 5: field access', () => {
  it('follows the module when the role has no row for the field', () => {
    const t = teacherCtx();
    expect(fieldAccess(t, 'tasks', 'title', taskOf(ids.teacherA))).toBe('edit'); // tasks: edit
    const p = principalCtx();
    expect(fieldAccess(p, 'users', 'email', facts([ids.teacherA], [ids.schoolJH]))).toBe('view');
  });

  it('is hidden when the record is out of reach, whatever the field rule says', () => {
    expect(fieldAccess(teacherCtx(), 'tasks', 'title', taskOf(ids.teacherB))).toBe('hidden');
  });

  it('removes hidden fields from serialized records', () => {
    const d = ctx({ userId: ids.deptHead, role: deptHeadRole });
    const record = {
      id: 'x',
      fullName: 'Priya Sharma',
      mobile: '+919848044108',
      email: null,
      homeSchoolId: ids.schoolJH,
      passwordHash: 'secret',
      organisationId: 'org',
    };
    const out = serialize(d, 'users', record, facts(['x'], [ids.schoolJH]));
    expect(out).toEqual({
      id: 'x',
      fullName: 'Priya Sharma',
      email: null,
      homeSchoolId: ids.schoolJH,
    });
    expect(out).not.toHaveProperty('mobile');
    // Not in the registry at all, so never returned, even to the Owner.
    const owner = ctx({ userId: ids.owner, role: ownerRole });
    expect(serialize(owner, 'users', record, facts(['x']))).not.toHaveProperty('passwordHash');
  });

  it('removes every prop a multi-prop field covers', () => {
    const t = teacherCtx({
      role: role({ tasks: grant(['view'], 'own') }, { tasks: { due: rule('hidden') } }),
    });
    const out = serialize(
      t,
      'tasks',
      { id: 't', title: 'x', dueType: 'at_time', dueTime: '09:30', dueAt: 'z' },
      taskOf(ids.teacherA),
    );
    expect(out).toEqual({ id: 't', title: 'x' });
  });

  it('refuses to serialize records outside reach', () => {
    expect(() => serialize(teacherCtx(), 'tasks', { id: 't' }, taskOf(ids.teacherB))).toThrow();
  });

  it('view: returned but writes rejected', () => {
    const t = teacherCtx();
    const own = taskOf(ids.teacherA);
    expect(fieldAccess(t, 'tasks', 'remarks', own)).toBe('view');
    expect(checkWrite(t, 'tasks', ['remarks'], own).denied).toEqual(['remarks']);
  });

  it('hidden: writes rejected too, never relying on the client', () => {
    const t = teacherCtx();
    expect(checkWrite(t, 'tasks', ['watchers'], taskOf(ids.teacherA)).denied).toEqual(['watchers']);
  });

  it('edit: writable, but never beyond the module’s own edit right', () => {
    const viewOnly = teacherCtx({
      role: role({ tasks: grant(['view'], 'own') }, { tasks: { title: rule('edit') } }),
    });
    expect(fieldAccess(viewOnly, 'tasks', 'title', taskOf(ids.teacherA))).toBe('view');
    expect(fieldAccess(teacherCtx(), 'tasks', 'proof', taskOf(ids.teacherA))).toBe('edit');
  });

  it('own_record = edit makes a view field editable on their own records only', () => {
    const t = teacherCtx();
    expect(fieldAccess(t, 'hrms_staff', 'homeAddress', facts([ids.teacherA]))).toBe('edit');
    const principalViewingTeacher = principalCtx({
      role: role(
        { hrms_staff: grant(['view'], 'team') },
        { hrms_staff: { homeAddress: rule('view', { ownRecord: 'edit' }) } },
      ),
    });
    expect(
      fieldAccess(principalViewingTeacher, 'hrms_staff', 'homeAddress', facts([ids.teacherA])),
    ).toBe('view');
  });

  it('own_record = edit never reveals a hidden field', () => {
    const t = teacherCtx({
      role: role(
        { hrms_staff: grant(['view'], 'own') },
        { hrms_staff: { salary: rule('hidden', { ownRecord: 'edit' }) } },
      ),
    });
    expect(fieldAccess(t, 'hrms_staff', 'salary', facts([ids.teacherA]))).toBe('hidden');
  });

  it('needs_approval turns an edit into a pending change', () => {
    const t = teacherCtx();
    const own = facts([ids.teacherA]);
    expect(fieldDecision(t, 'hrms_staff', 'bankDetails', own)).toEqual({
      access: 'edit',
      needsApproval: true,
    });
    expect(checkWrite(t, 'hrms_staff', ['bankDetails'], own)).toEqual({
      denied: [],
      pendingApproval: ['bankDetails'],
    });
  });

  it('props outside every field follow the module edit right', () => {
    const p = principalCtx();
    expect(
      checkWrite(p, 'users', ['jobTitle'], facts([ids.teacherA], [ids.schoolJH])).denied,
    ).toEqual(['jobTitle']);
  });
});

describe('rule 6: field permissions need view on the module first', () => {
  it('is only available once the role can view the module', () => {
    expect(canConfigureFields(undefined)).toBe(false);
    expect(canConfigureFields(grant([]))).toBe(false);
    expect(canConfigureFields(grant(['view']))).toBe(true);
    expect(canConfigureFields(teacherRole.modules.tasks)).toBe(true);
  });
});

describe('automatic roles: reporting manager', () => {
  // A teacher-level role who nonetheless manages an assistant.
  const lead = (switches: Record<string, boolean> = {}) =>
    teacherCtx({ teamUserIds: new Set([ids.teacherB]), managerSwitches: switches });

  it('sees, approves and releases their team by default', () => {
    const l = lead();
    const work = taskOf(ids.teacherB);
    expect(can(l, 'tasks', 'view', work)).toBe(true);
    expect(can(l, 'tasks', 'approve', work)).toBe(true);
    expect(can(l, 'tasks', 'release', work)).toBe(true);
    expect(can(l, 'task_reports', 'view', work)).toBe(true);
  });

  it('gets nothing over people outside their team', () => {
    const l = lead();
    expect(can(l, 'tasks', 'approve', taskOf(ids.otherTeacher))).toBe(false);
  });

  it('loses each grant when its switch is turned off', () => {
    const l = lead({ manager_approves_team_work: false, manager_releases_team_logout: false });
    const work = taskOf(ids.teacherB);
    expect(can(l, 'tasks', 'approve', work)).toBe(false);
    expect(can(l, 'tasks', 'release', work)).toBe(false);
    expect(can(l, 'tasks', 'view', work)).toBe(true);
  });

  it('does not apply to people with nobody reporting to them', () => {
    expect(can(teacherCtx(), 'tasks', 'approve', taskOf(ids.teacherB))).toBe(false);
  });

  it('never grants edit or delete', () => {
    expect(can(lead(), 'tasks', 'delete', taskOf(ids.teacherB))).toBe(false);
  });
});

describe('automatic roles: watcher', () => {
  const watchedBy = (access: 'view' | 'edit') =>
    facts([ids.otherTeacher], [ids.schoolGB], [{ userId: ids.teacherA, access }]);

  it('sees a watched task, and edits it only with edit access', () => {
    const t = teacherCtx();
    expect(can(t, 'tasks', 'view', watchedBy('view'))).toBe(true);
    expect(can(t, 'tasks', 'edit', watchedBy('view'))).toBe(false);
    expect(can(t, 'tasks', 'edit', watchedBy('edit'))).toBe(true);
  });

  it('never becomes an approver by watching', () => {
    expect(can(principalCtx({ userId: ids.teacherA }), 'tasks', 'approve', watchedBy('edit'))).toBe(
      false,
    );
  });

  it('only applies to modules that support watchers', () => {
    const t = teacherCtx();
    expect(can(t, 'users', 'view', watchedBy('edit'))).toBe(false);
  });
});

describe('release is derived from approve', () => {
  it('is allowed for anyone who can approve the person’s work', () => {
    expect(can(principalCtx(), 'tasks', 'release', taskOf(ids.teacherA))).toBe(true);
    expect(can(principalCtx(), 'tasks', 'release', taskOf(ids.otherTeacher))).toBe(false);
    expect(can(teacherCtx(), 'tasks', 'release', taskOf(ids.teacherA))).toBe(false);
  });
});
