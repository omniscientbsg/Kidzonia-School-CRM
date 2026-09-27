import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, zonedInstant } from '@kidzonia/shared';
import { TaskSchedule } from '../../src/apps/tasks/schedule.js';
import { as as asSession, createTestApp, mobileOf, signIn } from '../support/app.js';
import type { TestApp } from '../support/app.js';
import { pdf } from '../support/tasks.js';

/**
 * The logout block (brief 9.7, Phase 4 d and addition a) and its three
 * escape hatches. Monday 2026-10-05 in Kolkata; blocking tasks are due at
 * 16:00 and block from 14:00 (the default 120 minutes before).
 */

const MONDAY = '2026-10-05';
const TUESDAY = addDays(MONDAY, 1);
const at = (date: string, time: string) => zonedInstant(date, time, 'Asia/Kolkata');

let t: TestApp;
const u = (k: string) => t.demo.users[k] ?? '';

beforeAll(async () => {
  t = await createTestApp({}, { now: at(MONDAY, '07:00') });
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.prisma.rateLimit.deleteMany();
});

type Body = Record<string, unknown>;

/** Logging out ends the session, so each attempt signs in afresh. */
async function logout(key: string, status: number) {
  const s = await signIn(t, mobileOf(key), t.demo.organisationId);
  return asSession(t, s).post('/auth/logout').expect(status);
}

/**
 * A fresh session each time: the test clock jumps whole days, past the
 * access token's lifetime, so cached sessions would expire.
 */
async function as(key: string) {
  return asSession(t, await signIn(t, mobileOf(key), t.demo.organisationId));
}

const dayEndCopy = async (key: string, date: string) => {
  const task = await t.prisma.task.findFirstOrThrow({
    where: { dayEndFormId: t.tasks.forms.f1 ?? '' },
  });
  return t.prisma.taskAssignment.findFirstOrThrow({
    where: { taskId: task.id, userId: u(key), serviceDate: new Date(`${date}T00:00:00Z`) },
  });
};

describe('when logout is blocked (addition a)', () => {
  it('lets Sneha leave just before the window', async () => {
    t.clock.now = at(MONDAY, '13:59');
    await logout('u10', 204);
  });

  it('blocks from the start of the window, and after the deadline, listing what to submit', async () => {
    t.clock.now = at(MONDAY, '14:00');
    const res = await logout('u10', 409);
    expect(res.body.error.code).toBe('logout_blocked');
    expect(res.body.error.details.blocks).toEqual([
      expect.objectContaining({ title: 'Teacher day-end report' }),
    ]);
    t.clock.now = at(MONDAY, '16:30');
    await logout('u10', 409);
  });

  it('with the window set to 0, blocks only once the deadline arrives', async () => {
    await (await as('u1')).put('/organisation', { logoutBlockLeadMinutes: 0 }).expect(200);
    t.clock.now = at(MONDAY, '15:59');
    await logout('u10', 204);
    t.clock.now = at(MONDAY, '16:00');
    await logout('u10', 409);
    await (await as('u1')).put('/organisation', { logoutBlockLeadMinutes: 120 }).expect(200);
    const bad = await (
      await as('u1')
    )
      .put('/organisation', { logoutBlockLeadMinutes: 900 })
      .expect(400);
    expect(bad.body.error.fields.logoutBlockLeadMinutes).toBe('At most 12 hours');
  });

  it('ends at submit, not approval', async () => {
    t.clock.now = at(MONDAY, '15:00');
    const priya = await as('u8');
    await logout('u8', 409);
    // The safety check: tick what's left and submit (it still needs Meera's approval).
    const t3 = await t.prisma.taskAssignment.findFirstOrThrow({
      where: { taskId: t.tasks.tasks.t3 ?? '', userId: u('u8') },
    });
    const detail = await priya.get(`/assignments/${t3.id}`).expect(200);
    for (const s of detail.body.subtasks as Body[]) {
      if (!s.done)
        await priya
          .put(`/assignments/${t3.id}/subtasks/${s.id as string}`, { done: true })
          .expect(200);
    }
    await priya.post(`/assignments/${t3.id}/submit`).expect(200);
    // The day-end report: answer the required questions and submit.
    const report = await dayEndCopy('u8', MONDAY);
    const early = await priya.post(`/assignments/${report.id}/submit`).expect(422);
    // The refusal names the unmet rule: questions, not sub-tasks.
    expect(early.body.error.message).toBe('Answer every required question before you submit.');
    await priya
      .post(`/assignments/${report.id}/answers`, { answers: { guardian: 'yes' } })
      .expect(400);
    await priya
      .post(`/assignments/${report.id}/answers`, {
        answers: { guardian: true, present: 17, unwell: false },
      })
      .expect(200);
    const done = await priya.post(`/assignments/${report.id}/submit`).expect(200);
    expect(done.body.status).toBe('done');
    // The safety check is still waiting for Meera, yet Priya may leave.
    const waiting = await t.prisma.taskAssignment.findUniqueOrThrow({ where: { id: t3.id } });
    expect(waiting.status).toBe('submitted');
    expect(waiting.decidedAt).toBeNull();
    await logout('u8', 204);
  });
});

