import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, listFieldKey } from '@kidzonia/shared';
import { createTestApp, people } from '../support/app.js';
import type { TestApp } from '../support/app.js';
import { atLocal, todayIn } from '../support/tasks.js';

let t: TestApp;
const as = people(() => t);
const u = (k: string) => t.demo.users[k] ?? '';
const role = (k: string) => t.demo.roles[k] ?? '';
const school = (k: string) => t.demo.schools[k] ?? '';

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
const tomorrow = () => addDays(todayIn(t), 1);

async function create(by: string, body: Body, expected = 201) {
  return (await as(by)).post('/tasks', { title: 'Test task', ...body }).expect(expected);
}
const copiesOf = (taskId: string) =>
  t.prisma.taskAssignment.findMany({ where: { taskId }, orderBy: { userId: 'asc' } });

describe('reading the seeded demo', () => {
  it('shows the demo’s task setup to anyone who uses Tasks', async () => {
    const res = await (await as('u8')).get('/task-setup').expect(200);
    expect(res.body.categories.map((c: Body) => c.name)).toEqual([
      'Academics',
      'Safety',
      'Operations',
      'Events',
      'Admin',
    ]);
    expect(res.body.priorities.map((p: Body) => p.name)).toEqual([
      'Urgent',
      'High',
      'Medium',
      'Low',
    ]);
    expect(res.body.lists[0].name).toBe('Area');
  });

  it('lists a teacher’s copies on My tasks', async () => {
    const res = await (await as('u8')).get('/assignments?tab=my&limit=200').expect(200);
    const titles = res.body.items.map((i: Body) => i.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        'Mark class attendance',
        'Submit weekly lesson plan',
        'Classroom safety check',
        'Plan Annual Day rehearsal for Nursery A',
      ]),
    );
    // Teachers can't see watchers (their role hides them).
    const detail = await (await as('u8')).get(`/tasks/${t.tasks.tasks.t2 ?? ''}`).expect(200);
    expect(detail.body).not.toHaveProperty('watchers');
    expect(detail.body.myCopy.subtasks).toHaveLength(2);
  });

  it('shows "x of n done" to the creator', async () => {
    const res = await (await as('u2')).get('/tasks?view=byme').expect(200);
    const t1 = res.body.items.find((i: Body) => i.title === 'Mark class attendance');
    expect(t1.progress).toEqual({ total: 9, done: 7, submitted: 0, overdue: 2 });
  });

  it('shows a principal only their own team’s copies of a head-office task', async () => {
    const res = await (await as('u5')).get(`/tasks/${t.tasks.tasks.t1 ?? ''}`).expect(200);
    const names = res.body.people.map((p: Body) => (p.person as Body).fullName).sort();
    expect(names).toEqual(['Priya Sharma', 'Rohan Gupta', 'Sneha Pillai']);
    expect(res.body.progress.total).toBe(3);
  });

  it('lists work waiting for a decision under Approvals', async () => {
    const res = await (await as('u5')).get('/assignments?tab=approvals').expect(200);
    const rows = res.body.items.map(
      (i: Body) => `${String(i.title)}:${String((i.person as Body).fullName)}`,
    );
    expect(rows).toEqual(['Classroom safety check:Rohan Gupta']);
  });
});

