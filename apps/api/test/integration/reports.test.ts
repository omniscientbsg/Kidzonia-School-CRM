import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { zonedInstant } from '@kidzonia/shared';
import { safeCell } from '../../src/apps/tasks/reports.js';
import { TaskSchedule } from '../../src/apps/tasks/schedule.js';
import { as as asSession, createTestApp, mobileOf, people, signIn } from '../support/app.js';
import type { TestApp } from '../support/app.js';

/** Task reports (brief 9.14, Phase 5 d; additions b, c). */

const MONDAY = '2026-10-05';
const at = (time: string, date = MONDAY) => zonedInstant(date, time, 'Asia/Kolkata');

let t: TestApp;
const as = people(() => t);
const u = (k: string) => t.demo.users[k] ?? '';

beforeAll(async () => {
  t = await createTestApp({ RL_EXPORTS_PER_USER_HOUR: '3' }, { now: at('10:00') });
  await new TaskSchedule(t.deps).run(t.clock.now);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.prisma.rateLimit.deleteMany();
});

type Body = Record<string, unknown>;
type Row = { total: number; done: number; submitted: number; overdue: number };

describe('summary and rows come from the same filter', () => {
  // 13 filters for 4 people, each through the API: more than the default time limit.
  it('always match, for many filter combinations and people', async () => {
    const combos: string[] = [
      'range=today',
      'range=this_week',
      'range=this_month',
      `range=this_week&schoolId=${t.demo.schools.jh ?? ''}`,
      `range=this_week&roleId=${t.demo.roles.teacher ?? ''}`,
      `range=this_week&categoryId=${t.tasks.categories.Academics ?? ''}`,
      `range=this_week&priorityId=${t.tasks.priorities.High ?? ''}`,
      'range=this_week&status=open',
      'range=this_week&status=overdue',
      'range=this_week&department=Academics',
      `range=this_week&userId=${u('u8')}`,
      `range=this_week&listValue=${t.tasks.areaListId}:${t.tasks.area.Classroom ?? ''}`,
      `range=custom&from=${MONDAY}&to=2026-10-08`,
    ];
    for (const who of ['u1', 'u2', 'u4', 'u5']) {
      const client = await as(who);
      for (const q of combos) {
        const res = await client.get(`/reports/tasks?${q}`).expect(200);
        const rows = res.body.rows as Row[];
        const sum = rows.reduce(
          (a, r) => ({
            total: a.total + r.total,
            done: a.done + r.done + r.submitted,
            overdue: a.overdue + r.overdue,
          }),
          { total: 0, done: 0, overdue: 0 },
        );
        expect([
          who,
          q,
          res.body.summary.tasks,
          res.body.summary.overdue,
          res.body.summary.people,
        ]).toEqual([who, q, sum.total, sum.overdue, rows.length]);
        const pct = sum.total ? Math.round((sum.done / sum.total) * 100) : 0;
        expect(res.body.summary.percent).toBe(pct);
      }
    }
  }, 60_000);
});

describe('what people can see', () => {
  it('lists only visible options, and applies visibility before filters', async () => {
    const meera = await (await as('u5')).get('/reports/tasks?range=this_week').expect(200);
    expect((meera.body.options.schools as Body[]).map((s) => s.label)).toEqual(['Jubilee Hills']);
    const names = (meera.body.rows as Body[]).map((r) => (r.person as Body).fullName);
    expect(names).not.toContain('Imran Sheikh');
    // A filter for something out of reach is dropped with a notice (addition b).
    const other = await (
      await as('u5')
    )
      .get(`/reports/tasks?range=this_week&schoolId=${t.demo.schools.kp ?? ''}`)
      .expect(200);
    expect(other.body.dropped).toEqual(['school']);
    expect(other.body.rows.length).toBe(meera.body.rows.length);
  });

  it('follows the organisation’s time zone for "today"', async () => {
    // 23:30 in Kolkata on Monday is 18:00 UTC: still Monday there.
    t.clock.now = at('23:30');
    try {
      // A fresh session: the cached one is older than an access token lives.
      const owner = asSession(t, await signIn(t, mobileOf('u1'), t.demo.organisationId));
      const res = await owner.get('/reports/tasks?range=today').expect(200);
      expect(res.body).toMatchObject({ from: MONDAY, to: MONDAY });
      const week = await owner.get('/reports/tasks?range=this_week').expect(200);
      expect(week.body).toMatchObject({ from: MONDAY, to: '2026-10-11' });
    } finally {
      t.clock.now = at('10:00');
    }
  });

  it('opens one person’s tasks from a row', async () => {
    const res = await (
      await as('u5')
    )
      .get(`/reports/tasks/people/${u('u8')}?range=this_week`)
      .expect(200);
    expect((res.body.items as Body[]).length).toBeGreaterThan(0);
    // Someone out of reach is not found, not an empty list.
    await (await as('u5')).get(`/reports/tasks/people/${u('u11')}?range=this_week`).expect(404);
  });

  it('never shows a task title the role hides in one person’s tasks', async () => {
    const url = `/reports/tasks/people/${u('u8')}?range=this_week`;
    const before = await (await as('u5')).get(url).expect(200);
    const titles = (before.body.items as Body[]).map((i) => String(i.title));
    expect(titles.length).toBeGreaterThan(0);
    await t.prisma.roleFieldPermission.create({
      data: {
        organisationId: t.demo.organisationId,
        roleId: t.demo.roles.principal ?? '',
        moduleKey: 'tasks',
        fieldKey: 'title',
        access: 'hidden',
      },
    });
    try {
      const res = await (await as('u5')).get(url).expect(200);
      expect((res.body.items as Body[]).length).toBe(titles.length);
      const text = JSON.stringify(res.body);
      for (const title of titles) expect(text).not.toContain(title);
      // Principals can't download, so the CSV isn't a way round it.
      await (await as('u5')).get('/reports/tasks.csv?range=this_week').expect(403);
    } finally {
      await t.prisma.roleFieldPermission.deleteMany({
        where: { roleId: t.demo.roles.principal ?? '', moduleKey: 'tasks', fieldKey: 'title' },
      });
    }
  });
});

