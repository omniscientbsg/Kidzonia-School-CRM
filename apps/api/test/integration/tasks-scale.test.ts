import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  });

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