describe('targeting (brief 9.3)', () => {
  it('gives a group to everyone it matches, skipping people without a role', async () => {
    const res = await create('u2', { target: { roleIds: [role('teacher')] } });
    const copies = await copiesOf(res.body.id as string);
    expect(res.body.assigned).toBe(9);
    expect(copies.map((c) => c.userId)).not.toContain(u('u14')); // Rahul has no role
    expect(copies.map((c) => c.userId)).toContain(u('u11')); // a franchise teacher
  });

  it('quietly skips group members out of reach', async () => {
    const res = await create('u5', { target: { roleIds: [role('teacher')] } });
    const copies = await copiesOf(res.body.id as string);
    expect(copies.map((c) => c.userId).sort()).toEqual([u('u8'), u('u9'), u('u10')].sort());
  });

  it('refuses a named person out of reach, naming them', async () => {
    const res = await create('u5', { target: { userIds: [u('u8'), u('u11')] } }, 422);
    expect(res.body.error.message).toContain(
      'Imran Sheikh is outside the people you can give tasks to',
    );
    expect(
      await t.prisma.task.count({
        where: {
          title: 'Test task',
          createdBy: u('u5'),
          target: { equals: { userIds: [u('u8'), u('u11')] } },
        },
      }),
    ).toBe(0);
  });

  it('refuses inactive people and people without a role when named', async () => {
    const r1 = await create('u5', { target: { userIds: [u('u14')] } }, 422);
    expect(r1.body.error.message).toContain('Rahul Verma doesn’t have a role yet');
    await t.prisma.user.update({ where: { id: u('u10') }, data: { status: 'inactive' } });
    try {
      const r2 = await create('u5', { target: { userIds: [u('u10')] } }, 422);
      expect(r2.body.error.message).toContain('Sneha Pillai is inactive');
      const group = await create('u5', { target: { roleIds: [role('teacher')] } });
      expect(group.body.assigned).toBe(2);
    } finally {
      await t.prisma.user.update({ where: { id: u('u10') }, data: { status: 'active' } });
    }
  });

  it('lets someone without Assign give tasks only to themselves', async () => {
    await t.prisma.rolePermission.updateMany({
      where: { roleId: role('principal'), moduleKey: 'tasks' },
      data: { actions: ['view', 'create', 'edit', 'approve'] },
    });
    try {
      await create('u5', { target: { userIds: [u('u5')] } });
      await create('u5', { target: { userIds: [u('u8')] } }, 422);
    } finally {
      await t.prisma.rolePermission.updateMany({
        where: { roleId: role('principal'), moduleKey: 'tasks' },
        data: { actions: ['view', 'create', 'edit', 'assign', 'approve'] },
      });
    }
  });

  it('previews a group and applies exclusions', async () => {
    const res = await (
      await as('u2')
    )
      .post('/tasks/target-preview', {
        target: {
          roleIds: [role('teacher')],
          schoolIds: [school('jh')],
          excludeUserIds: [u('u9')],
        },
      })
      .expect(200);
    expect(res.body.count).toBe(2);
    expect(res.body.limit).toBe(1000);
  });

  it('refuses nobody, and refuses teachers creating tasks', async () => {
    await create('u2', {
      target: { roleIds: [role('teacher')], excludeUserIds: [], schoolIds: [school('kp')] },
      title: 'KP only',
    });
    const none = await create('u5', { target: { roleIds: [role('franchise_owner')] } }, 422);
    expect(none.body.error.message).toContain('No one');
    await create('u8', { target: { userIds: [u('u8')] } }, 403);
  });

  it('validates input with plain messages', async () => {
    const res = await create('u2', { title: '', target: { userIds: [u('u8')] } }, 400);
    expect(res.body.error.fields.title).toBe('Give the task a title');
    await create('u2', { target: {} }, 400);
    await create('u2', { dueType: 'at_time', target: { userIds: [u('u8')] } }, 400);
  });

  it('refuses a time that has already passed today, and a past date', async () => {
    const r = await create(
      'u2',
      { dueType: 'at_time', dueTime: '06:00', target: { userIds: [u('u8')] } },
      400,
    );
    expect(r.body.error.message).toBe('That time has already passed today.');
    await create(
      'u2',
      { dueType: 'on_date', dueDate: addDays(todayIn(t), -1), target: { userIds: [u('u8')] } },
      400,
    );
  });
});

describe('sub-task people (addition a)', () => {
  it('refuses a sub-task person on a task for a group or several people', async () => {
    await create(
      'u5',
      {
        target: { roleIds: [role('teacher')] },
        subtasks: [{ title: 'x', assigneeUserId: u('u9') }],
      },
      400,
    );
    await create(
      'u5',
      {
        target: { userIds: [u('u8'), u('u10')] },
        subtasks: [{ title: 'x', assigneeUserId: u('u9') }],
      },
      400,
    );
  });

  it('refuses a sub-task person out of the creator’s reach', async () => {
    const res = await create(
      'u5',
      { target: { userIds: [u('u8')] }, subtasks: [{ title: 'x', assigneeUserId: u('u11') }] },
      422,
    );
    expect(res.body.error.message).toContain('someone you can give tasks to');
  });

  it('lets the sub-task person see that copy and tick only their sub-task', async () => {
    const res = await create('u5', {
      target: { userIds: [u('u8')] },
      subtasks: [{ title: 'Priya’s part' }, { title: 'Rohan’s part', assigneeUserId: u('u9') }],
      needsApproval: true,
    });
    const [copy] = await copiesOf(res.body.id as string);
    const detail = await (await as('u9')).get(`/assignments/${copy?.id ?? ''}`).expect(200);
    const [mine, theirs] = [detail.body.subtasks[1], detail.body.subtasks[0]];
    expect(mine.canTick).toBe(true);
    expect(theirs.canTick).toBe(false);
    await (
      await as('u9')
    )
      .put(`/assignments/${copy?.id ?? ''}/subtasks/${theirs.id as string}`, { done: true })
      .expect(403);
    await (
      await as('u9')
    )
      .put(`/assignments/${copy?.id ?? ''}/subtasks/${mine.id as string}`, { done: true })
      .expect(200);
    await (await as('u9')).post(`/assignments/${copy?.id ?? ''}/submit`).expect(403);
    // Only that copy: Priya's other work stays out of reach.
    const other = await t.prisma.taskAssignment.findFirstOrThrow({
      where: { taskId: t.tasks.tasks.t3 ?? '', userId: u('u8') },
    });
    await (await as('u9')).get(`/assignments/${other.id}`).expect(404);
  });
});

