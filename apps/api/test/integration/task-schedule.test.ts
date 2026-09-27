import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, weekdayOf, zonedInstant } from '@kidzonia/shared';
import { emit } from '../../src/core/outbox.js';
import { TaskSchedule } from '../../src/apps/tasks/schedule.js';
import { createTestApp, people } from '../support/app.js';
import type { TestApp } from '../support/app.js';

/**
 * The task schedule (Phase 4 a-c, g): copies for the week, changes after
 * copies exist, overdue and closed, reminders, downtime, one run at a time,
 * and a person starting a copy while the job is working. Time is a fixed
 * Monday so the tests never depend on the real date.
 */

const MONDAY = '2026-10-05';
const at = (date: string, time: string) => zonedInstant(date, time, 'Asia/Kolkata');

let t: TestApp;
let schedule: TaskSchedule;
const as = people(() => t);
const u = (k: string) => t.demo.users[k] ?? '';

beforeAll(async () => {
  t = await createTestApp({}, { now: at(MONDAY, '07:00') });
  schedule = new TaskSchedule(t.deps);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.prisma.rateLimit.deleteMany();
});

const day = (d: Date) => d.toISOString().slice(0, 10);
const copiesOf = (taskId: string, userKey?: string) =>
  t.prisma.taskAssignment.findMany({
    where: { taskId, ...(userKey ? { userId: u(userKey) } : {}) },
    orderBy: { serviceDate: 'asc' },
  });
const run = () => schedule.run(t.clock.now);

describe('making copies for the week', () => {
  it('makes a week of copies, skipping Sundays, and a second run adds nothing', async () => {
    const first = await run();
    expect(first?.created).toBeGreaterThan(0);
    const t1 = await copiesOf(t.tasks.tasks.t1 ?? '', 'u8');
    const dates = t1.map((c) => day(c.serviceDate));
    // Monday to Saturday, then Monday: 7 days from today, Sunday skipped.
    expect(dates).toEqual([
      MONDAY,
      addDays(MONDAY, 1),
      addDays(MONDAY, 2),
      addDays(MONDAY, 3),
      addDays(MONDAY, 4),
      addDays(MONDAY, 5),
    ]);
    expect(dates.some((d) => weekdayOf(d) === 0)).toBe(false);
    const again = await run();
    expect(again?.created).toBe(0);
    const dupes = await t.prisma.taskAssignment.groupBy({
      by: ['taskId', 'userId', 'serviceDate'],
      _count: { _all: true },
      having: { id: { _count: { gt: 1 } } },
    });
    expect(dupes).toEqual([]);
  });

  it('logs every run, and Owners can see the last success', async () => {
    const runs = await t.prisma.jobRun.findMany({
      where: { job: 'task-schedule', status: 'succeeded' },
    });
    expect(runs.length).toBeGreaterThanOrEqual(2);
    const res = await (await as('u1')).get('/organisation/schedule').expect(200);
    expect(res.body.lastSuccessAt).not.toBeNull();
    // A franchise owner sees Organisation settings but not the schedule status.
    await (await as('u4')).get('/organisation/schedule').expect(404);
  });

  it('runs one at a time: a second run at the same moment skips', async () => {
    const [a, b] = await Promise.all([run(), run()]);
    expect([a, b].filter((x) => x === null)).toHaveLength(1);
  });

  it('never makes copies for past dates after downtime, and logs the gap', async () => {
    await t.prisma.jobRun.deleteMany({ where: { job: 'task-schedule' } });
    await t.prisma.jobRun.create({
      data: {
        job: 'task-schedule',
        status: 'succeeded',
        startedAt: at(addDays(MONDAY, -3), '07:00'),
        finishedAt: at(addDays(MONDAY, -3), '07:01'),
      },
    });
    const before = t.clock.now;
    await run();
    const past = await t.prisma.taskAssignment.count({
      where: { serviceDate: { lt: new Date(`${MONDAY}T00:00:00Z`) }, createdAt: { gte: before } },
    });
    expect(past).toBe(0);
    const last = await t.prisma.jobRun.findFirstOrThrow({
      where: { job: 'task-schedule', status: 'succeeded' },
      orderBy: { startedAt: 'desc' },
    });
    expect(last.gapFrom?.toISOString()).toBe(at(addDays(MONDAY, -3), '07:01').toISOString());
  });
});

