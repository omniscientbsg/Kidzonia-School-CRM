import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, zonedInstant } from '@kidzonia/shared';
import { TaskSchedule } from '../../src/apps/tasks/schedule.js';
import { createTestApp, people } from '../support/app.js';
import type { TestApp } from '../support/app.js';

/** Day-end reports (brief 9.11, Phase 4 e): forms, versions, roles, Today. */

const MONDAY = '2026-10-05';
const TUESDAY = addDays(MONDAY, 1);
const at = (date: string, time: string) => zonedInstant(date, time, 'Asia/Kolkata');

let t: TestApp;
let schedule: TaskSchedule;
const as = people(() => t);
const u = (k: string) => t.demo.users[k] ?? '';

beforeAll(async () => {
  t = await createTestApp({}, { now: at(MONDAY, '07:00') });
  schedule = new TaskSchedule(t.deps);
  await schedule.run(t.clock.now);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.prisma.rateLimit.deleteMany();
});

type Body = Record<string, unknown>;
const formTask = (form: string) =>
  t.prisma.task.findFirstOrThrow({
    where: { dayEndFormId: t.tasks.forms[form] ?? '', cancelledAt: null },
  });
async function report(form: string, key: string, date: string) {
  const task = await formTask(form);
  return t.prisma.taskAssignment.findFirst({
    where: { taskId: task.id, userId: u(key), serviceDate: new Date(`${date}T00:00:00Z`) },
  });
}
const versionOf = (c: { snapshot: unknown } | null) =>
  (c?.snapshot as { form?: { version: number } } | undefined)?.form?.version;

describe('forms', () => {
  it('lists the demo forms for people with Day-end reports', async () => {
    const res = await (await as('u4')).get('/day-end-forms').expect(200);
    expect(res.body.items.map((f: Body) => f.name)).toEqual([
      'Teacher day-end report',
      'Principal day-end report',
    ]);
    expect(res.body.items[0].questions).toHaveLength(4);
    await (await as('u8')).get('/day-end-forms').expect(403);
  });

  it('refuses a form without questions or with a duplicate name', async () => {
    const owner = await as('u1');
    await owner
      .post('/day-end-forms', { name: 'Empty', roleIds: [t.demo.roles.teacher], questions: [] })
      .expect(400);
    await owner
      .post('/day-end-forms', {
        name: 'teacher day-end report',
        roleIds: [t.demo.roles.teacher],
        questions: [{ id: 'a', text: 'Ok?', type: 'yes_no', required: true }],
      })
      .expect(409);
  });

  it('shows the form’s name as "Assigned by" (answer 5)', async () => {
    const task = await formTask('f1');
    const res = await (await as('u8')).get(`/tasks/${task.id}`).expect(200);
    expect(res.body.creator.fullName).toBe('Teacher day-end report');
    expect(res.body.myCopy.questions).toHaveLength(4);
  });
});

describe('versions: each copy keeps the questions it was given', () => {
  it('moves only untouched copies to a new version', async () => {
    // Priya starts today's report; Rohan filed his (seed).
    const priyaToday = await report('f1', 'u8', MONDAY);
    await (
      await as('u8')
    )
      .post(`/assignments/${priyaToday?.id ?? ''}/answers`, { answers: { guardian: true } })
      .expect(200);

    const current = (await (await as('u1')).get('/day-end-forms').expect(200)).body
      .items[0] as Body;
    const questions = [
      ...(current.questions as Body[]),
      {
        id: 'water',
        text: 'Were water bottles refilled?',
        type: 'yes_no',
        required: false,
        options: [],
      },
    ];
    const updated = await (
      await as('u1')
    )
      .put(`/day-end-forms/${t.tasks.forms.f1 ?? ''}`, { questions })
      .expect(200);
    expect(updated.body.version).toBe(2);
    await schedule.run(t.clock.now);

    expect(versionOf(await report('f1', 'u8', MONDAY))).toBe(1); // started
    expect(versionOf(await report('f1', 'u9', MONDAY))).toBe(1); // filed
    expect(versionOf(await report('f1', 'u10', MONDAY))).toBe(2); // untouched, before the deadline
    expect(versionOf(await report('f1', 'u8', TUESDAY))).toBe(2); // tomorrow

    // A filed report still reads with its own questions.
    const rohan = await report('f1', 'u9', MONDAY);
    const res = await (await as('u5')).get(`/assignments/${rohan?.id ?? ''}`).expect(200);
    expect(res.body.questions).toHaveLength(4);
    expect(res.body.answers.present).toBe(18);
  });

  it('switches someone’s form from their next untouched copy when their role changes', async () => {
    await (
      await as('u1')
    )
      .put(`/users/${u('u10')}/role`, {
        role: {
          roleId: t.demo.roles.principal,
          scope: { allSchools: false, schoolIds: [t.demo.schools.jh] },
        },
      })
      .expect(200);
    await schedule.run(t.clock.now);
    expect(await report('f1', 'u10', TUESDAY)).toBeNull();
    expect(await report('f2', 'u10', TUESDAY)).not.toBeNull();
  });
});

describe('Today tab', () => {
  it('shows a principal their team’s reports, and lets them release', async () => {
    const res = await (await as('u5')).get('/day-end/today').expect(200);
    const rows = res.body.rows as Body[];
    const names = rows.map((r) => (r.person as Body).fullName);
    expect(names).toEqual(expect.arrayContaining(['Priya Sharma', 'Rohan Gupta']));
    expect(names).not.toContain('Imran Sheikh');
    const rohan = rows.find((r) => (r.person as Body).fullName === 'Rohan Gupta');
    expect(rohan).toMatchObject({ status: 'done', canRelease: true, blocking: false });
    await (await as('u8')).get('/day-end/today').expect(403);
  });
});

describe('answers', () => {
  it('only the person can answer, while it’s open', async () => {
    const priya = await report('f1', 'u8', MONDAY);
    await (
      await as('u5')
    )
      .post(`/assignments/${priya?.id ?? ''}/answers`, { answers: { guardian: false } })
      .expect(403);
    await (
      await as('u8')
    )
      .post(`/assignments/${priya?.id ?? ''}/answers`, { answers: { mood: 'x' } })
      .expect(400);
  });
});

describe('new and removed forms', () => {
  it('gives a new form to everyone with its roles, and removing it keeps filed reports', async () => {
    const created = await (
      await as('u1')
    )
      .post('/day-end-forms', {
        name: 'Franchise owner weekly check',
        roleIds: [t.demo.roles.franchise_owner],
        questions: [{ id: 'fees', text: 'Fees collected?', type: 'yes_no', required: true }],
      })
      .expect(201);
    expect(t.scheduleRequests).toContain(t.demo.organisationId);
    await schedule.run(t.clock.now);
    const task = await t.prisma.task.findFirstOrThrow({
      where: { dayEndFormId: created.body.id as string },
    });
    const suresh = await t.prisma.taskAssignment.findMany({
      where: { taskId: task.id, userId: u('u4') },
    });
    expect(suresh.length).toBeGreaterThan(0);

    await (await as('u1')).delete(`/day-end-forms/${created.body.id as string}`).expect(204);
    const after = await t.prisma.taskAssignment.findMany({ where: { taskId: task.id } });
    expect(after.every((c) => c.status === 'cancelled')).toBe(true);
    await schedule.run(t.clock.now);
    expect(
      await t.prisma.taskAssignment.count({
        where: { taskId: task.id, status: { not: 'cancelled' } },
      }),
    ).toBe(0);
  });
});