describe('saved views (per person)', () => {
  it('saves, lists and deletes only your own; a view pointing at something hidden opens with it dropped', async () => {
    const vikram = await as('u2');
    const saved = await vikram
      .post('/saved-views', {
        name: 'Overdue this week',
        filters: { range: 'this_week', status: 'overdue' },
      })
      .expect(201);
    await vikram
      .post('/saved-views', { name: 'overdue this week', filters: { range: 'today' } })
      .expect(409);
    expect(
      (await vikram.get('/saved-views').expect(200)).body.items.map((v: Body) => v.name),
    ).toEqual(['Overdue this week']);
    expect((await (await as('u3')).get('/saved-views').expect(200)).body.items).toEqual([]);
    await (await as('u3')).delete(`/saved-views/${saved.body.id as string}`).expect(404);

    // A view with a category that has since been archived.
    const cat = t.tasks.categories.Events ?? '';
    const view = await vikram
      .post('/saved-views', { name: 'Events', filters: { range: 'this_week', categoryId: cat } })
      .expect(201);
    await t.prisma.taskCategory.update({ where: { id: cat }, data: { archivedAt: new Date() } });
    await t.prisma.task.updateMany({ where: { categoryId: cat }, data: { categoryId: null } });
    const res = await vikram.get(`/reports/tasks?range=this_week&categoryId=${cat}`).expect(200);
    expect(res.body.dropped).toEqual(['category']);
    await vikram.delete(`/saved-views/${view.body.id as string}`).expect(204);
  });
});

describe('CSV download', () => {
  it('needs Download, follows field permissions, defuses formulas, and is audited', async () => {
    await (await as('u5')).get('/reports/tasks.csv?range=this_week').expect(403);
    // A name a spreadsheet would run as a formula.
    await t.prisma.user.update({
      where: { id: u('u13') },
      data: { fullName: '=HYPERLINK("http://x","Lakshmi")' },
    });
    const res = await (await as('u2')).get('/reports/tasks.csv?range=this_week').expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const text = res.text.replace(/^\uFEFF/, '');
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Name,Role,School,Tasks,Done,Waiting for approval,Overdue,% done or submitted,Day-end today',
    );
    expect(text).toContain(`"'=HYPERLINK(""http://x"",""Lakshmi"")"`);
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
    const audit = await t.prisma.auditLog.findFirstOrThrow({
      where: { action: 'report.exported', entityId: u('u2') },
    });
    expect((audit.after as Body).rows).toBe(lines.length - 1);
  });

  it('leaves out columns the role hides', async () => {
    await t.prisma.roleFieldPermission.create({
      data: {
        organisationId: t.demo.organisationId,
        roleId: t.demo.roles.dept_head ?? '',
        moduleKey: 'users',
        fieldKey: 'school',
        access: 'hidden',
      },
    });
    const res = await (await as('u2')).get('/reports/tasks.csv?range=this_week').expect(200);
    expect(res.text.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe(
      'Name,Role,Tasks,Done,Waiting for approval,Overdue,% done or submitted,Day-end today',
    );
  });

  it('is rate-limited per person (addition c)', async () => {
    const vikram = await as('u2');
    // The limit here is 3 an hour.
    for (let i = 0; i < 3; i++) await vikram.get('/reports/tasks.csv?range=today').expect(200);
    await vikram.get('/reports/tasks.csv?range=today').expect(429);
  });

  it('makes every risky cell safe', () => {
    expect(safeCell('=1+1')).toBe("'=1+1");
    expect(safeCell('+44')).toBe("'+44");
    expect(safeCell('-2')).toBe("'-2");
    expect(safeCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(safeCell('\tx')).toBe("'\tx");
    expect(safeCell('Plain, with comma')).toBe('"Plain, with comma"');
  });
});
