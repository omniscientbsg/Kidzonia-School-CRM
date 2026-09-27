import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationWorker } from '../../src/core/notifications/worker.js';
import { createTestApp, people } from '../support/app.js';
import type { TestApp } from '../support/app.js';

/**
 * Decision 3: one task can go to up to TASK_MAX_RECIPIENTS people (1,000 by
 * default), and handing it out at the limit is fast: one query to find the
 * people, batched inserts, one transaction.
 */

let t: TestApp;
const as = people(() => t);

/** Adds teachers at Jubilee Hills until the organisation has `total` of them. */
async function growTeachersTo(total: number) {
  const org = t.demo.organisationId;
  const existing = await t.prisma.roleAssignment.count({
    where: { organisationId: org, roleId: t.demo.roles.teacher ?? '' },
  });
  const extra = total - existing;
  const made = await t.prisma.user.createManyAndReturn({
    data: Array.from({ length: extra }, (_, i) => ({
      organisationId: org,
      fullName: `Teacher ${String(existing + i + 1).padStart(4, '0')}`,
      mobile: `+9170${String(10_000_000 + existing + i).slice(-8)}`,
      homeSchoolId: t.demo.schools.jh ?? null,
      reportsToUserId: t.demo.users.u5 ?? null,
      status: 'active' as const,
    })),
    select: { id: true },
  });
  await t.prisma.roleAssignment.createMany({
    data: made.map((m) => ({
      organisationId: org,
      userId: m.id,
      roleId: t.demo.roles.teacher ?? '',
    })),
  });
}

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('large assignments', () => {
  it('gives one task to 1,000 people quickly, in one go', async () => {
    await growTeachersTo(1000);
    const started = Date.now();
    const res = await (
      await as('u2')
    )
      .post('/tasks', {
        title: 'Everyone’s safety drill',
        target: { roleIds: [t.demo.roles.teacher] },
      })
      .expect(201);
    const took = Date.now() - started;
    expect(res.body.assigned).toBe(1000);
    expect(await t.prisma.taskAssignment.count({ where: { taskId: res.body.id as string } })).toBe(
      1000,
    );
    // Generous for CI; locally this takes well under a second.
    expect(took).toBeLessThan(15_000);
    // One activity row for the whole action, naming everyone it reached.
    const rows = await t.prisma.activity.findMany({ where: { entityId: res.body.id as string } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityType: 'task', action: 'assigned', taskId: res.body.id });
    expect(rows[0]?.subjectUserIds).toHaveLength(1001); // the creator and 1,000 people
    const teacher = rows[0]?.subjectUserIds.find((id) => id !== t.demo.users.u2) ?? '';
    const feed = await t.deps.data.activityAbout(t.demo.organisationId, teacher);
    expect(feed.map((f) => f.entityId)).toContain(res.body.id);
  });

  it(
    'builds the Owner’s Home across 1,000+ people inside its time budget (Phase 5 a)',
    { timeout: 60_000 },
    async () => {
      // The 1,000 copies above plus their notifications are in place.
      const started = Date.now();
      const counts = await new NotificationWorker(t.deps).run(new Date());
      // Batched: about 2 s locally. It must fit comfortably in one run (every minute),
      // even with the rest of the suite running alongside.
      expect(Date.now() - started).toBeLessThan(30_000);
      expect(counts?.inApp).toBe(1000); // one run takes as many batches as it needs
      const owner = await as('u1');
      await owner.get('/home').expect(200); // warm-up
      const took: number[] = [];
      for (let i = 0; i < 5; i++) {
        const started = Date.now();
        const res = await owner.get('/home').expect(200);
        took.push(Date.now() - started);
        expect(res.body.sections).toContain('schools');
      }
      took.sort((a, b) => a - b);
      // Budget: 400 ms (median, locally). CI machines are slower, so the test allows more.
      expect(took[2]).toBeLessThan(1_500);
    },
  );

  it('refuses one more than the limit, saying how many and the most', async () => {
    await growTeachersTo(1001);
    const res = await (
      await as('u2')
    )
      .post('/tasks', { title: 'Too many', target: { roleIds: [t.demo.roles.teacher] } })
      .expect(422);
    expect(res.body.error.message).toBe(
      'This would go to 1001 people. One task can go to at most 1000.',
    );
    const preview = await (
      await as('u2')
    )
      .post('/tasks/target-preview', { target: { roleIds: [t.demo.roles.teacher] } })
      .expect(200);
    expect(preview.body).toMatchObject({ count: 1001, limit: 1000 });
  });
});
