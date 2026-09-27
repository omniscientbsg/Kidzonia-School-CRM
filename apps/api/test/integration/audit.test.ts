import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { zonedInstant } from '@kidzonia/shared';
import { createTestApp, people } from '../support/app.js';
import type { TestApp } from '../support/app.js';

/**
 * Every Settings change is written to the audit log (brief 8.2), with who made
 * it and, where the code records them, the values before and after. Each
 * change goes through the real API as the Owner.
 */

const MONDAY = '2026-10-05';
const at = (time: string) => zonedInstant(MONDAY, time, 'Asia/Kolkata');

let t: TestApp;
const as = people(() => t);
const u = (k: string) => t.demo.users[k] ?? '';
const role = (k: string) => t.demo.roles[k] ?? '';
const school = (k: string) => t.demo.schools[k] ?? '';

beforeAll(async () => {
  t = await createTestApp({}, { now: at('10:00') });
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.prisma.rateLimit.deleteMany();
});

type Body = Record<string, unknown>;

/** The newest audit row for this action and record, written by the Owner. */
async function entry(action: string, entityId: string) {
  const row = await t.prisma.auditLog.findFirstOrThrow({
    where: { organisationId: t.demo.organisationId, action, entityId },
    orderBy: { createdAt: 'desc' },
  });
  expect(row.actorUserId).toBe(u('u1'));
  return row;
}

describe('roles and permissions (brief 8.2)', () => {
  let roleId = '';

  it('records a new role with its name', async () => {
    const res = await (await as('u1')).post('/roles', { name: 'Audit coordinator' }).expect(201);
    roleId = res.body.id as string;
    const row = await entry('role.created', roleId);
    expect(row.entityType).toBe('role');
    expect(row.after).toEqual({ name: 'Audit coordinator', copiedFrom: null });
  });

  it('records a role’s permissions before and after', async () => {
    await (
      await as('u1')
    )
      .put(`/roles/${roleId}/permissions`, {
        modules: { tasks: { actions: ['view'], reach: 'own' } },
      })
      .expect(200);
    const row = await entry('role.permissions_changed', roleId);
    expect((row.before as Body).modules).toEqual({});
    expect((row.after as Body).modules).toMatchObject({
      tasks: { actions: ['view'], reach: 'own' },
    });
  });

  it('records a role’s field permissions before and after', async () => {
    await (
      await as('u1')
    )
      .put(`/roles/${roleId}/fields`, {
        fields: { tasks: { title: { access: 'hidden', ownRecord: 'same', needsApproval: false } } },
      })
      .expect(200);
    const row = await entry('role.fields_changed', roleId);
    expect(JSON.stringify((row.before as Body).fields)).not.toContain('title');
    expect((row.after as Body).fields).toMatchObject({ tasks: { title: { access: 'hidden' } } });
  });

  it('records a role given to someone and taken away (Manage people)', async () => {
    const owner = await as('u1');
    const scope = { allSchools: false, schoolIds: [school('jh')] };
    await owner
      .post(`/roles/${role('teacher')}/assignments`, { userId: u('u14'), scope })
      .expect(204);
    const given = await entry('role.given', u('u14'));
    expect(given.entityType).toBe('user');
    expect(given.after).toEqual({ roleId: role('teacher'), scope });
    await owner.delete(`/roles/${role('teacher')}/assignments/${u('u14')}`).expect(204);
    const removed = await entry('role.removed', u('u14'));
    expect(removed.before).toEqual({ roleId: role('teacher') });
  });

  it('records the automatic roles switches before and after', async () => {
    const owner = await as('u1');
    await owner
      .put('/automatic-roles', { switches: { manager_sees_team_tasks: false } })
      .expect(200);
    const row = await entry('automatic_roles.changed', t.demo.organisationId);
    expect(row.before).toMatchObject({ manager_sees_team_tasks: true });
    expect(row.after).toEqual({ manager_sees_team_tasks: false });
    await owner
      .put('/automatic-roles', { switches: { manager_sees_team_tasks: true } })
      .expect(200);
  });
});

describe('users (brief 8.2)', () => {
  let userId = '';

  it('records a new person', async () => {
    const res = await (
      await as('u1')
    )
      .post('/users', {
        fullName: 'Audit Newcomer',
        mobile: '96660 70001',
        homeSchoolId: school('jh'),
        sendInvite: false,
      })
      .expect(201);
    userId = res.body.id as string;
    const row = await entry('user.created', userId);
    expect(row.after).toMatchObject({
      fullName: 'Audit Newcomer',
      mobile: '+919666070001',
      homeSchoolId: school('jh'),
    });
  });

  it('records a role change from nothing to Teacher', async () => {
    const given = {
      roleId: role('teacher'),
      scope: { allSchools: false, schoolIds: [school('jh')] },
    };
    await (await as('u1')).put(`/users/${userId}/role`, { role: given }).expect(200);
    const row = await entry('user.role_changed', userId);
    expect(row.before).toBeNull();
    expect(row.after).toEqual(given);
  });

  it('records a deactivation', async () => {
    await (await as('u1')).post(`/users/${userId}/deactivate`).expect(200);
    const row = await entry('user.deactivated', userId);
    expect(row.after).toEqual({ movedReportsTo: null, moved: 0 });
  });
});

describe('schools, holidays and the organisation (brief 8.2)', () => {
  it('records a new school, then an edit with the old and new values', async () => {
    const owner = await as('u1');
    const res = await owner
      .post('/schools', { name: 'Audit Park', city: 'Hyderabad', type: 'coco' })
      .expect(201);
    const id = res.body.id as string;
    const created = await entry('school.created', id);
    expect(created.after).toMatchObject({ name: 'Audit Park', city: 'Hyderabad', type: 'coco' });
    await owner.put(`/schools/${id}`, { city: 'Secunderabad' }).expect(200);
    const updated = await entry('school.updated', id);
    expect(updated.before).toMatchObject({ city: 'Hyderabad' });
    expect(updated.after).toEqual({ city: 'Secunderabad' });
  });

  it('records a new holiday, and what it was when deleted', async () => {
    const owner = await as('u1');
    const res = await owner
      .post('/holidays', { name: 'Audit day', startDate: '2026-12-15', schoolIds: [] })
      .expect(201);
    const id = res.body.id as string;
    const created = await entry('holiday.created', id);
    expect(created.after).toMatchObject({ name: 'Audit day', startDate: '2026-12-15' });
    await owner.delete(`/holidays/${id}`).expect(204);
    const deleted = await entry('holiday.deleted', id);
    expect(deleted.before).toMatchObject({
      name: 'Audit day',
      startDate: '2026-12-15',
      endDate: '2026-12-15',
    });
  });

  it('records organisation settings with only the fields that changed', async () => {
    const owner = await as('u1');
    const current = await owner.get('/organisation').expect(200);
    await owner.put('/organisation', { closesAt: '17:45' }).expect(200);
    const row = await entry('organisation.updated', t.demo.organisationId);
    expect(row.before).toEqual({ closesAt: current.body.closesAt });
    expect(row.after).toEqual({ closesAt: '17:45' });
  });
});
