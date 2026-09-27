import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAccess, zonedInstant } from '@kidzonia/shared';
import { loadPermissions } from '../../src/core/permission-context.js';
import { taskFacts, visibleTaskWhere } from '../../src/apps/tasks/facts.js';
import { createTestApp, people } from '../support/app.js';
import type { TestApp } from '../support/app.js';

/** Home, feed, search and the school switcher (Phase 5 a, b, e, f). */

const MONDAY = '2026-10-05';
const at = (time: string) => zonedInstant(MONDAY, time, 'Asia/Kolkata');

let t: TestApp;
const as = people(() => t);
const u = (k: string) => t.demo.users[k] ?? '';

beforeAll(async () => {
  t = await createTestApp({}, { now: at('10:00') });
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.prisma.rateLimit.deleteMany();
});

type Body = Record<string, unknown>;

describe('each persona’s Home (brief 7.3, rules in docs/home-snapshot.md)', () => {
  it('Owner: schools table, lowest first, with attention cards', async () => {
    const res = await (await as('u1')).get('/home').expect(200);
    expect(res.body.sections).toEqual(['schools']);
    expect((res.body.schools as Body[]).map((s) => s.name)).toHaveLength(4);
    expect(res.body.greeting).toMatchObject({
      firstName: 'Ananya',
      summary: 'Here’s what’s happening across your 4 schools.',
    });
    const cards = (res.body.attention as Body[]).map((c) => c.key);
    expect(cards).toContain('waiting_for_role'); // Rahul
  });

  it('Department head: tasks they set, by school', async () => {
    const res = await (await as('u2')).get('/home').expect(200);
    expect(res.body.sections).toEqual(['set_tasks']);
    const t1 = (res.body.setTasks as Body[]).find(
      (x) => x.title === 'Mark class attendance',
    ) as Body;
    expect((t1.bySchool as Body[]).length).toBe(4);
    expect(res.body.greeting.summary).toBe('Academics work across your schools.');
  });

  it('Franchise owner: schools and team', async () => {
    const res = await (await as('u4')).get('/home').expect(200);
    expect(res.body.sections).toEqual(['schools', 'team']);
    expect((res.body.schools as Body[]).map((s) => s.name).sort()).toEqual(['Kokapet', 'Kondapur']);
  });

  it('Principal: team today, with approvals waiting', async () => {
    const res = await (await as('u5')).get('/home').expect(200);
    expect(res.body.sections).toEqual(['team']);
    const names = (res.body.team as Body[]).map((r) => (r.person as Body).fullName);
    expect(names).toEqual(expect.arrayContaining(['Priya Sharma', 'Rohan Gupta', 'Sneha Pillai']));
    const approvals = (res.body.attention as Body[]).find((c) => c.key === 'approvals');
    expect(approvals?.count).toBe(1);
  });

  it('Teacher: today, with a progress bar and what’s left', async () => {
    const res = await (await as('u8')).get('/home').expect(200);
    expect(res.body.sections).toEqual(['today']);
    expect(res.body.today.items.length).toBeGreaterThan(0);
    expect(res.body.greeting.summary).toMatch(/left today|done for today/);
  });
});

describe('the demo’s updates and notifications (seeded)', () => {
  const texts = (items: unknown) => (items as Body[]).map((i) => String(i.text));

  it('Meera sees her school’s updates and her approvals in the bell', async () => {
    const res = await (await as('u5')).get('/home').expect(200);
    expect(texts(res.body.feed)).toEqual(
      expect.arrayContaining([
        'Rohan Gupta submitted “Classroom safety check”',
        'You approved work on “Classroom safety check”',
        'You assigned “Plan Annual Day rehearsal for Nursery A” to 1 person',
      ]),
    );
    // Other schools' work isn't in her feed.
    expect(texts(res.body.feed).join(' | ')).not.toContain('Imran Sheikh');
    expect(texts(res.body.notifications)).toContain(
      'Rohan Gupta submitted “Classroom safety check”',
    );
  });

  it('groups the Owner’s and Vikram’s approvals, and tells the Owner about Rahul', async () => {
    const owner = await (await as('u1')).get('/notifications').expect(200);
    expect(texts(owner.body.items)).toEqual(
      expect.arrayContaining([
        '2 people submitted “Share weekly school update”',
        'Rahul Verma joined and is waiting for a role',
      ]),
    );
    const vikram = await (await as('u2')).get('/notifications').expect(200);
    expect(texts(vikram.body.items)).toContain('3 people submitted “Submit weekly lesson plan”');
  });

  it('Priya sees what was given to her, and nothing about other people', async () => {
    const res = await (await as('u8')).get('/home').expect(200);
    expect(texts(res.body.notifications)).toEqual(
      expect.arrayContaining(['Meera Iyer gave you “Plan Annual Day rehearsal for Nursery A”']),
    );
    expect(texts(res.body.feed)).toContain(
      'Meera Iyer assigned “Plan Annual Day rehearsal for Nursery A” to you',
    );
    expect(texts(res.body.feed).join(' | ')).not.toContain('Kitchen hygiene audit');
  });
});

