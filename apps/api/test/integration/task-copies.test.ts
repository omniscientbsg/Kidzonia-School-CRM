import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TASK_STATUSES } from '@kidzonia/shared';
import type { TaskStatus } from '@kidzonia/shared';
import { createTestApp, people } from '../support/app.js';
import type { TestApp } from '../support/app.js';
import { atLocal } from '../support/tasks.js';

/**
 * Doing, submitting and deciding one person's copy (brief 9.4, 9.6): every
 * endpoint from every starting status, the wrong people, races, and the
 * decisions taken at approval (5, 6).
 */

let t: TestApp;
const as = people(() => t);
const u = (k: string) => t.demo.users[k] ?? '';

beforeAll(async () => {
  t = await createTestApp();
  atLocal(t, '07:00');
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.prisma.rateLimit.deleteMany();
});

type Body = Record<string, unknown>;

/** Meera gives Priya a task with one sub-task (approval as asked). */
async function priyaTask(needsApproval = true) {
  const res = await (
    await as('u5')
  )
    .post('/tasks', {
      title: `Copy test ${String(Math.random()).slice(2, 8)}`,
      target: { userIds: [u('u8')] },
      subtasks: [{ title: 'Only step' }],
      needsApproval,
    })
    .expect(201);
  const copy = await t.prisma.taskAssignment.findFirstOrThrow({
    where: { taskId: res.body.id as string },
  });
  const sub = (copy.snapshot as { subtasks: { id: string }[] }).subtasks[0]?.id ?? '';
  return { taskId: res.body.id as string, copyId: copy.id, subId: sub };
}

async function setStatus(copyId: string, status: TaskStatus, tickAll = true) {
  const c = await t.prisma.taskAssignment.update({
    where: { id: copyId },
    data: { status, cancelReason: status === 'cancelled' ? 'test' : null },
  });
  if (tickAll) {
    for (const s of (c.snapshot as { subtasks: { id: string }[] }).subtasks) {
      await t.prisma.taskAssignmentSubtask.upsert({
        where: { assignmentId_subtaskId: { assignmentId: copyId, subtaskId: s.id } },
        create: {
          organisationId: t.demo.organisationId,
          assignmentId: copyId,
          subtaskId: s.id,
          doneBy: u('u8'),
        },
        update: {},
      });
    }
  }
}

const OPEN: TaskStatus[] = ['todo', 'in_progress', 'sent_back', 'overdue'];

describe('each endpoint from every status (moves enforced on the server)', () => {
  for (const from of TASK_STATUSES) {
    const open = OPEN.includes(from);

    it(`submit from ${from}: ${open ? 'allowed' : 'refused'}`, async () => {
      const { copyId } = await priyaTask();
      await setStatus(copyId, from);
      const res = await (await as('u8')).post(`/assignments/${copyId}/submit`);
      expect(res.status).toBe(open ? 200 : 409);
      if (open) expect(res.body.status).toBe('submitted');
    });

    it(`mark as done from ${from}: ${open ? 'allowed' : 'refused'}`, async () => {
      const { copyId } = await priyaTask(false);
      await setStatus(copyId, from);
      const res = await (await as('u8')).post(`/assignments/${copyId}/submit`);
      expect(res.status).toBe(open ? 200 : 409);
      if (open) expect(res.body.status).toBe('done');
    });

    for (const [path, to] of [
      ['approve', 'approved'],
      ['send-back', 'sent_back'],
    ] as const) {
      it(`${path} from ${from}: ${from === 'submitted' ? 'allowed' : 'refused'}`, async () => {
        const { copyId } = await priyaTask();
        await setStatus(copyId, from);
        const res = await (
          await as('u5')
        ).post(`/assignments/${copyId}/${path}`, { remarks: null });
        expect(res.status).toBe(from === 'submitted' ? 200 : 409);
        if (from === 'submitted') expect(res.body.status).toBe(to);
      });
    }

    const cancellable = open || from === 'submitted';
    it(`cancel from ${from}: ${cancellable ? 'allowed' : 'refused'}`, async () => {
      const { copyId } = await priyaTask();
      await setStatus(copyId, from);
      const res = await (
        await as('u5')
      ).post(`/assignments/${copyId}/cancel`, { reason: 'Not needed now' });
      expect(res.status).toBe(cancellable ? 200 : 409);
    });

    it(`tick from ${from}: ${open ? 'allowed' : 'refused'}`, async () => {
      const { copyId, subId } = await priyaTask();
      await setStatus(copyId, from, false);
      const res = await (
        await as('u8')
      ).put(`/assignments/${copyId}/subtasks/${subId}`, { done: true });
      expect(res.status).toBe(open ? 200 : 422);
    });
  }
});