describe('who can see a task (addition b)', () => {
  let taskId = '';

  beforeAll(async () => {
    // Kavita (principal, Kondapur) gives Imran a task watched by Meera (principal,
    // Jubilee Hills) and approved by Vikram's colleague Farah... named: Meera.
    const res = await create('u6', {
      title: 'Kondapur check',
      target: { userIds: [u('u11')] },
      needsApproval: true,
      approverMode: 'named_user',
      approverUserId: u('u7'),
      watchers: [{ userId: u('u5'), access: 'view' }],
    });
    taskId = res.body.id as string;
  });

  it('lets a watcher outside the usual reach see that task, and nothing else', async () => {
    const meera = await as('u5');
    const watching = await meera.get('/tasks?view=watching').expect(200);
    expect(watching.body.items.map((i: Body) => i.title)).toContain('Kondapur check');
    const detail = await meera.get(`/tasks/${taskId}`).expect(200);
    expect(detail.body.people.map((p: Body) => (p.person as Body).fullName)).toEqual([
      'Imran Sheikh',
    ]);
    // Not Imran himself, nor his other work.
    await meera.get(`/users/${u('u11')}`).expect(404);
    const other = await t.prisma.taskAssignment.findFirstOrThrow({
      where: { taskId: t.tasks.tasks.t7 ?? '', userId: u('u11') },
    });
    await meera.get(`/assignments/${other.id}`).expect(404);
    await meera.get(`/tasks/${t.tasks.tasks.t7 ?? ''}`).expect(404);
    const team = await meera.get('/tasks?view=team&limit=200').expect(200);
    expect(team.body.items.map((i: Body) => i.title)).not.toContain('Kondapur check');
    // A view watcher can't change it.
    await meera.put(`/tasks/${taskId}`, { title: 'Changed' }).expect(403);
  });

  it('lets a named approver outside the usual reach decide that copy only', async () => {
    const [copy] = await copiesOf(taskId);
    await (await as('u11')).post(`/assignments/${copy?.id ?? ''}/submit`).expect(200);
    const arjun = await as('u7');
    const approvals = await arjun.get('/assignments?tab=approvals').expect(200);
    expect(approvals.body.items.map((i: Body) => i.title)).toContain('Kondapur check');
    await arjun.post(`/assignments/${copy?.id ?? ''}/approve`, { remarks: 'Good' }).expect(200);
    await arjun.get(`/users/${u('u11')}`).expect(404);
    const other = await t.prisma.taskAssignment.findFirstOrThrow({
      where: { taskId: t.tasks.tasks.t7 ?? '', userId: u('u11') },
    });
    await arjun.get(`/assignments/${other.id}`).expect(404);
  });

  it('lets an edit watcher change the task but not who it’s for', async () => {
    // Arjun (principal, Gachibowli) has no reach over Kavita or Imran: only the watcher edit right.
    const res = await create('u6', {
      title: 'Shared prep',
      target: { userIds: [u('u11')] },
      watchers: [{ userId: u('u7'), access: 'edit' }],
    });
    const id = res.body.id as string;
    const arjun = await as('u7');
    await arjun.put(`/tasks/${id}`, { description: 'Updated by Arjun' }).expect(200);
    await arjun.put(`/tasks/${id}`, { target: { userIds: [u('u12')] } }).expect(403);
    await arjun.put(`/tasks/${id}`, { watchers: [] }).expect(403);
    await arjun.delete(`/tasks/${id}`).expect(403);
    await arjun.get(`/users/${u('u11')}`).expect(404);
  });

  it('never lets a principal rewrite a head-office task that reached their teachers', async () => {
    await (
      await as('u5')
    )
      .put(`/tasks/${t.tasks.tasks.t1 ?? ''}`, { title: 'Hijacked' })
      .expect(403);
  });

  it('answers 404 for tasks out of reach', async () => {
    await (await as('u8')).get(`/tasks/${t.tasks.tasks.t5 ?? ''}`).expect(404);
    await (await as('u13')).get(`/tasks/${t.tasks.tasks.t3 ?? ''}`).expect(404);
  });
});