describe('visibility in the query agrees with can() (Phase 5 a)', () => {
  it('for every seeded task and every seeded person', async () => {
    const org = t.demo.organisationId;
    const db = t.deps.data.forOrganisation(org);
    const tasks = await db.task.findMany({
      select: {
        id: true,
        createdBy: true,
        approverUserId: true,
        needsApproval: true,
        approverMode: true,
        creator: { select: { homeSchoolId: true } },
        watchers: { select: { userId: true, access: true } },
        subtasks: { where: { removedAt: null }, select: { assigneeUserId: true } },
        assignments: { select: { userId: true, schoolId: true, approverUserId: true } },
      },
    });
    for (const [key, id] of Object.entries(t.demo.users)) {
      const loaded = await loadPermissions(t.deps.data, db, { id, organisationId: org });
      const access = createAccess(loaded.ctx);
      const inQuery = new Set(
        (
          await db.task.findMany({
            where: visibleTaskWhere(access.scopes('tasks'), id),
            select: { id: true },
          })
        ).map((x) => x.id),
      );
      for (const task of tasks) {
        const facts = taskFacts({
          createdBy: task.createdBy,
          creatorSchoolId: task.creator.homeSchoolId,
          approverUserId:
            task.needsApproval && task.approverMode === 'named_user' ? task.approverUserId : null,
          watchers: task.watchers,
          subtaskAssigneeIds: task.subtasks
            .map((s) => s.assigneeUserId)
            .filter((x): x is string => x !== null),
          copies: task.assignments,
        });
        expect([key, task.id, inQuery.has(task.id)]).toEqual([
          key,
          task.id,
          access.can('tasks', 'view', facts),
        ]);
      }
    }
  });
});

