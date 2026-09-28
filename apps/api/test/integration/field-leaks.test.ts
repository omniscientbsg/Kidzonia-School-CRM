import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registry, zonedInstant } from '@kidzonia/shared';
import { TaskSchedule } from '../../src/apps/tasks/schedule.js';
import { createTestApp, people } from '../support/app.js';
import type { TestApp } from '../support/app.js';

/**
 * Field permissions on screens that build their own shapes rather than going
 * through serialize() (found by the brief audit): a hidden field must not
 * reach them either (brief 6.2 rule 5, 6.4).
 */

const MONDAY = '2026-10-05';
const at = (time: string) => zonedInstant(MONDAY, time, 'Asia/Kolkata');

let t: TestApp;
const as = people(() => t);
const u = (k: string) => t.demo.users[k] ?? '';
const role = (k: string) => t.demo.roles[k] ?? '';

beforeAll(async () => {
  // 15:00: the Classroom safety check (due 16:00) blocks Priya's logout.
  t = await createTestApp({}, { now: at('15:00') });
  await new TaskSchedule(t.deps).run(t.clock.now);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.prisma.rateLimit.deleteMany();
});

async function hide(roleKey: string, moduleKey: string, fieldKey: string) {
  await t.prisma.roleFieldPermission.deleteMany({
    where: { roleId: role(roleKey), moduleKey, fieldKey },
  });
  await t.prisma.roleFieldPermission.create({
    data: {
      organisationId: t.demo.organisationId,
      roleId: role(roleKey),
      moduleKey,
      fieldKey,
      access: 'hidden',
    },
  });
}

describe('a manager’s view of what blocks someone’s logout', () => {
  it('shows the titles, unless the manager’s role hides task titles', async () => {
    const before = await (await as('u5')).get(`/users/${u('u8')}/blocking`).expect(200);
    const titles = JSON.stringify(before.body);
    expect(titles).toContain('Classroom safety check');
    await hide('principal', 'tasks', 'title');
    try {
      const after = await (await as('u5')).get(`/users/${u('u8')}/blocking`).expect(200);
      expect(JSON.stringify(after.body)).not.toContain('Classroom safety check');
      expect(after.body.dates.length).toBe(before.body.dates.length);
    } finally {
      await t.prisma.roleFieldPermission.deleteMany({
        where: { roleId: role('principal'), moduleKey: 'tasks', fieldKey: 'title' },
      });
    }
  });
});

describe('Manage people on a role', () => {
  it('leaves out names and schools the viewer’s role hides', async () => {
    // Vikram (Department head) can see Roles; hide Users names and schools from him.
    await t.prisma.rolePermission.upsert({
      where: { roleId_moduleKey: { roleId: role('dept_head'), moduleKey: 'roles' } },
      create: {
        organisationId: t.demo.organisationId,
        roleId: role('dept_head'),
        moduleKey: 'roles',
        actions: ['view'],
      },
      update: { actions: ['view'] },
    });
    const path = `/roles/${role('teacher')}/assignments`;
    const seen = await (await as('u2')).get(path).expect(200);
    expect(JSON.stringify(seen.body)).toContain('Priya Sharma');
    await hide('dept_head', 'users', 'fullName');
    await hide('dept_head', 'users', 'school');
    try {
      const res = await (await as('u2')).get(path).expect(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('Priya Sharma');
      expect(text).not.toContain('Jubilee Hills');
      expect(
        (res.body.items as { fullName: string }[]).every((i) => i.fullName === 'Name hidden'),
      ).toBe(true);
    } finally {
      await t.prisma.roleFieldPermission.deleteMany({
        where: {
          roleId: role('dept_head'),
          moduleKey: 'users',
          fieldKey: { in: ['fullName', 'school'] },
        },
      });
    }
  });
});

/**
 * The automated leak test (audit D1): hide every field of every module from
 * one role, then read every composed screen as someone in it. None of the
 * values those fields protect may appear anywhere in the responses.
 */
describe('every composed screen, with every field hidden (audit D1)', () => {
  it('shows none of the hidden values to a principal', async () => {
    const principal = role('principal');
    const lists = await t.prisma.taskList.findMany({ select: { id: true } });
    const fields = [
      ...registry.modules.flatMap((m) => (m.fields ?? []).map((f) => [m.key, f.key] as const)),
      ...lists.map((l) => ['tasks', `list_${l.id}`] as const),
    ];
    await t.prisma.roleFieldPermission.deleteMany({ where: { roleId: principal } });
    await t.prisma.roleFieldPermission.createMany({
      data: fields.map(([moduleKey, fieldKey]) => ({
        organisationId: t.demo.organisationId,
        roleId: principal,
        moduleKey,
        fieldKey,
        access: 'hidden' as const,
      })),
    });
    // A fresh notification about a task, so the bell has something to show.
    await t.prisma.notificationOutbox.deleteMany({ where: { dedupeKey: 'leak-test' } });
    try {
      const meera = await as('u5');
      const jh = t.demo.schools.jh ?? '';
      const reads = [
        '/home',
        '/notifications',
        '/search?q=Classroom',
        '/search?q=Priya',
        '/reports/tasks?range=this_month',
        `/reports/tasks/people/${u('u8')}?range=this_month`,
        '/day-end/today',
        `/users/${u('u8')}/blocking`,
        '/field-changes?view=to_approve',
        '/parent-messages',
        `/parent-contacts?schoolId=${jh}`,
        '/assignments?tab=approvals',
        '/tasks?view=team&limit=100',
      ];
      const secrets = [
        // Task titles (tasks.title) Meera would otherwise see.
        'Classroom safety check',
        'Submit weekly lesson plan',
        'Mark class attendance',
        // Her team's names and numbers (users.fullName, users.mobile).
        'Priya Sharma',
        'Rohan Gupta',
        'Sneha Pillai',
        '98480 44108',
        '+919848044108',
        // Parents and children (parent_contacts fields).
        'Neha Kumar',
        'Aarav Kumar',
        '99999',
      ];
      for (const path of reads) {
        const res = await meera.get(path);
        expect([path, res.status]).toEqual([path, 200]);
        const text = JSON.stringify(res.body);
        for (const secret of secrets) {
          expect([path, text.includes(secret) ? secret : null]).toEqual([path, null]);
        }
      }
    } finally {
      await t.prisma.roleFieldPermission.deleteMany({ where: { roleId: principal } });
    }
  });
});