describe('editing a task (brief 9.5, decision 1)', () => {
  it('updates only untouched copies and says what happened', async () => {
    const res = await create('u5', {
      title: 'Wall display',
      dueType: 'on_date',
      dueDate: tomorrow(),
      target: { userIds: [u('u8'), u('u9')] },
      subtasks: [{ title: 'Put up artwork' }],
    });
    const id = res.body.id as string;
    const copies = await copiesOf(id);
    const priya = copies.find((c) => c.userId === u('u8'));
    const sub = (priya?.snapshot as { subtasks: { id: string }[] }).subtasks[0]?.id ?? '';
    await (
      await as('u8')
    )
      .put(`/assignments/${priya?.id ?? ''}/subtasks/${sub}`, { done: true })
      .expect(200);

    const edit = await (
      await as('u5')
    )
      .put(`/tasks/${id}`, { title: 'Wall display (Term 2)' })
      .expect(200);
    expect(edit.body).toMatchObject({
      updatedCopies: 1,
      keptCopies: 1,
      addedCopies: 0,
      removedCopies: 0,
    });
    const after = await copiesOf(id);
    const titleOf = (userKey: string) =>
      (after.find((c) => c.userId === u(userKey))?.snapshot as { title: string }).title;
    expect(titleOf('u8')).toBe('Wall display');
    expect(titleOf('u9')).toBe('Wall display (Term 2)');
  });

  it('includes today’s untouched copies while the deadline is ahead, and not after', async () => {
    const res = await create('u5', { title: 'Today job', target: { userIds: [u('u10')] } });
    const id = res.body.id as string;
    const first = await (await as('u5')).put(`/tasks/${id}`, { title: 'Today job v2' }).expect(200);
    expect(first.body.updatedCopies).toBe(1);
    const saved = t.clock.now;
    atLocal(t, '17:00');
    try {
      const second = await (
        await as('u5')
      )
        .put(`/tasks/${id}`, { title: 'Today job v3' })
        .expect(200);
      expect(second.body).toMatchObject({ updatedCopies: 0, keptCopies: 1 });
    } finally {
      t.clock.now = saved;
    }
  });

  it('adds and removes people, leaving started work alone', async () => {
    const res = await create('u5', {
      title: 'Roster',
      dueType: 'on_date',
      dueDate: tomorrow(),
      target: { userIds: [u('u8'), u('u9')] },
    });
    const id = res.body.id as string;
    const edit = await (
      await as('u5')
    )
      .put(`/tasks/${id}`, { target: { userIds: [u('u8'), u('u10')] } })
      .expect(200);
    expect(edit.body).toMatchObject({ addedCopies: 1, removedCopies: 1 });
    expect((await copiesOf(id)).map((c) => c.userId).sort()).toEqual([u('u8'), u('u10')].sort());
  });

  it('validates the merged record, not the fragment', async () => {
    const res = await create('u5', { title: 'Merge', target: { userIds: [u('u8')] } });
    await (
      await as('u5')
    )
      .put(`/tasks/${res.body.id as string}`, { dueType: 'at_time' })
      .expect(400);
  });

  it('cancels a whole task and every copy still owed', async () => {
    const res = await create('u5', { title: 'Cancel me', target: { userIds: [u('u8'), u('u9')] } });
    const id = res.body.id as string;
    // Rohan can see the task (it's his), but can't cancel it.
    await (await as('u9')).delete(`/tasks/${id}`).expect(403);
    await (await as('u5')).delete(`/tasks/${id}`).expect(204);
    expect((await copiesOf(id)).map((c) => c.status)).toEqual(['cancelled', 'cancelled']);
    await (await as('u5')).put(`/tasks/${id}`, { title: 'x' }).expect(409);
  });
});