describe('doing the work', () => {
  it('starts on the first tick, and can’t be submitted until everything is ticked', async () => {
    const { copyId, subId } = await priyaTask();
    await (await as('u8')).post(`/assignments/${copyId}/submit`).expect(422);
    const ticked = await (
      await as('u8')
    )
      .put(`/assignments/${copyId}/subtasks/${subId}`, { done: true })
      .expect(200);
    expect(ticked.body.status).toBe('in_progress');
    expect(ticked.body.can.submit).toBe(true);
    const unticked = await (
      await as('u8')
    )
      .put(`/assignments/${copyId}/subtasks/${subId}`, { done: false })
      .expect(200);
    expect(unticked.body.status).toBe('in_progress');
    expect(unticked.body.can.submit).toBe(false);
  });

  it('records one activity row per action, found in the person’s feed', async () => {
    const { taskId, copyId, subId } = await priyaTask();
    const created = await t.prisma.activity.findMany({ where: { entityId: taskId } });
    expect(created).toHaveLength(1);
    expect(created[0]?.subjectUserIds.sort()).toEqual([u('u5'), u('u8')].sort());
    await (
      await as('u8')
    )
      .put(`/assignments/${copyId}/subtasks/${subId}`, { done: true })
      .expect(200);
    await (await as('u8')).post(`/assignments/${copyId}/submit`).expect(200);
    const all = await t.prisma.activity.findMany({ where: { entityId: taskId } });
    // Created; ticking (started); submitted: one row each, all about the task.
    expect(all).toHaveLength(3);
    expect(all.every((a) => a.entityType === 'task')).toBe(true);
    const feed = await t.deps.data.activityAbout(t.demo.organisationId, u('u8'));
    expect(feed.filter((f) => f.entityId === taskId)).toHaveLength(3);
    const others = await t.deps.data.activityAbout(t.demo.organisationId, u('u10'));
    expect(others.some((f) => f.entityId === taskId)).toBe(false);
  });

  it('answers a repeated submit with 409 and the current status', async () => {
    const { copyId, subId } = await priyaTask();
    await (
      await as('u8')
    )
      .put(`/assignments/${copyId}/subtasks/${subId}`, { done: true })
      .expect(200);
    await (await as('u8')).post(`/assignments/${copyId}/submit`).expect(200);
    const again = await (await as('u8')).post(`/assignments/${copyId}/submit`).expect(409);
    expect(again.body.error.details).toEqual({ status: 'submitted' });
    expect(again.body.error.message).toBe('This was already submitted.');
  });

  it('lets only the right people act', async () => {
    const { copyId } = await priyaTask();
    await setStatus(copyId, 'in_progress');
    await (await as('u5')).post(`/assignments/${copyId}/submit`).expect(403); // the approver
    await (await as('u9')).post(`/assignments/${copyId}/submit`).expect(404); // can't even see it
    await (await as('u8')).post(`/assignments/${copyId}/submit`).expect(200);
    await (await as('u8')).post(`/assignments/${copyId}/approve`).expect(403); // not your own
    await (await as('u2')).post(`/assignments/${copyId}/approve`).expect(403); // can see, isn't approver
  });
});

