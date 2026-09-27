import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  CLIENT_HEADER,
  createTestApp,
  mobileOf,
  SECOND_OWNER_MOBILE,
  signIn,
} from '../support/app.js';
import type { Session, TestApp } from '../support/app.js';

/**
 * Tenant isolation, endpoint by endpoint. Every authenticated route must have
 * a case here; the coverage test fails the build when a new route is added
 * without one. Each case signs in as the Owner of the SECOND organisation (who
 * has every permission there) and tries to read or change the DEMO
 * organisation's data. Out-of-organisation records must answer 404, lists
 * must not include them, and writes must not change them.
 */

let t: TestApp;
let outsider: Session; // Nisha, Owner of the second organisation
let insider: Session; // Ananya, Owner of the demo organisation
let demoChangeId: string;
let demoHolidayId: string;
/** A demo copy that is submitted, with a file (Rohan's safety check). */
let demoCopyId: string;
let demoSubtaskId: string;
let demoAttachmentId: string;
let demoTemplateId: string;

const d = (k: string) => t.demo.users[k] ?? '';
const out = () => as(t, outsider);

beforeAll(async () => {
  t = await createTestApp();
  outsider = await signIn(t, SECOND_OWNER_MOBILE);
  insider = await signIn(t, mobileOf('u1'));
  const org = t.demo.organisationId;
  const holiday = await t.prisma.holiday.create({
    data: {
      organisationId: org,
      name: 'Demo holiday',
      startDate: new Date('2026-11-01'),
      endDate: new Date('2026-11-01'),
    },
  });
  demoHolidayId = holiday.id;
  const change = await t.prisma.pendingFieldChange.create({
    data: {
      organisationId: org,
      moduleKey: 'users',
      recordId: d('u8'),
      subjectUserId: d('u8'),
      fieldKey: 'mobile',
      oldValue: { mobile: '+919848044108' },
      newValue: { mobile: '+919666099999' },
      requestedBy: d('u8'),
    },
  });
  demoChangeId = change.id;
  const copy = await t.prisma.taskAssignment.findFirstOrThrow({
    where: { taskId: t.tasks.tasks.t3 ?? '', userId: d('u9') },
    include: { attachments: true },
  });
  demoCopyId = copy.id;
  demoSubtaskId = (copy.snapshot as { subtasks: { id: string }[] }).subtasks[0]?.id ?? '';
  demoAttachmentId = copy.attachments[0]?.id ?? '';
  demoTemplateId = (
    await t.prisma.taskTemplate.findFirstOrThrow({ where: { organisationId: org } })
  ).id;
});

/** Nothing about the demo's tasks changed. */
async function demoTasksUnchanged() {
  const copy = await t.prisma.taskAssignment.findUniqueOrThrow({ where: { id: demoCopyId } });
  expect(copy.status).toBe('submitted');
  const task = await t.prisma.task.findUniqueOrThrow({ where: { id: t.tasks.tasks.t3 ?? '' } });
  expect(task.title).toBe('Classroom safety check');
  expect(task.cancelledAt).toBeNull();
}

/** A task of the second organisation, for cases that need one of the outsider's own. */
async function outsiderTask() {
  const res = await out()
    .post('/tasks', { title: 'Sunrise task', target: { userIds: [t.second.users.s2] } })
    .expect(201);
  return res.body.id as string;
}
afterAll(async () => {
  await t.close();
});

/** Every id in the demo organisation, for "never appears in the response" checks. */
function demoIds(): string[] {
  return [
    t.demo.organisationId,
    ...Object.values(t.demo.users),
    ...Object.values(t.demo.schools),
    ...Object.values(t.demo.roles),
    demoHolidayId,
    demoChangeId,
    demoCopyId,
    demoAttachmentId,
    demoTemplateId,
    ...Object.values(t.tasks.tasks),
    ...Object.values(t.tasks.categories),
    ...Object.values(t.tasks.priorities),
    ...Object.values(t.tasks.area),
    ...Object.values(t.tasks.messages),
    t.tasks.areaListId,
  ];
}

function expectNoDemoData(body: unknown) {
  const text = JSON.stringify(body);
  for (const id of demoIds()) expect(text).not.toContain(id);
  expect(text).not.toContain('Kidzonia Pre-schools');
}

type Case = () => Promise<void>;