describe('nothing leaks through the feed, notifications or search (Phase 5 b)', () => {
  it('shows a feed item only while the task is visible', async () => {
    // Kavita gives Imran (Kondapur) a task. Suresh sees it through his Kondapur scope.
    const created = await (
      await as('u6')
    )
      .post('/tasks', { title: 'Kondapur fire drill', target: { userIds: [u('u11')] } })
      .expect(201);
    const feedOf = async (key: string) =>
      ((await (await as(key)).get('/home').expect(200)).body.feed as Body[]).map((f) => f.text);
    expect((await feedOf('u4')).some((x) => String(x).includes('Kondapur fire drill'))).toBe(true);
    expect((await feedOf('u5')).some((x) => String(x).includes('Kondapur fire drill'))).toBe(false);
    // Suresh no longer looks after Kondapur (and, with the "sees their team"
    // automatic roles off, Kavita and Imran reporting to him no longer count):
    // the item goes.
    const assignment = await t.prisma.roleAssignment.findFirstOrThrow({
      where: { userId: u('u4') },
    });
    await t.prisma.roleAssignmentSchool.deleteMany({
      where: { assignmentId: assignment.id, schoolId: t.demo.schools.kp ?? '' },
    });
    // All three team switches grant "view" (seeing, approving, releasing the team).
    await t.prisma.automaticRoleSetting.createMany({
      data: [
        'manager_sees_team_tasks',
        'manager_approves_team_work',
        'manager_releases_team_logout',
      ].map((switchKey) => ({ organisationId: t.demo.organisationId, switchKey, enabled: false })),
    });
    try {
      expect((await feedOf('u4')).some((x) => String(x).includes('Kondapur fire drill'))).toBe(
        false,
      );
    } finally {
      await t.prisma.automaticRoleSetting.deleteMany({
        where: { organisationId: t.demo.organisationId },
      });
      await t.prisma.roleAssignmentSchool.create({
        data: {
          organisationId: t.demo.organisationId,
          assignmentId: assignment.id,
          schoolId: t.demo.schools.kp ?? '',
        },
      });
    }
    expect(created.status).toBe(201);
  });

  it('never shows a hidden title in feed text, notification text or search', async () => {
    const res = await (
      await as('u5')
    )
      .post('/tasks', {
        title: 'Secret audit prep',
        target: { userIds: [u('u8')] },
        needsApproval: true,
      })
      .expect(201);
    const copy = await t.prisma.taskAssignment.findFirstOrThrow({
      where: { taskId: res.body.id as string },
    });
    await (await as('u8')).post(`/assignments/${copy.id}/submit`).expect(200);
    const { NotificationWorker } = await import('../../src/core/notifications/worker.js');
    await new NotificationWorker(t.deps).run(t.clock.now);
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
      const meera = await as('u5');
      const home = await meera.get('/home').expect(200);
      expect(JSON.stringify(home.body)).not.toContain('Secret audit prep');
      const bell = await meera.get('/notifications').expect(200);
      expect(JSON.stringify(bell.body)).not.toContain('Secret audit prep');
      expect((bell.body.items as Body[]).some((i) => String(i.text).includes('a task'))).toBe(true);
      const search = await meera.get('/search?q=Secret').expect(200);
      expect(search.body.tasks).toEqual([]);
    } finally {
      await t.prisma.roleFieldPermission.deleteMany({
        where: { roleId: t.demo.roles.principal ?? '', moduleKey: 'tasks' },
      });
    }
  });
});

describe('search (brief 7.5)', () => {
  it('finds pages, tasks and people the person can see, nothing else', async () => {
    const meera = await as('u5');
    const res = await meera.get('/search?q=safety').expect(200);
    expect((res.body.tasks as Body[]).map((x) => x.title)).toContain('Classroom safety check');
    const people = await meera.get('/search?q=Priya').expect(200);
    expect((people.body.people as Body[]).map((p) => p.fullName)).toEqual(['Priya Sharma']);
    const outside = await meera.get('/search?q=Imran').expect(200);
    expect(outside.body.people).toEqual([]);
    const pages = await meera.get('/search?q=approv').expect(200);
    expect(pages.body.pages).toEqual([{ label: 'Approvals', path: '/tasks/approvals' }]);
    const imran = await (await as('u11')).get('/search?q=safety').expect(200);
    expect(imran.body.tasks).toEqual([]);
    await meera.get('/search?q=a').expect(400);
  });
});

describe('school switcher (brief 7.6, answer 5)', () => {
  it('narrows lists on the server, only to schools in scope, never the bell or approvals', async () => {
    const ananya = await as('u1');
    await ananya.put('/me/school', { schoolId: t.demo.schools.gb }).expect(204);
    try {
      const me = await ananya.get('/me').expect(200);
      expect(me.body.selectedSchool.name).toBe('Gachibowli');
      const home = await ananya.get('/home').expect(200);
      expect(home.body.sections).not.toContain('schools');
      const users = await ananya.get('/users?limit=200').expect(200);
      const schools = new Set((users.body.items as Body[]).map((x) => x.homeSchoolName));
      expect([...schools].every((s) => s === 'Gachibowli' || s === null)).toBe(true);
      // Approvals and the bell are never narrowed.
      const approvals = await ananya.get('/assignments?tab=approvals').expect(200);
      const who = (approvals.body.items as Body[]).map((i) => (i.person as Body).fullName);
      expect(who).toEqual(expect.arrayContaining(['Meera Iyer', 'Arjun Das']));
    } finally {
      await ananya.put('/me/school', { schoolId: null }).expect(204);
    }
    // Only schools in scope; one school means no switcher at all.
    const suresh = await as('u4');
    await suresh.put('/me/school', { schoolId: t.demo.schools.gb }).expect(422);
    const meera = await (await as('u5')).get('/me').expect(200);
    expect(meera.body.switchableSchools).toEqual([]);
  });
});