describe('changes after copies exist (only untouched copies change)', () => {
  const tuesday = addDays(MONDAY, 1);

  it('removes repeating copies on a new holiday, keeps one-time ones, and warns about them', async () => {
    // A one-time task on Tuesday, then a holiday on Tuesday.
    const oneTime = await (
      await as('u5')
    )
      .post('/tasks', {
        title: 'Parent meeting notes',
        dueType: 'on_date',
        dueDate: tuesday,
        target: { userIds: [u('u8')] },
      })
      .expect(201);
    const impact = await (
      await as('u1')
    )
      .post('/holidays/impact', { startDate: tuesday, schoolIds: [] })
      .expect(200);
    expect(impact.body.oneTimeTasks).toBeGreaterThanOrEqual(1);
    expect(impact.body.titles).toContain('Parent meeting notes');

    const h = await (
      await as('u1')
    )
      .post('/holidays', { name: 'Dussehra', startDate: tuesday, schoolIds: [] })
      .expect(201);
    expect(t.scheduleRequests).toContain(t.demo.organisationId);
    await run();
    const t1 = await copiesOf(t.tasks.tasks.t1 ?? '', 'u9');
    expect(t1.map((c) => day(c.serviceDate))).not.toContain(tuesday);
    const kept = await copiesOf(oneTime.body.id as string);
    expect(kept.map((c) => day(c.serviceDate))).toEqual([tuesday]);

    // Creating a one-time task on the holiday warns first.
    const preview = await (
      await as('u5')
    )
      .post('/tasks/target-preview', { target: { userIds: [u('u8')] }, dueDate: tuesday })
      .expect(200);
    expect(preview.body.holidays).toEqual([{ name: 'Dussehra', people: 1 }]);

    // Holiday removed: the copies come back.
    await (await as('u1')).delete(`/holidays/${h.body.id as string}`).expect(204);
    await run();
    const back = await copiesOf(t.tasks.tasks.t1 ?? '', 'u9');
    expect(back.map((c) => day(c.serviceDate))).toContain(tuesday);
  });

  it('moves due times when working hours change, leaving started work alone', async () => {
    const priyaToday = (await copiesOf(t.tasks.tasks.t3 ?? '', 'u8')).find(
      (c) => day(c.serviceDate) === MONDAY,
    );
    expect(priyaToday?.status).toBe('in_progress');
    await (await as('u1')).put('/organisation', { closesAt: '17:00' }).expect(200);
    await run();
    const after = await copiesOf(t.tasks.tasks.t3 ?? '', 'u8');
    const tomorrow = after.find((c) => day(c.serviceDate) === addDays(MONDAY, 2));
    expect(tomorrow?.dueAt.toISOString()).toBe(at(addDays(MONDAY, 2), '17:00').toISOString());
    const today = after.find((c) => day(c.serviceDate) === MONDAY);
    expect(today?.dueAt.toISOString()).toBe(priyaToday?.dueAt.toISOString());
    await (await as('u1')).put('/organisation', { closesAt: '16:00' }).expect(200);
    await run();
  });

  it('follows a person to their new school’s calendar', async () => {
    await t.prisma.school.update({
      where: { id: t.demo.schools.gb ?? '' },
      data: { closesAt: '15:00' },
    });
    await (
      await as('u1')
    )
      .put(`/users/${u('u10')}`, { homeSchoolId: t.demo.schools.gb })
      .expect(200);
    await run();
    const sneha = await copiesOf(t.tasks.tasks.t3 ?? '', 'u10');
    const next = sneha.find((c) => day(c.serviceDate) === addDays(MONDAY, 2));
    expect(next?.schoolId).toBe(t.demo.schools.gb);
    expect(next?.dueAt.toISOString()).toBe(at(addDays(MONDAY, 2), '15:00').toISOString());
  });

  it('cancels untouched future copies of someone deactivated, with a reason', async () => {
    await (await as('u1')).post(`/users/${u('u17')}/deactivate`, {}).expect(200);
    const karthik = await copiesOf(t.tasks.tasks.t1 ?? '', 'u17');
    const future = karthik.filter((c) => day(c.serviceDate) > MONDAY);
    expect(future.length).toBeGreaterThan(0);
    expect(
      future.every((c) => c.status === 'cancelled' && c.cancelReason === 'No longer active.'),
    ).toBe(true);
  });

  it('cancels untouched future copies when someone loses their role', async () => {
    await (await as('u1')).put(`/users/${u('u13')}/role`, { role: null }).expect(200);
    const lakshmi = await copiesOf(t.tasks.tasks.t1 ?? '', 'u13');
    const future = lakshmi.filter((c) => day(c.serviceDate) > MONDAY);
    expect(
      future.every((c) => c.status === 'cancelled' && c.cancelReason === 'No longer has a role.'),
    ).toBe(true);
  });

  it('picks up new joiners on the next run and tells them once', async () => {
    const res = await (
      await as('u2')
    )
      .post('/tasks', {
        title: 'Morning huddle',
        repeat: 'daily',
        target: { roleIds: [t.demo.roles.teacher] },
      })
      .expect(201);
    const joiner = await t.prisma.user.create({
      data: {
        organisationId: t.demo.organisationId,
        fullName: 'New Teacher',
        mobile: '+919700000123',
        homeSchoolId: t.demo.schools.jh ?? null,
        status: 'active',
      },
    });
    await t.prisma.roleAssignment.create({
      data: {
        organisationId: t.demo.organisationId,
        userId: joiner.id,
        roleId: t.demo.roles.teacher ?? '',
      },
    });
    await run();
    await run();
    const theirs = await t.prisma.taskAssignment.count({
      where: { taskId: res.body.id as string, userId: joiner.id },
    });
    expect(theirs).toBeGreaterThan(1);
    const told = await t.prisma.notificationOutbox.count({
      where: {
        event: 'task_assigned',
        recipientUserId: joiner.id,
        entityId: res.body.id as string,
      },
    });
    expect(told).toBe(1);
  });

  it('leaves a copy alone if someone starts it while the job is working (addition b)', async () => {
    const wed = addDays(MONDAY, 2);
    const copy = (await copiesOf(t.tasks.tasks.t3 ?? '', 'u8')).find(
      (c) => day(c.serviceDate) === wed,
    );
    expect(copy?.status).toBe('todo');
    // A holiday on Wednesday would remove this copy...
    const h = await (
      await as('u1')
    )
      .post('/holidays', { name: 'Race day', startDate: wed, schoolIds: [] })
      .expect(201);
    const sub = (copy?.snapshot as { subtasks: { id: string }[] }).subtasks[0]?.id ?? '';
    // ...but Priya ticks a sub-task after the job has read it and before it writes.
    const counts = await schedule.run(t.clock.now, null, {
      beforeWrites: async () => {
        await (
          await as('u8')
        )
          .put(`/assignments/${copy?.id ?? ''}/subtasks/${sub}`, { done: true })
          .expect(200);
      },
    });
    expect(counts?.skippedStarted).toBeGreaterThanOrEqual(1);
    const still = await t.prisma.taskAssignment.findUnique({ where: { id: copy?.id ?? '' } });
    expect(still?.status).toBe('in_progress');
    await (await as('u1')).delete(`/holidays/${h.body.id as string}`).expect(204);
  });
});