describe('field permissions on tasks (addition f)', () => {
  it('hides a field from lists, the drawer and filters', async () => {
    await t.prisma.roleFieldPermission.create({
      data: {
        organisationId: t.demo.organisationId,
        roleId: role('dept_head'),
        moduleKey: 'tasks',
        fieldKey: 'priority',
        access: 'hidden',
      },
    });
    try {
      const vikram = await as('u2');
      const list = await vikram.get('/tasks?view=byme').expect(200);
      expect(list.body.items[0]).not.toHaveProperty('priority');
      expect(list.body.items[0]).not.toHaveProperty('priorityId');
      const detail = await vikram.get(`/tasks/${t.tasks.tasks.t2 ?? ''}`).expect(200);
      expect(detail.body).not.toHaveProperty('priority');
      await vikram.get(`/tasks?view=byme&priorityId=${t.tasks.priorities.High ?? ''}`).expect(400);
      await vikram.get('/tasks?view=byme&sort=priority').expect(400);
      // Other people's view is unchanged.
      const meera = await (await as('u5')).get(`/tasks/${t.tasks.tasks.t3 ?? ''}`).expect(200);
      expect(meera.body.priority.name).toBe('Urgent');
    } finally {
      await t.prisma.roleFieldPermission.deleteMany({
        where: { roleId: role('dept_head'), moduleKey: 'tasks' },
      });
    }
  });

  it('never matches search on a hidden title', async () => {
    await t.prisma.roleFieldPermission.create({
      data: {
        organisationId: t.demo.organisationId,
        roleId: role('dept_head'),
        moduleKey: 'tasks',
        fieldKey: 'title',
        access: 'hidden',
      },
    });
    try {
      // "Mark class" is only in the title (t1's description says "Mark attendance…").
      const res = await (await as('u2')).get('/tasks?view=byme&q=Mark%20class').expect(200);
      expect(res.body.items).toEqual([]);
    } finally {
      await t.prisma.roleFieldPermission.deleteMany({
        where: { roleId: role('dept_head'), moduleKey: 'tasks' },
      });
    }
  });

  it('treats each custom list as a field of its own', async () => {
    const key = listFieldKey(t.tasks.areaListId);
    const reg = await (await as('u1')).get('/registry').expect(200);
    const fields = reg.body.modules.find((m: Body) => m.key === 'tasks').fields as Body[];
    expect(fields.find((f) => f.key === key)?.label).toBe('Area');
    const me = await (await as('u8')).get('/me').expect(200);
    expect(me.body.customLists).toEqual([{ id: t.tasks.areaListId, name: 'Area' }]);

    const shown = await (await as('u2')).get(`/tasks/${t.tasks.tasks.t1 ?? ''}`).expect(200);
    expect(shown.body[key].value).toBe('Classroom');
    await (
      await as('u1')
    )
      .put(`/roles/${role('dept_head')}/fields`, {
        fields: { tasks: { [key]: { access: 'hidden', ownRecord: 'same', needsApproval: false } } },
      })
      .expect(200);
    try {
      const hidden = await (await as('u2')).get(`/tasks/${t.tasks.tasks.t1 ?? ''}`).expect(200);
      expect(hidden.body).not.toHaveProperty(key);
      await (
        await as('u2')
      )
        .get(`/tasks?view=byme&listValue=${t.tasks.areaListId}:${t.tasks.area.Classroom ?? ''}`)
        .expect(400);
    } finally {
      await (await as('u1')).put(`/roles/${role('dept_head')}/fields`, { fields: {} }).expect(200);
    }
    const filtered = await (
      await as('u2')
    )
      .get(`/tasks?view=byme&listValue=${t.tasks.areaListId}:${t.tasks.area.Classroom ?? ''}`)
      .expect(200);
    expect(filtered.body.items.map((i: Body) => i.title).sort()).toEqual([
      'Mark class attendance',
      'Submit weekly lesson plan',
    ]);
  });

  it('refuses creating a task with a field the role makes view-only', async () => {
    await t.prisma.roleFieldPermission.create({
      data: {
        organisationId: t.demo.organisationId,
        roleId: role('principal'),
        moduleKey: 'tasks',
        fieldKey: 'category',
        access: 'view',
      },
    });
    try {
      await create(
        'u5',
        { categoryId: t.tasks.categories.Safety, target: { userIds: [u('u8')] } },
        403,
      );
      await create('u5', { target: { userIds: [u('u8')] } });
    } finally {
      await t.prisma.roleFieldPermission.deleteMany({
        where: { roleId: role('principal'), moduleKey: 'tasks' },
      });
    }
  });
});