describe('escape hatch 3: cancelling or deferring the copy lifts the block', () => {
  /** Meera gives Rohan (nothing else open today) a blocking task due at 16:00. */
  async function blockRohan(title: string) {
    const res = await (
      await as('u5')
    )
      .post('/tasks', {
        title,
        dueType: 'at_time',
        dueTime: '16:00',
        blocksLogout: true,
        target: { userIds: [u('u9')] },
      })
      .expect(201);
    return t.prisma.taskAssignment.findFirstOrThrow({
      where: { taskId: res.body.id as string, userId: u('u9') },
    });
  }

  it('lets Rohan log out once his manager cancels the blocking copy', async () => {
    t.clock.now = at(MONDAY, '15:00');
    await logout('u9', 204);
    const copy = await blockRohan('Lock the art cupboard');
    await logout('u9', 409);
    await (
      await as('u5')
    )
      .post(`/assignments/${copy.id}/cancel`, { reason: 'Cupboard key is with the office' })
      .expect(200);
    await logout('u9', 204);
  });

  it('lets Rohan log out once his manager defers the blocking copy to a later working day', async () => {
    const copy = await blockRohan('Return the library books');
    await logout('u9', 409);
    const wednesday = addDays(MONDAY, 2);
    const moved = await (
      await as('u5')
    )
      .post(`/assignments/${copy.id}/defer`, { toDate: wednesday, reason: 'Library shut today' })
      .expect(200);
    expect(moved.body.serviceDate).toBe(wednesday);
    await logout('u9', 204);
  });
});

describe('walking out: other writes refuse the next day', () => {
  it('refuses writes outside Tasks while an earlier day’s blocking work is open', async () => {
    t.clock.now = at(TUESDAY, '08:00');
    const sneha = await as('u10');
    const refused = await sneha.put('/me/profile', { jobTitle: 'Teacher, KG 2' }).expect(409);
    expect(refused.body.error.code).toBe('logout_blocked');
    // Tasks stay usable, and reads stay open.
    await sneha.get('/me').expect(200);
    await sneha.get('/assignments?tab=my').expect(200);
  });

  it('still lets Tasks, files and notifications writes through, and reads', async () => {
    const sneha = await as('u10');
    const res = await (
      await as('u5')
    )
      .post('/tasks', {
        title: 'Label the paint pots',
        subtasks: [{ title: 'Red and blue' }],
        target: { userIds: [u('u10')] },
      })
      .expect(201);
    const copy = await t.prisma.taskAssignment.findFirstOrThrow({
      where: { taskId: res.body.id as string, userId: u('u10') },
    });
    const detail = await sneha.get(`/assignments/${copy.id}`).expect(200);
    const [sub] = detail.body.subtasks as Body[];
    await sneha
      .put(`/assignments/${copy.id}/subtasks/${sub?.id as string}`, { done: true })
      .expect(200);
    await sneha
      .postRaw(`/assignments/${copy.id}/attachments?name=labels.pdf`, pdf(), 'application/pdf')
      .expect(201);
    await sneha.post(`/assignments/${copy.id}/submit`).expect(200);
    await sneha.post('/notifications/read-all').expect(204);
    // Everything else is still refused until the earlier day is dealt with.
    const refused = await sneha.put('/me/profile', { jobTitle: 'Teacher, KG 2' }).expect(409);
    expect(refused.body.error.code).toBe('logout_blocked');
    await sneha.get('/me').expect(200);
    await sneha.get('/notifications').expect(200);
  });
});

describe('escape hatch 1: asking for release', () => {
  it('tells the reporting manager, three times a day at most', async () => {
    const sneha = await as('u10');
    const res = await sneha
      .post('/release-requests', { note: 'Left early for a doctor’s visit' })
      .expect(201);
    expect(res.body.askedOf.fullName).toBe('Meera Iyer');
    const told = await t.prisma.notificationOutbox.findFirstOrThrow({
      where: { event: 'logout_release_requested', recipientUserId: u('u5') },
    });
    expect(told.entityId).toBe(u('u10'));
    await sneha.post('/release-requests', {}).expect(201);
    await sneha.post('/release-requests', {}).expect(201);
    await sneha.post('/release-requests', {}).expect(429);
    const audits = await t.prisma.auditLog.count({
      where: { action: 'logout.release_requested', entityId: u('u10') },
    });
    expect(audits).toBe(3);
  });
});