describe('overdue, closed and reminders', () => {
  it('reminds an hour before, marks overdue at the deadline, closed at closing time', async () => {
    t.clock.now = at(MONDAY, '08:10');
    const res = await (
      await as('u5')
    )
      .post('/tasks', {
        title: 'Collect fees receipts',
        dueType: 'at_time',
        dueTime: '09:00',
        closesAfterMinutes: 60,
        target: { userIds: [u('u8'), u('u9')] },
      })
      .expect(201);
    const id = res.body.id as string;
    await run();
    await run();
    const soon = await t.prisma.notificationOutbox.count({
      where: { event: 'task_due_soon', entityId: id },
    });
    expect(soon).toBe(2); // once each, however often the job runs

    t.clock.now = at(MONDAY, '09:05');
    await run();
    expect((await copiesOf(id)).map((c) => c.status)).toEqual(['overdue', 'overdue']);
    const overdue = await t.prisma.notificationOutbox.count({
      where: { event: 'task_overdue', entityId: id },
    });
    expect(overdue).toBe(2);

    // Rohan submits late (still allowed); Priya doesn't, and it closes.
    const rohan = (await copiesOf(id, 'u9'))[0];
    await (await as('u9')).post(`/assignments/${rohan?.id ?? ''}/submit`).expect(200);
    t.clock.now = at(MONDAY, '10:05');
    await run();
    const priya = (await copiesOf(id, 'u8'))[0];
    expect(priya?.status).toBe('expired');
    await (await as('u8')).post(`/assignments/${priya?.id ?? ''}/submit`).expect(409);

    // Closed copies are left out of completion everywhere.
    const detail = await (await as('u5')).get(`/tasks/${id}`).expect(200);
    expect(detail.body.progress).toEqual({ total: 1, done: 1, submitted: 0, overdue: 0 });
    t.clock.now = at(MONDAY, '07:00');
  });

  it('refuses unknown events', async () => {
    const db = t.deps.data.forOrganisation(t.demo.organisationId);
    await expect(
      emit(db, t.demo.organisationId, [
        {
          event: 'task_exploded' as never,
          recipientUserId: u('u8'),
          entityType: 'task',
          entityId: u('u8'),
          dedupeKey: 'x',
        },
      ]),
    ).rejects.toThrow(/Unknown notification event/);
  });
});

describe('day-end reports follow each school’s calendar (addition c)', () => {
  it('makes no day-end copy on a school’s holiday and dues it at that school’s closing time', async () => {
    const thursday = addDays(MONDAY, 3);
    await (
      await as('u1')
    )
      .post('/holidays', {
        name: 'JH sports day',
        startDate: thursday,
        schoolIds: [t.demo.schools.jh],
      })
      .expect(201);
    await t.prisma.school.update({
      where: { id: t.demo.schools.kp ?? '' },
      data: { closesAt: '15:30' },
    });
    await run();
    const f1 = await t.prisma.task.findFirstOrThrow({
      where: { dayEndFormId: t.tasks.forms.f1 ?? '' },
    });
    const onThursday = await t.prisma.taskAssignment.findMany({
      where: { taskId: f1.id, serviceDate: new Date(`${thursday}T00:00:00Z`) },
    });
    const people = new Set(onThursday.map((c) => c.userId));
    expect(people.has(u('u8'))).toBe(false); // Jubilee Hills: holiday
    expect(people.has(u('u11'))).toBe(true); // Kondapur: a normal day
    const imran = onThursday.find((c) => c.userId === u('u11'));
    expect(imran?.dueAt.toISOString()).toBe(at(thursday, '15:30').toISOString());
  });
});