/** Public routes need no isolation case: they act before any organisation is chosen. */
const PUBLIC_REASON: Record<string, string> = {
  'GET /health': 'no organisation data',
  'POST /auth/request-code': 'pre-sign-in; covered by auth tests',
  'POST /auth/verify-code': 'pre-sign-in; organisation chosen by the verified mobile',
  'POST /auth/login': 'pre-sign-in; organisation chosen by the verified mobile',
  'POST /auth/select-organisation': 'covered below as an extra case',
  'POST /auth/refresh': 'bound to the session in the cookie',
  'POST /register/request-code': 'pre-sign-in; creates no organisation data',
  'POST /register/verify-code': 'pre-sign-in; issues a token for a new organisation only',
  'POST /register': 'creates a brand-new organisation; covered by registration tests',
};

const singleton =
  (path: string): Case =>
  async () => {
    const res = await out().get(path).expect(200);
    expectNoDemoData(res.body);
  };

const listCase =
  (path: string): Case =>
  async () => {
    const res = await out()
      .get(`${path}${path.includes('?') ? '&' : '?'}limit=200`)
      .expect(200);
    expectNoDemoData(res.body);
  };

const tinyPng = (colour: string) =>
  sharp({ create: { width: 4, height: 4, channels: 3, background: colour } })
    .png()
    .toBuffer();

const cat = () => t.tasks.categories.Safety ?? '';
const pri = () => t.tasks.priorities.High ?? '';

/** A demo notification for Ananya, unread. */
async function demoNotification() {
  const org = t.demo.organisationId;
  const event = await t.prisma.notificationOutbox.create({
    data: {
      organisationId: org,
      recipientUserId: d('u1'),
      event: 'task_assigned',
      entityType: 'task',
      entityId: t.tasks.tasks.t3 ?? '',
      payload: {},
      dedupeKey: `isolation:${String(Math.random())}`,
    },
  });
  return t.prisma.notification.create({
    data: {
      organisationId: org,
      recipientUserId: d('u1'),
      outboxId: event.id,
      event: 'task_assigned',
      entityType: 'task',
      entityId: t.tasks.tasks.t3 ?? '',
      groupKey: `task_assigned:${t.tasks.tasks.t3 ?? ''}:2026-10-05`,
      createdAt: event.createdAt,
    },
  });
}

