import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, people } from '../support/app.js';
import type { TestApp } from '../support/app.js';

let t: TestApp;
const as = people(() => t);
const role = (k: string) => t.demo.roles[k] ?? '';
const u = (k: string) => t.demo.users[k] ?? '';
const school = (k: string) => t.demo.schools[k] ?? '';

beforeAll(async () => {
  t = await createTestApp();
  // Give Department heads roles.* so the power rule can be tested on someone
  // who can edit roles but isn't an Owner.
  await t.prisma.rolePermission.create({
    data: {
      organisationId: t.demo.organisationId,
      roleId: role('dept_head'),
      moduleKey: 'roles',
      actions: ['view', 'create', 'edit', 'delete'],
    },
  });
});
afterAll(async () => {
  await t.close();
});

describe('roles list and detail', () => {
  it('lists roles with people counts, Owner first', async () => {
    const res = await (await as('u1')).get('/roles').expect(200);
    const rows = res.body.items as { name: string; peopleCount: number; isOwner: boolean }[];
    expect(rows.map((r) => r.name)).toEqual([
      'Owner',
      'Department head',
      'Franchise owner',
      'Principal',
      'Teacher',
    ]);
    expect(rows.find((r) => r.name === 'Teacher')?.peopleCount).toBe(9);
  });

  it('shows a role’s grants; the Owner role is not editable', async () => {
    const owner = await (await as('u1')).get(`/roles/${role('owner')}`).expect(200);
    expect(owner.body).toMatchObject({ isOwner: true, canEdit: false });
    const teacher = await (await as('u1')).get(`/roles/${role('teacher')}`).expect(200);
    expect(teacher.body.modules.tasks).toEqual({ actions: ['view', 'edit'], reach: 'own' });
    expect(teacher.body.fields.tasks.watchers).toMatchObject({ access: 'hidden' });
  });

  it('needs roles.view', async () => {
    await (await as('u5')).get('/roles').expect(403);
    await (await as('u5')).get(`/roles/${role('teacher')}`).expect(403);
  });

  it('lists only roles someone may give, for the Add user drawer', async () => {
    const fo = await (await as('u4')).get('/roles/assignable').expect(200);
    // Their own role, and roles within it; never Owner or Department head.
    expect((fo.body.items as { name: string }[]).map((r) => r.name)).toEqual([
      'Franchise owner',
      'Principal',
      'Teacher',
    ]);
    await (await as('u9')).get('/roles/assignable').expect(403);
  });
});