describe('approving and sending back (brief 9.6)', () => {
  it('sends back with remarks the person sees, then approves the resubmission', async () => {
    const { copyId } = await priyaTask();
    await setStatus(copyId, 'submitted');
    await (
      await as('u5')
    )
      .post(`/assignments/${copyId}/send-back`, { remarks: 'Add the photo of the fire exit' })
      .expect(200);
    const mine = await (await as('u8')).get(`/assignments/${copyId}`).expect(200);
    expect(mine.body).toMatchObject({
      status: 'sent_back',
      remarks: 'Add the photo of the fire exit',
    });
    await (await as('u8')).post(`/assignments/${copyId}/submit`).expect(200);
    const approved = await (
      await as('u5')
    )
      .post(`/assignments/${copyId}/approve`, { remarks: 'Thanks' })
      .expect(200);
    expect(approved.body.status).toBe('approved');
    const audit = await t.prisma.auditLog.findMany({
      where: { entityId: copyId },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual(['task_copy.sent_back', 'task_copy.approved']);
  });

  it('refuses remarks when the approver’s role makes them view-only', async () => {
    await t.prisma.roleFieldPermission.create({
      data: {
        organisationId: t.demo.organisationId,
        roleId: t.demo.roles.principal ?? '',
        moduleKey: 'tasks',
        fieldKey: 'remarks',
        access: 'view',
      },
    });
    try {
      const { copyId } = await priyaTask();
      await setStatus(copyId, 'submitted');
      await (
        await as('u5')
      )
        .post(`/assignments/${copyId}/approve`, { remarks: 'Nice' })
        .expect(403);
      await (await as('u5')).post(`/assignments/${copyId}/approve`, { remarks: null }).expect(200);
    } finally {
      await t.prisma.roleFieldPermission.deleteMany({
        where: { roleId: t.demo.roles.principal ?? '', moduleKey: 'tasks' },
      });
    }
  });

  it('routes someone’s own work to their manager (decision 5)', async () => {
    const res = await (
      await as('u5')
    )
      .post('/tasks', {
        title: 'My own report',
        target: { userIds: [u('u5')] },
        needsApproval: true,
      })
      .expect(201);
    const copy = await t.prisma.taskAssignment.findFirstOrThrow({
      where: { taskId: res.body.id as string },
    });
    expect(copy.approverUserId).toBe(u('u1'));
  });

  it('completes an Owner’s own work without approval, and audits it (decision 5)', async () => {
    const res = await (
      await as('u1')
    )
      .post('/tasks', { title: 'Owner’s own', target: { userIds: [u('u1')] }, needsApproval: true })
      .expect(201);
    const copy = await t.prisma.taskAssignment.findFirstOrThrow({
      where: { taskId: res.body.id as string },
    });
    expect(copy).toMatchObject({ needsApproval: false, approverUserId: null });
    const done = await (await as('u1')).post(`/assignments/${copy.id}/submit`).expect(200);
    expect(done.body.status).toBe('done');
    const audit = await t.prisma.auditLog.findFirst({
      where: { entityId: copy.id, action: 'task_copy.completed_without_approver' },
    });
    expect(audit).not.toBeNull();
  });

  it('moves waiting approvals when the approver is deactivated', async () => {
    const res = await (
      await as('u7')
    )
      .post('/tasks', {
        title: 'Gachibowli check',
        target: { userIds: [u('u13')] },
        needsApproval: true,
      })
      .expect(201);
    const copy = await t.prisma.taskAssignment.findFirstOrThrow({
      where: { taskId: res.body.id as string },
    });
    expect(copy.approverUserId).toBe(u('u7'));
    await (await as('u13')).post(`/assignments/${copy.id}/submit`).expect(200);
    await (await as('u1')).post(`/users/${u('u7')}/deactivate`, {}).expect(200);
    const moved = await t.prisma.taskAssignment.findUniqueOrThrow({ where: { id: copy.id } });
    // Arjun reports to Ananya, who now decides it.
    expect(moved.approverUserId).toBe(u('u1'));
    const approvals = await (await as('u1')).get('/assignments?tab=approvals').expect(200);
    expect(approvals.body.items.map((i: Body) => i.id)).toContain(copy.id);
  });
});

describe('cancelling one person’s copy (decision 6)', () => {
  it('needs a reason, which the person sees', async () => {
    const { copyId } = await priyaTask();
    await (await as('u5')).post(`/assignments/${copyId}/cancel`, { reason: '' }).expect(400);
    await (
      await as('u5')
    )
      .post(`/assignments/${copyId}/cancel`, { reason: 'Room is being painted' })
      .expect(200);
    const mine = await (await as('u8')).get(`/assignments/${copyId}`).expect(200);
    expect(mine.body).toMatchObject({ status: 'cancelled', cancelReason: 'Room is being painted' });
  });

  it('is open to edit reach over the person, not to watchers or the person', async () => {
    // Vikram's head-office task: Meera has edit reach over her teachers.
    const copy = await t.prisma.taskAssignment.findFirstOrThrow({
      where: { taskId: t.tasks.tasks.t2 ?? '', userId: u('u12') },
    });
    await (
      await as('u12')
    )
      .post(`/assignments/${copy.id}/cancel`, { reason: 'I am busy' })
      .expect(403);
    // Meera watches t2 but has no reach over Divya (Kondapur).
    await (
      await as('u5')
    )
      .post(`/assignments/${copy.id}/cancel`, { reason: 'Not mine' })
      .expect(403);
    await (
      await as('u6')
    )
      .post(`/assignments/${copy.id}/cancel`, { reason: 'On leave this week' })
      .expect(200);
  });

  it('shows cancelled work with its reason in My tasks', async () => {
    const res = await (await as('u12')).get('/assignments?tab=my&limit=200').expect(200);
    const row = res.body.items.find((i: Body) => i.cancelReason === 'On leave this week');
    expect(row?.status).toBe('cancelled');
  });
});