const CASES: Record<string, Case> = {
  // ---------- Phase 5: Home, notifications, reports, search ----------
  'GET /home': singleton('/home'),
  'GET /notifications': async () => {
    await demoNotification();
    expectNoDemoData((await out().get('/notifications').expect(200)).body);
  },
  'GET /notifications/count': async () => {
    expect((await out().get('/notifications/count').expect(200)).body).toEqual({ unread: 0 });
  },
  'POST /notifications/read': async () => {
    const n = await demoNotification();
    await out()
      .post('/notifications/read', { keys: [n.groupKey] })
      .expect(204);
    expect(
      (await t.prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt,
    ).toBeNull();
  },
  'POST /notifications/read-all': async () => {
    const n = await demoNotification();
    await out().post('/notifications/read-all').expect(204);
    expect(
      (await t.prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt,
    ).toBeNull();
  },
  'GET /me/notification-settings': singleton('/me/notification-settings'),
  'PUT /me/notification-settings': async () => {
    await out()
      .put('/me/notification-settings', { event: 'task_assigned', channel: 'sms', on: false })
      .expect(204);
    expect(
      await t.prisma.notificationPreference.count({
        where: { organisationId: t.demo.organisationId },
      }),
    ).toBe(0);
  },
  'PUT /me/school': async () => {
    await out().put('/me/school', { schoolId: t.demo.schools.kp }).expect(422);
  },
  'GET /reports/tasks': async () => {
    await singleton('/reports/tasks?range=this_month')();
    const res = await out()
      .get(`/reports/tasks?range=this_month&schoolId=${t.demo.schools.kp ?? ''}&userId=${d('u8')}`)
      .expect(200);
    expectNoDemoData(res.body);
    expect(res.body.dropped).toEqual(expect.arrayContaining(['school', 'person']));
  },
  'GET /reports/tasks.csv': async () => {
    const res = await out().get('/reports/tasks.csv?range=this_month').expect(200);
    expect(res.text).not.toContain('Ananya');
    expect(res.text).not.toContain('Jubilee Hills');
  },
  'GET /reports/tasks/people/:id': async () => {
    await out()
      .get(`/reports/tasks/people/${d('u8')}?range=this_month`)
      .expect(404);
  },
  'GET /saved-views': async () => {
    await t.prisma.savedView.create({
      data: {
        organisationId: t.demo.organisationId,
        userId: d('u1'),
        module: 'task_reports',
        name: 'Demo view',
        filters: { range: 'this_week' },
      },
    });
    const res = await out().get('/saved-views').expect(200);
    expect(JSON.stringify(res.body)).not.toContain('Demo view');
  },
  'POST /saved-views': async () => {
    await out()
      .post('/saved-views', { name: 'Mine', filters: { range: 'this_week' } })
      .expect(201);
  },
  'DELETE /saved-views/:id': async () => {
    const view = await t.prisma.savedView.create({
      data: {
        organisationId: t.demo.organisationId,
        userId: d('u1'),
        module: 'task_reports',
        name: 'Keep me',
        filters: { range: 'this_week' },
      },
    });
    await out().delete(`/saved-views/${view.id}`).expect(404);
    expect(await t.prisma.savedView.findUnique({ where: { id: view.id } })).not.toBeNull();
  },
  'GET /search': async () => {
    for (const q of ['Classroom', 'Ananya', 'Priya']) {
      expectNoDemoData((await out().get(`/search?q=${q}`).expect(200)).body);
    }
  },

  // ---------- Phase 4: logout block, day-end, schedule ----------
  'GET /me/blocking': async () => {
    const res = await out().get('/me/blocking').expect(200);
    expectNoDemoData(res.body);
  },
  'POST /release-requests': async () => {
    // Nothing blocks the outsider, and nothing is sent to the demo organisation.
    await out().post('/release-requests', {}).expect(422);
    expect(
      await t.prisma.notificationOutbox.count({ where: { event: 'logout_release_requested' } }),
    ).toBe(0);
  },
  'GET /users/:id/blocking': async () => {
    await out()
      .get(`/users/${d('u8')}/blocking`)
      .expect(404);
  },
  'POST /users/:id/release': async () => {
    await out()
      .post(`/users/${d('u8')}/release`, { dates: ['2026-10-05'] })
      .expect(404);
    expect(await t.prisma.logoutRelease.count()).toBe(0);
  },
  'GET /day-end-forms': listCase('/day-end-forms'),
  'POST /day-end-forms': async () => {
    await out()
      .post('/day-end-forms', {
        name: 'Borrowed roles',
        roleIds: [t.demo.roles.teacher],
        questions: [{ id: 'a', text: 'Ok?', type: 'yes_no', required: true }],
      })
      .expect(404);
  },
  'PUT /day-end-forms/:id': async () => {
    await out()
      .put(`/day-end-forms/${t.tasks.forms.f1 ?? ''}`, { name: 'Hacked' })
      .expect(404);
  },
  'DELETE /day-end-forms/:id': async () => {
    await out()
      .delete(`/day-end-forms/${t.tasks.forms.f1 ?? ''}`)
      .expect(404);
    const f = await t.prisma.dayEndForm.findUniqueOrThrow({
      where: { id: t.tasks.forms.f1 ?? '' },
    });
    expect(f.archivedAt).toBeNull();
  },
  'GET /day-end/today': async () => {
    expectNoDemoData((await out().get('/day-end/today').expect(200)).body);
  },
  'POST /assignments/:id/defer': async () => {
    await out()
      .post(`/assignments/${demoCopyId}/defer`, { toDate: '2030-01-07', reason: 'Hacked' })
      .expect(404);
  },
  'POST /assignments/:id/answers': async () => {
    await out()
      .post(`/assignments/${demoCopyId}/answers`, { answers: { a: true } })
      .expect(404);
  },
  'GET /organisation/schedule': async () => {
    // Global job status only; no organisation data in it.
    expectNoDemoData((await out().get('/organisation/schedule').expect(200)).body);
  },
  'POST /holidays/impact': async () => {
    const res = await out()
      .post('/holidays/impact', { startDate: '2026-10-05', schoolIds: [] })
      .expect(200);
    expect(res.body).toEqual({ oneTimeTasks: 0, copies: 0, titles: [] });
  },

  // ---------- task setup ----------
  'GET /task-setup': async () => {
    const res = await out().get('/task-setup').expect(200);
    expectNoDemoData(res.body);
    expect(res.body.categories).toEqual([]);
  },
  'POST /task-setup/categories': async () => {
    // The same name is fine in another organisation: uniqueness is per organisation.
    await out().post('/task-setup/categories', { name: 'Safety', color: '#111111' }).expect(201);
  },
  'PUT /task-setup/categories/:id': async () => {
    await out().put(`/task-setup/categories/${cat()}`, { name: 'Hacked' }).expect(404);
  },
  'DELETE /task-setup/categories/:id': async () => {
    await out().delete(`/task-setup/categories/${cat()}`).expect(404);
    const row = await t.prisma.taskCategory.findUniqueOrThrow({ where: { id: cat() } });
    expect(row.archivedAt).toBeNull();
  },
  'POST /task-setup/priorities': async () => {
    await out().post('/task-setup/priorities', { name: 'High', color: '#111111' }).expect(201);
  },
  'PUT /task-setup/priorities/order': async () => {
    await out()
      .put('/task-setup/priorities/order', { ids: Object.values(t.tasks.priorities) })
      .expect(400);
  },
  'PUT /task-setup/priorities/:id': async () => {
    await out().put(`/task-setup/priorities/${pri()}`, { name: 'Hacked' }).expect(404);
  },
  'DELETE /task-setup/priorities/:id': async () => {
    await out().delete(`/task-setup/priorities/${pri()}`).expect(404);
  },
  'POST /task-setup/lists': async () => {
    await out().post('/task-setup/lists', { name: 'Area' }).expect(201);
  },
  'PUT /task-setup/lists/:id': async () => {
    await out().put(`/task-setup/lists/${t.tasks.areaListId}`, { name: 'Hacked' }).expect(404);
  },
  'DELETE /task-setup/lists/:id': async () => {
    await out().delete(`/task-setup/lists/${t.tasks.areaListId}`).expect(404);
  },
  'POST /task-setup/lists/:id/values': async () => {
    await out().post(`/task-setup/lists/${t.tasks.areaListId}/values`, { value: 'X' }).expect(404);
  },
  'DELETE /task-setup/lists/:id/values/:valueId': async () => {
    await out()
      .delete(`/task-setup/lists/${t.tasks.areaListId}/values/${t.tasks.area.Kitchen ?? ''}`)
      .expect(404);
  },
  'POST /task-setup/message-templates': async () => {
    await out().post('/task-setup/message-templates', { name: 'Hi', body: 'Hello' }).expect(201);
  },
  'PUT /task-setup/message-templates/:id': async () => {
    await out()
      .put(`/task-setup/message-templates/${t.tasks.messages.tpl1 ?? ''}`, { name: 'Hacked' })
      .expect(404);
  },
  'DELETE /task-setup/message-templates/:id': async () => {
    await out()
      .delete(`/task-setup/message-templates/${t.tasks.messages.tpl1 ?? ''}`)
      .expect(404);
  },
  'GET /task-setup/templates': listCase('/task-setup/templates'),
  'POST /task-setup/templates': async () => {
    // Demo ids inside a template payload are just stored text; they grant nothing.
    await out()
      .post('/task-setup/templates', { name: 'Mine', payload: { title: 'x' } })
      .expect(201);
  },
  'PUT /task-setup/templates/:id': async () => {
    await out().put(`/task-setup/templates/${demoTemplateId}`, { name: 'Hacked' }).expect(404);
  },
  'DELETE /task-setup/templates/:id': async () => {
    await out().delete(`/task-setup/templates/${demoTemplateId}`).expect(404);
  },

  // ---------- tasks ----------
  'GET /tasks': async () => {
    for (const view of ['byme', 'team', 'watching']) await listCase(`/tasks?view=${view}`)();
  },
  'POST /tasks': async () => {
    // Naming someone from another organisation: they don't exist here.
    const r1 = await out()
      .post('/tasks', { title: 'x', target: { userIds: [d('u8')] } })
      .expect(422);
    expectNoDemoData(r1.body);
    await out()
      .post('/tasks', { title: 'x', target: { roleIds: [t.demo.roles.teacher] } })
      .expect(422);
    await out()
      .post('/tasks', {
        title: 'x',
        target: { userIds: [t.second.users.s2] },
        categoryId: cat(),
      })
      .expect(400);
    await out()
      .post('/tasks', {
        title: 'x',
        target: { userIds: [t.second.users.s2] },
        watchers: [{ userId: d('u2'), access: 'edit' }],
      })
      .expect(422);
    expect(
      await t.prisma.task.count({ where: { organisationId: t.demo.organisationId, title: 'x' } }),
    ).toBe(0);
  },
  'POST /tasks/target-preview': async () => {
    const res = await out()
      .post('/tasks/target-preview', { target: { userIds: [d('u8')] } })
      .expect(422);
    expectNoDemoData(res.body);
  },
  'GET /tasks/target-options': singleton('/tasks/target-options'),
  'GET /tasks/assignable-people': listCase('/tasks/assignable-people'),
  'GET /tasks/people': listCase('/tasks/people'),
  'GET /tasks/:id': async () => {
    await out()
      .get(`/tasks/${t.tasks.tasks.t3 ?? ''}`)
      .expect(404);
    const own = await outsiderTask();
    await out().get(`/tasks/${own}?copy=${demoCopyId}`).expect(404);
  },
  'PUT /tasks/:id': async () => {
    await out()
      .put(`/tasks/${t.tasks.tasks.t3 ?? ''}`, { title: 'Hacked' })
      .expect(404);
    const own = await outsiderTask();
    await out()
      .put(`/tasks/${own}`, { target: { userIds: [d('u8')] } })
      .expect(422);
    await demoTasksUnchanged();
  },
  'DELETE /tasks/:id': async () => {
    await out()
      .delete(`/tasks/${t.tasks.tasks.t3 ?? ''}`)
      .expect(404);
    await demoTasksUnchanged();
  },

  // ---------- copies ----------
  'GET /assignments': async () => {
    await listCase('/assignments?tab=my')();
    await listCase('/assignments?tab=approvals')();
  },
  'GET /assignments/:id': async () => {
    await out().get(`/assignments/${demoCopyId}`).expect(404);
  },
  'POST /assignments/:id/submit': async () => {
    await out().post(`/assignments/${demoCopyId}/submit`).expect(404);
  },
  'POST /assignments/:id/approve': async () => {
    await out().post(`/assignments/${demoCopyId}/approve`).expect(404);
    await demoTasksUnchanged();
  },
  'POST /assignments/:id/send-back': async () => {
    await out().post(`/assignments/${demoCopyId}/send-back`, { remarks: 'x' }).expect(404);
    await demoTasksUnchanged();
  },
  'POST /assignments/:id/cancel': async () => {
    await out().post(`/assignments/${demoCopyId}/cancel`, { reason: 'Hacked' }).expect(404);
    await demoTasksUnchanged();
  },
  'PUT /assignments/:id/subtasks/:subtaskId': async () => {
    await out()
      .put(`/assignments/${demoCopyId}/subtasks/${demoSubtaskId}`, { done: false })
      .expect(404);
    expect(
      await t.prisma.taskAssignmentSubtask.count({ where: { assignmentId: demoCopyId } }),
    ).toBe(3);
  },
  'POST /assignments/:id/attachments': async () => {
    await out()
      .postRaw(`/assignments/${demoCopyId}/attachments`, await tinyPng('#222222'), 'image/png')
      .expect(404);
  },
  'DELETE /assignments/:id/attachments/:attachmentId': async () => {
    await out().delete(`/assignments/${demoCopyId}/attachments/${demoAttachmentId}`).expect(404);
    expect(await t.prisma.taskAttachment.count({ where: { id: demoAttachmentId } })).toBe(1);
  },
  'GET /attachments/:id': async () => {
    await out().get(`/attachments/${demoAttachmentId}`).expect(404);
  },

  'GET /me': async () => {
    const res = await out().get('/me').expect(200);
    expect(res.body.organisation.id).toBe(t.second.organisationId);
    expectNoDemoData(res.body);
  },
  'GET /registry': async () => {
    expectNoDemoData((await out().get('/registry').expect(200)).body);
  },
  'POST /auth/logout': async () => {
    const extra = await signIn(t, SECOND_OWNER_MOBILE);
    await t.http.post('/api/auth/logout').set(CLIENT_HEADER).set(extra.auth).expect(204);
    await as(t, insider).get('/me').expect(200);
  },
  'POST /preview': async () => {
    await out()
      .post('/preview', { userId: d('u8') })
      .expect(404);
    await out().get('/me').set('X-Kidzonia-Preview', d('u8')).expect(404);
  },

  // ---------- organisation ----------
  'GET /organisation': singleton('/organisation'),
  'PUT /organisation': async () => {
    await out().put('/organisation', { name: 'Sunrise Kids Academy' }).expect(200);
    const demo = await t.prisma.organisation.findUniqueOrThrow({
      where: { id: t.demo.organisationId },
    });
    expect(demo.name).toBe('Kidzonia Pre-schools');
  },
  'GET /organisation/checklist': singleton('/organisation/checklist'),
  'POST /organisation/checklist/dismiss': async () => {
    await out().post('/organisation/checklist/dismiss').expect(204);
    const demo = await t.prisma.organisation.findUniqueOrThrow({
      where: { id: t.demo.organisationId },
    });
    expect(demo.checklistDismissedAt).toBeNull();
  },
  'GET /organisation/logo': async () => {
    // The demo gets a logo; the second organisation must not be served it.
    await as(t, insider)
      .postRaw('/organisation/logo', await tinyPng('#123456'), 'image/png')
      .expect(200);
    await out().get('/organisation/logo').expect(404);
  },
  'POST /organisation/logo': async () => {
    const before = await t.prisma.organisation.findUniqueOrThrow({
      where: { id: t.demo.organisationId },
    });
    await out()
      .postRaw('/organisation/logo', await tinyPng('#654321'), 'image/png')
      .expect(200);
    const after = await t.prisma.organisation.findUniqueOrThrow({
      where: { id: t.demo.organisationId },
    });
    expect(after.logoKey).toBe(before.logoKey);
  },
  'DELETE /organisation/logo': async () => {
    const before = await t.prisma.organisation.findUniqueOrThrow({
      where: { id: t.demo.organisationId },
    });
    await out().delete('/organisation/logo').expect(204);
    const after = await t.prisma.organisation.findUniqueOrThrow({
      where: { id: t.demo.organisationId },
    });
    expect(after.logoKey).toBe(before.logoKey);
  },

  // ---------- holidays ----------
  'GET /holidays': listCase('/holidays'),
  'POST /holidays': async () => {
    await out()
      .post('/holidays', { name: 'X', startDate: '2026-12-10', schoolIds: [t.demo.schools.jh] })
      .expect(404);
  },
  'PUT /holidays/:id': async () => {
    await out().put(`/holidays/${demoHolidayId}`, { name: 'Hacked' }).expect(404);
  },
  'DELETE /holidays/:id': async () => {
    await out().delete(`/holidays/${demoHolidayId}`).expect(404);
    const h = await t.prisma.holiday.findUniqueOrThrow({ where: { id: demoHolidayId } });
    expect(h.deletedAt).toBeNull();
  },

  // ---------- schools ----------
  'GET /schools': listCase('/schools'),
  'GET /schools/:id': async () => {
    await out().get(`/schools/${t.demo.schools.jh}`).expect(404);
  },
  'POST /schools': async () => {
    await out()
      .post('/schools', { name: 'Linked', city: 'X', type: 'coco', principalUserId: d('u5') })
      .expect(422);
    await out()
      .post('/schools', {
        name: 'Linked2',
        city: 'X',
        type: 'franchise',
        inviteOwner: { fullName: 'Y', mobile: '96660 55555', roleId: t.demo.roles.franchise_owner },
      })
      .expect(404);
  },
  'PUT /schools/:id': async () => {
    await out().put(`/schools/${t.demo.schools.jh}`, { name: 'Hacked' }).expect(404);
    await out()
      .put(`/schools/${t.second.schools.mp}`, { principalUserId: d('u5') })
      .expect(422);
  },
  'DELETE /schools/:id': async () => {
    await out().delete(`/schools/${t.demo.schools.gb}`).expect(404);
  },

  // ---------- users ----------
  'GET /users': async () => {
    await listCase('/users')();
    const res = await out().get('/users?search=Meera').expect(200);
    expect(res.body.items).toEqual([]);
  },
  'GET /users/summary': async () => {
    const res = await out().get('/users/summary').expect(200);
    expect(res.body).toEqual({ total: 2, waitingForRole: 0 });
  },
  'POST /users': async () => {
    await out()
      .post('/users', {
        fullName: 'X',
        mobile: '96660 44444',
        homeSchoolId: t.demo.schools.jh,
        sendInvite: false,
      })
      .expect(422);
    await out()
      .post('/users', {
        fullName: 'X',
        mobile: '96660 44445',
        homeSchoolId: t.second.schools.mp,
        reportsToUserId: d('u5'),
        sendInvite: false,
      })
      .expect(422);
    await out()
      .post('/users', {
        fullName: 'X',
        mobile: '96660 44446',
        homeSchoolId: t.second.schools.mp,
        sendInvite: false,
        role: { roleId: t.demo.roles.teacher, scope: { allSchools: true, schoolIds: [] } },
      })
      .expect(404);
  },
  'GET /users/:id': async () => {
    await out()
      .get(`/users/${d('u8')}`)
      .expect(404);
  },
  'PUT /users/:id': async () => {
    await out()
      .put(`/users/${d('u8')}`, { fullName: 'Hacked' })
      .expect(404);
    await out().put(`/users/${t.second.users.s2}`, { homeSchoolId: t.demo.schools.jh }).expect(422);
    await out()
      .put(`/users/${t.second.users.s2}`, { reportsToUserId: d('u5') })
      .expect(422);
  },
  'DELETE /users/:id': async () => {
    await out()
      .delete(`/users/${d('u9')}`)
      .expect(404);
  },
  'PUT /users/:id/role': async () => {
    await out()
      .put(`/users/${d('u8')}/role`, { role: null })
      .expect(404);
    await out()
      .put(`/users/${t.second.users.s2}/role`, {
        role: { roleId: t.demo.roles.teacher, scope: { allSchools: true, schoolIds: [] } },
      })
      .expect(404);
    await out()
      .put(`/users/${t.second.users.s2}/role`, {
        role: {
          roleId: t.second.roles.teacher,
          scope: { allSchools: false, schoolIds: [t.demo.schools.jh] },
        },
      })
      .expect(404);
  },
  'POST /users/:id/deactivate': async () => {
    await out()
      .post(`/users/${d('u9')}/deactivate`)
      .expect(404);
    await out()
      .post(`/users/${t.second.users.s2}/deactivate`, { moveReportsTo: d('u5') })
      .expect(422);
  },
  'POST /users/:id/reactivate': async () => {
    await out()
      .post(`/users/${d('u9')}/reactivate`)
      .expect(404);
  },
  'POST /users/:id/invite': async () => {
    await out()
      .post(`/users/${d('u9')}/invite`)
      .expect(404);
  },
  'GET /me/profile': async () => {
    expectNoDemoData((await out().get('/me/profile').expect(200)).body);
  },
  'PUT /me/profile': async () => {
    await out()
      .put('/me/profile', { reportsToUserId: d('u1') })
      .expect(422);
  },
  'PUT /me/password': async () => {
    // Only ever changes the signed-in person's own password.
    await out().put('/me/password', { newPassword: 'outsider-password-1' }).expect(204);
    await t.http
      .post('/api/auth/login')
      .send({ mobile: mobileOf('u1'), password: 'outsider-password-1' })
      .expect(401);
  },

  // ---------- roles ----------
  'GET /roles': listCase('/roles'),
  'GET /roles/assignable': listCase('/roles/assignable'),
  'POST /roles': async () => {
    await out()
      .post('/roles', { name: 'Copycat', copyFromRoleId: t.demo.roles.principal })
      .expect(404);
  },
  'GET /roles/:id': async () => {
    await out().get(`/roles/${t.demo.roles.teacher}`).expect(404);
  },
  'PUT /roles/:id': async () => {
    await out().put(`/roles/${t.demo.roles.teacher}`, { name: 'Hacked' }).expect(404);
  },
  'DELETE /roles/:id': async () => {
    await out().delete(`/roles/${t.demo.roles.dept_head}`).expect(404);
  },
  'GET /roles/:id/permissions': async () => {
    await out().get(`/roles/${t.demo.roles.teacher}/permissions`).expect(404);
  },
  'PUT /roles/:id/permissions': async () => {
    await out().put(`/roles/${t.demo.roles.teacher}/permissions`, { modules: {} }).expect(404);
  },
  'GET /roles/:id/fields': async () => {
    await out().get(`/roles/${t.demo.roles.teacher}/fields`).expect(404);
  },
  'PUT /roles/:id/fields': async () => {
    await out().put(`/roles/${t.demo.roles.teacher}/fields`, { fields: {} }).expect(404);
  },
  'GET /roles/:id/assignments': async () => {
    await out().get(`/roles/${t.demo.roles.teacher}/assignments`).expect(404);
  },
  'POST /roles/:id/assignments': async () => {
    await out()
      .post(`/roles/${t.demo.roles.teacher}/assignments`, {
        userId: t.second.users.s2,
        scope: { allSchools: true, schoolIds: [] },
      })
      .expect(404);
    await out()
      .post(`/roles/${t.second.roles.teacher}/assignments`, {
        userId: d('u8'),
        scope: { allSchools: true, schoolIds: [] },
      })
      .expect(404);
  },
  'DELETE /roles/:id/assignments/:userId': async () => {
    await out()
      .delete(`/roles/${t.demo.roles.teacher}/assignments/${d('u8')}`)
      .expect(404);
  },
  'GET /automatic-roles': singleton('/automatic-roles'),
  'PUT /automatic-roles': async () => {
    await out()
      .put('/automatic-roles', { switches: { manager_sees_team_tasks: false } })
      .expect(200);
    const demo = await t.prisma.automaticRoleSetting.findMany({
      where: { organisationId: t.demo.organisationId },
    });
    expect(demo).toEqual([]);
  },

  // ---------- pending changes ----------
  'GET /field-changes': async () => {
    await listCase('/field-changes?view=to_approve')();
    await listCase('/field-changes?view=mine')();
  },
  'GET /field-changes/count': async () => {
    expect((await out().get('/field-changes/count').expect(200)).body).toEqual({ toApprove: 0 });
  },
  'POST /field-changes/:id/approve': async () => {
    await out().post(`/field-changes/${demoChangeId}/approve`).expect(404);
  },
  'POST /field-changes/:id/reject': async () => {
    await out().post(`/field-changes/${demoChangeId}/reject`).expect(404);
    const row = await t.prisma.pendingFieldChange.findUniqueOrThrow({
      where: { id: demoChangeId },
    });
    expect(row.status).toBe('pending');
  },
};

describe('tenant isolation', () => {
  const routes = () =>
    t.app.routes.routes.map((r) => ({
      key: `${r.method.toUpperCase()} ${r.path}`,
      access: r.access,
    }));

  it('has a case for every authenticated route and a reason for every public one', () => {
    const missing = routes().filter((r) =>
      r.access === 'authenticated' ? !(r.key in CASES) : !(r.key in PUBLIC_REASON),
    );
    expect(missing).toEqual([]);
  });

  it('has no stale cases for routes that no longer exist', () => {
    const keys = new Set(routes().map((r) => r.key));
    expect(Object.keys(CASES).filter((k) => !keys.has(k))).toEqual([]);
    expect(Object.keys(PUBLIC_REASON).filter((k) => !keys.has(k))).toEqual([]);
  });

  for (const [key, run] of Object.entries(CASES)) {
    it(key, async () => {
      await run();
    });
  }

  it('the other way round: the demo Owner sees nothing of the second organisation', async () => {
    // By now the cases above have given the second organisation tasks, a
    // category, a saved view and more; collect every id it holds.
    const org = t.second.organisationId;
    const where = { where: { organisationId: org }, select: { id: true } };
    const rows = await Promise.all([
      t.prisma.task.findMany(where),
      t.prisma.taskAssignment.findMany(where),
      t.prisma.taskCategory.findMany(where),
      t.prisma.taskPriority.findMany(where),
      t.prisma.taskList.findMany(where),
      t.prisma.taskTemplate.findMany(where),
      t.prisma.parentMessageTemplate.findMany(where),
      t.prisma.holiday.findMany(where),
      t.prisma.savedView.findMany(where),
      t.prisma.dayEndForm.findMany(where),
    ]);
    const secondIds = [
      org,
      ...Object.values(t.second.users),
      ...Object.values(t.second.schools),
      ...Object.values(t.second.roles),
      ...rows.flat().map((r) => r.id),
    ];
    const mine = as(t, insider);
    for (const path of [
      '/users?limit=200',
      '/schools?limit=200',
      '/roles?limit=200',
      '/tasks?view=byme&limit=200',
      '/assignments?tab=my&limit=200',
      '/holidays?limit=200',
      '/day-end-forms?limit=200',
      '/task-setup',
      '/notifications',
      '/home',
      '/reports/tasks?range=this_month',
      '/saved-views',
      '/search?q=Sun',
    ]) {
      const text = JSON.stringify((await mine.get(path).expect(200)).body);
      for (const id of secondIds) expect([path, text.includes(id)]).toEqual([path, false]);
      // Names only: the second organisation also has a "Priya Sharma".
      expect([path, text.includes('Sunrise Kids Academy')]).toEqual([path, false]);
      expect([path, text.includes('Nisha Kapoor')]).toEqual([path, false]);
    }
    await mine.put(`/schools/${t.second.schools.mp}`, { name: 'Hacked' }).expect(404);
    await mine.put(`/users/${t.second.users.s2}`, { fullName: 'Hacked' }).expect(404);
    const school = await t.prisma.school.findUniqueOrThrow({
      where: { id: t.second.schools.mp ?? '' },
    });
    expect(school.name).not.toBe('Hacked');
    const user = await t.prisma.user.findUniqueOrThrow({ where: { id: t.second.users.s2 ?? '' } });
    expect(user.fullName).toBe('Priya Sharma');
  });

  it('a token for one organisation never works against another’s session', async () => {
    const insiderSession = await t.prisma.authSession.findFirstOrThrow({
      where: { userId: d('u1'), revokedAt: null },
    });
    const { token } = await t.deps.tokens.issueAccess(
      {
        userId: t.second.users.s1 ?? '',
        organisationId: t.second.organisationId,
        sessionId: insiderSession.id,
      },
      new Date(),
    );
    await t.http.get('/api/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('a selection token can’t open an organisation the person isn’t in', async () => {
    const code = await t.http.post('/api/auth/request-code').send({ mobile: mobileOf('u8') });
    const verify = await t.http
      .post('/api/auth/verify-code')
      .send({ challengeId: code.body.challengeId, code: t.messages.sent.at(-1)?.code })
      .expect(200);
    const thirdOrg = await t.deps.data.createOrganisation({
      name: 'Third',
      setupType: 'single_school',
      schoolModel: 'coco',
    });
    await t.http
      .post('/api/auth/select-organisation')
      .send({ selectionToken: verify.body.selectionToken, organisationId: thirdOrg.id })
      .expect(401);
  });
});