describe('creating and editing roles', () => {
  it('creates a role, optionally copying another', async () => {
    const res = await (
      await as('u1')
    )
      .post('/roles', {
        name: 'Coordinator',
        description: 'Runs events',
        copyFromRoleId: role('principal'),
      })
      .expect(201);
    expect(res.body.modules.tasks).toEqual({
      actions: ['view', 'create', 'edit', 'assign', 'approve'],
      reach: 'team',
    });
    await (await as('u1')).post('/roles', { name: 'coordinator' }).expect(409);
    await (await as('u1')).post('/roles', { name: '' }).expect(400);
  });

  it('refuses to copy a role more powerful than yours (addition b)', async () => {
    const res = await (
      await as('u2')
    )
      .post('/roles', { name: 'Big', copyFromRoleId: role('franchise_owner') })
      .expect(403);
    expect(res.body.error.message).toMatch(/more access than your own role/);
  });

  it('never lets anyone edit the Owner role', async () => {
    await (await as('u1')).put(`/roles/${role('owner')}`, { name: 'Boss' }).expect(422);
    await (await as('u1')).put(`/roles/${role('owner')}/permissions`, { modules: {} }).expect(422);
    await (await as('u1')).delete(`/roles/${role('owner')}`).expect(422);
  });

  it('normalises actions: anything implies view', async () => {
    const created = await (await as('u1')).post('/roles', { name: 'Normaliser' }).expect(201);
    const res = await (
      await as('u1')
    )
      .put(`/roles/${created.body.id as string}/permissions`, {
        modules: {
          tasks: { actions: ['approve'], reach: 'team' },
          schools: { actions: ['view'], reach: 'all' },
        },
      })
      .expect(200);
    expect(res.body.modules).toEqual({
      tasks: { actions: ['view', 'approve'], reach: 'team' },
      schools: { actions: ['view'], reach: null },
    });
    await (
      await as('u1')
    )
      .put(`/roles/${created.body.id as string}/permissions`, {
        modules: { nope: { actions: ['view'], reach: null } },
      })
      .expect(400);
  });

  it('refuses edits that add power beyond the editor’s own role (addition b)', async () => {
    const dept = await as('u2');
    // Adding users.delete to Teacher: Department heads can't delete users.
    const res = await dept
      .put(`/roles/${role('teacher')}/permissions`, {
        modules: {
          tasks: { actions: ['view', 'edit'], reach: 'own' },
          task_reports: { actions: ['view'], reach: 'own' },
          hrms_staff: { actions: ['view'], reach: 'own' },
          users: { actions: ['view', 'delete'], reach: 'all' },
        },
      })
      .expect(403);
    expect(res.body.error.message).toMatch(/Users: Delete/);
    // Showing a field their own role hides is also more power.
    await dept
      .put(`/roles/${role('principal')}/fields`, {
        fields: { users: { mobile: { access: 'view', ownRecord: 'same', needsApproval: false } } },
      })
      .expect(403);
  });

  it('still lets them reduce or rename a role stronger than theirs', async () => {
    const dept = await as('u2');
    await dept
      .put(`/roles/${role('franchise_owner')}`, { description: 'Owns franchise schools' })
      .expect(200);
    const res = await dept
      .put(`/roles/${role('franchise_owner')}/permissions`, {
        modules: {
          tasks: {
            actions: ['view', 'create', 'edit', 'delete', 'assign', 'approve'],
            reach: 'school',
          },
          users: { actions: ['view', 'create', 'edit'], reach: 'school' },
          schools: { actions: ['view'], reach: null },
          hrms_staff: { actions: ['view', 'create', 'edit'], reach: 'school' },
          dayend: { actions: ['view', 'create', 'edit'], reach: 'school' },
          task_reports: { actions: ['view', 'export'], reach: 'school' },
        },
      })
      .expect(200);
    expect(res.body.modules.organisation).toBeUndefined();
  });

  it('only allows field rules on sections the role can view (rule 6)', async () => {
    const res = await (
      await as('u1')
    )
      .put(`/roles/${role('teacher')}/fields`, {
        fields: {
          schools: { city: { access: 'hidden', ownRecord: 'same', needsApproval: false } },
        },
      })
      .expect(422);
    expect(res.body.error.message).toMatch(/Turn on View for Schools first/);
    await (
      await as('u1')
    )
      .put(`/roles/${role('teacher')}/fields`, {
        fields: { tasks: { nope: { access: 'hidden', ownRecord: 'same', needsApproval: false } } },
      })
      .expect(400);
  });

  it('refuses to delete a role people hold, and deletes an empty one', async () => {
    const res = await (await as('u1')).delete(`/roles/${role('teacher')}`).expect(409);
    expect(res.body.error.message).toMatch(/Move them to another role first/);
    const created = await (await as('u1')).post('/roles', { name: 'Unused' }).expect(201);
    await (await as('u1')).delete(`/roles/${created.body.id as string}`).expect(204);
    await (await as('u1')).get(`/roles/${created.body.id as string}`).expect(404);
  });

  it('needs roles.edit to change anything', async () => {
    await (await as('u4')).put(`/roles/${role('teacher')}`, { name: 'x' }).expect(403);
  });
});

