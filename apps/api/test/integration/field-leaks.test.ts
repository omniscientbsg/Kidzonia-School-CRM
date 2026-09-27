import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { zonedInstant } from '@kidzonia/shared';
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
