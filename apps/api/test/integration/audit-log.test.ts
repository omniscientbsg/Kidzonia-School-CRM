import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, auditLogPageSchema, localDate } from '@kidzonia/shared';
import type { AuditEntry } from '@kidzonia/shared';
import { createTestApp, people } from '../support/app.js';
import type { TestApp } from '../support/app.js';

/**
 * The Owner's audit log screen (brief 10.4). Changes are made through the
 * real API first, then read back as sentences with labelled field changes.
 */

let t: TestApp;
const as = people(() => t);
const u = (k: string) => t.demo.users[k] ?? '';
const school = (k: string) => t.demo.schools[k] ?? '';

const ids = { role: '', holiday: '', person: '' };

async function list(query = ''): Promise<{ items: AuditEntry[]; nextCursor: string | null }> {
  const res = await (await as('u1')).get(`/audit-log${query}`).expect(200);
  return auditLogPageSchema.parse(res.body);
}

beforeAll(async () => {
  t = await createTestApp();
  const owner = await as('u1');
  ids.role = (await owner.post('/roles', { name: 'Audit reviewer' }).expect(201)).body.id as string;
  await owner
    .put(`/roles/${ids.role}/permissions`, {
      modules: { tasks: { actions: ['view'], reach: 'own' } },
    })
    .expect(200);
  ids.holiday = (
    await owner
      .post('/holidays', { name: 'Audit log day', startDate: '2026-12-15', schoolIds: [] })
      .expect(201)
  ).body.id as string;
  ids.person = (
    await owner
      .post('/users', {
        fullName: 'Lakshmi Audit',
        mobile: '96660 70123',
        homeSchoolId: school('jh'),
        sendInvite: false,
      })
      .expect(201)
  ).body.id as string;
  await owner.put(`/users/${ids.person}`, { mobile: '96660 70456' }).expect(200);
  await owner.post(`/users/${ids.person}/deactivate`).expect(200);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.prisma.rateLimit.deleteMany();
});

describe('GET /audit-log (brief 10.4)', () => {
  it('lists the Owner’s changes newest first as readable sentences', async () => {
    const { items } = await list();
    expect(items.slice(0, 6).map((e) => e.action)).toEqual([
      'user.deactivated',
      'user.updated',
      'user.created',
      'holiday.created',
      'role.permissions_changed',
      'role.created',
    ]);
    const [deactivated, , created, holiday, perms, role] = items;
    expect(deactivated?.actor).toEqual({ id: u('u1'), fullName: 'Ananya Rao' });
    expect(deactivated?.summary).toBe('deactivated Lakshmi Audit');
    expect(created?.summary).toBe('added Lakshmi Audit');
    expect(holiday?.summary).toBe('added the holiday Audit log day');
    expect(holiday?.area).toBe('holidays');
    expect(perms?.summary).toBe('changed permissions for Audit reviewer');
    expect(perms?.area).toBe('roles');
    expect(role?.summary).toBe('created the role Audit reviewer');
    const times = items.map((e) => Date.parse(e.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('shows what changed with field labels, never raw keys or JSON', async () => {
    const { items } = await list();
    const byAction = (a: string) => items.find((e) => e.action === a);
    expect(byAction('role.permissions_changed')?.changes).toEqual([
      { field: 'Tasks', before: 'No access', after: 'View · Only their own' },
    ]);
    expect(byAction('holiday.created')?.changes).toEqual(
      expect.arrayContaining([
        { field: 'Name', before: null, after: 'Audit log day' },
        { field: 'Start date', before: null, after: '15 Dec 2026' },
        { field: 'Schools', before: null, after: 'All schools' },
      ]),
    );
    expect(byAction('user.created')?.changes).toContainEqual({
      field: 'School',
      before: null,
      after: 'Jubilee Hills',
    });
    for (const e of items) {
      for (const c of e.changes) {
        expect(`${c.before ?? ''}${c.after ?? ''}`).not.toMatch(/[{}]|"/);
        expect(c.field).not.toMatch(/Id$|_/);
      }
    }
  });

  it('masks mobile numbers wherever they appear', async () => {
    const { items } = await list();
    const updated = items.find((e) => e.action === 'user.updated');
    expect(updated?.changes).toEqual([
      { field: 'Mobile number', before: '+91 ••••• ••123', after: '+91 ••••• ••456' },
    ]);
    const created = items.find((e) => e.action === 'user.created');
    expect(created?.changes).toContainEqual({
      field: 'Mobile number',
      before: null,
      after: '+91 ••••• ••123',
    });
    const text = JSON.stringify(items);
    expect(text).not.toContain('9666070123');
    expect(text).not.toContain('9666070456');
    expect(text).not.toContain('96660');
  });

  it('filters by area, action, person and dates', async () => {
    const holidays = await list('?area=holidays');
    expect(holidays.items.length).toBeGreaterThan(0);
    expect(holidays.items.every((e) => e.area === 'holidays')).toBe(true);

    const users = await list('?area=users');
    expect(users.items.map((e) => e.action)).toEqual(
      expect.arrayContaining(['user.created', 'user.updated', 'user.deactivated']),
    );
    expect(users.items.every((e) => e.action.startsWith('user.'))).toBe(true);

    const created = await list('?action=role.created');
    expect(created.items.every((e) => e.action === 'role.created')).toBe(true);
    expect(created.items.some((e) => e.entityLabel === 'Audit reviewer')).toBe(true);

    const byOwner = await list(`?actorUserId=${u('u1')}`);
    expect(byOwner.items.length).toBeGreaterThanOrEqual(6);
    expect(byOwner.items.every((e) => e.actor?.id === u('u1'))).toBe(true);
    expect((await list(`?actorUserId=${u('u2')}`)).items).toEqual([]);

    const org = await (await as('u1')).get('/organisation').expect(200);
    const today = localDate(new Date(), org.body.timezone as string);
    expect((await list(`?from=${today}&to=${today}`)).items.length).toBeGreaterThanOrEqual(6);
    expect((await list(`?from=${addDays(today, 1)}`)).items).toEqual([]);
    expect((await list(`?to=${addDays(today, -1)}&area=holidays`)).items).toEqual([]);
  });

  it('pages with a cursor without skipping or repeating entries', async () => {
    const all = (await list('?limit=100')).items.map((e) => e.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await list(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((e) => e.id));
      cursor = page.nextCursor;
    } while (cursor && seen.length < 200);
    expect(seen).toEqual(all);
  });

  it('refuses bad filters', async () => {
    const owner = await as('u1');
    await owner.get('/audit-log?limit=101').expect(400);
    await owner.get('/audit-log?area=everything').expect(400);
    await owner.get('/audit-log?from=2026-10-05&to=2026-10-01').expect(400);
  });

  it('is Owner only: a department head and a principal get 403', async () => {
    await (await as('u2')).get('/audit-log').expect(403);
    await (await as('u5')).get('/audit-log').expect(403);
  });
});