describe('Manage people', () => {
  it('lists holders with their scope', async () => {
    const res = await (await as('u1')).get(`/roles/${role('principal')}/assignments`).expect(200);
    expect((res.body.items as { fullName: string }[]).map((h) => h.fullName).sort()).toEqual([
      'Arjun Das',
      'Kavita Nair',
      'Meera Iyer',
      'Sanjay Kulkarni',
    ]);
  });

  it('gives a role with a school scope and takes it away', async () => {
    const owner = await as('u1');
    await owner
      .post(`/roles/${role('teacher')}/assignments`, {
        userId: u('u14'),
        scope: { allSchools: false, schoolIds: [school('jh')] },
      })
      .expect(204);
    const rahul = await owner.get(`/users/${u('u14')}`).expect(200);
    expect(rahul.body.role).toMatchObject({
      name: 'Teacher',
      scope: { schoolIds: [school('jh')] },
    });
    await owner.delete(`/roles/${role('teacher')}/assignments/${u('u14')}`).expect(204);
    expect((await owner.get(`/users/${u('u14')}`)).body.role).toBeNull();
  });

  it('applies the power rule and scope rule to giving', async () => {
    const dept = await as('u2');
    await dept
      .post(`/roles/${role('owner')}/assignments`, {
        userId: u('u14'),
        scope: { allSchools: true, schoolIds: [] },
      })
      .expect(403);
    await dept
      .post(`/roles/${role('franchise_owner')}/assignments`, {
        userId: u('u14'),
        scope: { allSchools: false, schoolIds: [school('jh')] },
      })
      .expect(403);
  });

  it('refuses another organisation’s person or school', async () => {
    await (
      await as('u1')
    )
      .post(`/roles/${role('teacher')}/assignments`, {
        userId: t.second.users.s2,
        scope: { allSchools: true, schoolIds: [] },
      })
      .expect(404);
    await (
      await as('u1')
    )
      .post(`/roles/${role('teacher')}/assignments`, {
        userId: u('u14'),
        scope: { allSchools: false, schoolIds: [t.second.schools.mp] },
      })
      .expect(404);
  });
});

describe('automatic roles', () => {
  it('shows and saves the reporting-manager switches', async () => {
    const owner = await as('u1');
    const res = await owner.get('/automatic-roles').expect(200);
    expect(
      (res.body.switches as { key: string; enabled: boolean }[]).map((s) => [s.key, s.enabled]),
    ).toEqual([
      ['manager_sees_team_tasks', true],
      ['manager_approves_team_work', true],
      ['manager_releases_team_logout', true],
      ['manager_sees_team_reports', true],
    ]);
    const saved = await owner
      .put('/automatic-roles', { switches: { manager_approves_team_work: false } })
      .expect(200);
    expect(saved.body.switches[1]).toMatchObject({ enabled: false });
    await owner.put('/automatic-roles', { switches: { nope: true } }).expect(400);
    await (await as('u5')).put('/automatic-roles', { switches: {} }).expect(403);
  });
});

describe('done when (brief phase 2): hiding a field removes it from that person’s API responses', () => {
  it('hides Mobile number from Principals', async () => {
    const meera = await as('u5');
    const before = await meera.get('/users?limit=50').expect(200);
    expect((before.body.items as Record<string, unknown>[]).some((i) => 'mobile' in i)).toBe(true);

    await (
      await as('u1')
    )
      .put(`/roles/${role('principal')}/fields`, {
        fields: {
          users: { mobile: { access: 'hidden', ownRecord: 'same', needsApproval: false } },
        },
      })
      .expect(200);

    const after = await meera.get('/users?limit=50').expect(200);
    expect((after.body.items as Record<string, unknown>[]).some((i) => 'mobile' in i)).toBe(false);
    const one = await meera.get(`/users/${u('u8')}`).expect(200);
    expect(one.body).not.toHaveProperty('mobile');
    expect(JSON.stringify(after.body)).not.toContain('+919848044108');
  });
});