describe('escape hatch 2: release for a date (answer 3)', () => {
  it('lists every blocked date and releases them all, one row and one audit entry each', async () => {
    // Tuesday's report is now in its window too.
    await new TaskSchedule(t.deps).run(t.clock.now);
    t.clock.now = at(TUESDAY, '15:00');
    const meera = await as('u5');
    const screen = await meera.get(`/users/${u('u10')}/blocking`).expect(200);
    expect(screen.body.canRelease).toBe(true);
    expect(screen.body.dates.map((d: Body) => d.date)).toEqual([MONDAY, TUESDAY]);

    // Not everyone can release.
    await (await as('u9')).post(`/users/${u('u10')}/release`, { dates: [MONDAY] }).expect(404);
    await (await as('u10')).post(`/users/${u('u10')}/release`, { dates: [MONDAY] }).expect(403);
    await (await as('u6')).post(`/users/${u('u10')}/release`, { dates: [MONDAY] }).expect(404);

    const res = await meera
      .post(`/users/${u('u10')}/release`, { dates: [MONDAY, TUESDAY], reason: 'Doctor’s visit' })
      .expect(200);
    expect(res.body.dates).toEqual([]);
    const rows = await t.prisma.logoutRelease.findMany({ where: { userId: u('u10') } });
    expect(rows.map((r) => r.serviceDate.toISOString().slice(0, 10)).sort()).toEqual([
      MONDAY,
      TUESDAY,
    ]);
    const audits = await t.prisma.auditLog.count({
      where: { action: 'logout.released', entityId: u('u10') },
    });
    expect(audits).toBe(2);
    const told = await t.prisma.notificationOutbox.count({
      where: { event: 'released_for_today', recipientUserId: u('u10') },
    });
    expect(told).toBe(2);
    // Past the guard now: this answers as it always would for a teacher (no
    // Users access, so 404), not 409 "blocked".
    await (await as('u10')).put('/me/profile', { jobTitle: 'Teacher, KG 2' }).expect(404);
    await logout('u10', 204);
  });
});

describe('escape hatch 3: defer (answer 2)', () => {
  it('moves one person’s copy to another working day, within the limits', async () => {
    t.clock.now = at(TUESDAY, '09:00');
    const t4 = await t.prisma.taskAssignment.findFirstOrThrow({
      where: { taskId: t.tasks.tasks.t4 ?? '', userId: u('u8') },
    });
    const meera = await as('u5');
    const saturday = addDays(MONDAY, 5);
    const sunday = addDays(MONDAY, 6);
    // Never the person themselves.
    await (
      await as('u8')
    )
      .post(`/assignments/${t4.id}/defer`, { toDate: saturday, reason: 'Busy' })
      .expect(403);
    const off = await meera
      .post(`/assignments/${t4.id}/defer`, { toDate: sunday, reason: 'Moved' })
      .expect(400);
    expect(off.body.error.message).toBe('That’s not a working day for their school.');
    await meera
      .post(`/assignments/${t4.id}/defer`, { toDate: addDays(TUESDAY, 20), reason: 'Later' })
      .expect(400);
    await meera
      .post(`/assignments/${t4.id}/defer`, { toDate: TUESDAY, reason: 'Today' })
      .expect(400);
    await meera.post(`/assignments/${t4.id}/defer`, { toDate: saturday, reason: '' }).expect(400);

    const moved = await meera
      .post(`/assignments/${t4.id}/defer`, { toDate: saturday, reason: 'Rehearsal hall booked' })
      .expect(200);
    expect(moved.body.serviceDate).toBe(saturday);
    const audit = await t.prisma.auditLog.findFirstOrThrow({
      where: { action: 'task_copy.deferred', entityId: t4.id },
    });
    expect(audit.after).toEqual({ serviceDate: saturday, reason: 'Rehearsal hall booked' });

    // A day where they already have this task is refused.
    const t1Copy = await t.prisma.taskAssignment.findFirstOrThrow({
      where: {
        taskId: t.tasks.tasks.t1 ?? '',
        userId: u('u9'),
        serviceDate: new Date(`${TUESDAY}T00:00:00Z`),
      },
    });
    await (
      await as('u2')
    )
      .post(`/assignments/${t1Copy.id}/defer`, { toDate: addDays(TUESDAY, 1), reason: 'Clash' })
      .expect(409);
  });
});
