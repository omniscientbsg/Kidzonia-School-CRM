import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, zonedInstant } from '@kidzonia/shared';
import { NotificationWorker } from '../../src/core/notifications/worker.js';
import { TaskSchedule } from '../../src/apps/tasks/schedule.js';
import { as as asSession, createTestApp, mobileOf, signIn } from '../support/app.js';
import type { TestApp } from '../support/app.js';

/** Notifications (brief 10.1, 10.2; Phase 5 c, answers 2-4, additions d-e). */

const MONDAY = '2026-10-05';
const at = (time: string, date = MONDAY) => zonedInstant(date, time, 'Asia/Kolkata');

let t: TestApp;
let worker: NotificationWorker;
/** A fresh session each time: the clock jumps past the access token's lifetime here. */
async function as(key: string) {
  return asSession(t, await signIn(t, mobileOf(key), t.demo.organisationId));
}
const u = (k: string) => t.demo.users[k] ?? '';

beforeAll(async () => {
  t = await createTestApp({}, { now: at('10:00') });
  worker = new NotificationWorker(t.deps);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.prisma.rateLimit.deleteMany();
});

type Body = Record<string, unknown>;
const deliver = () => worker.run(t.clock.now);
const sms = () => t.messages.notifications;

describe('delivery', () => {
  it('delivers the outbox in-app, once, however often it runs', async () => {
    const res = await (
      await as('u5')
    )
      .post('/tasks', { title: 'Tidy the book corner', target: { userIds: [u('u8'), u('u9')] } })
      .expect(201);
    await deliver();
    await deliver();
    const rows = await t.prisma.notification.findMany({
      where: { entityId: res.body.id as string },
    });
    expect(rows.map((r) => r.recipientUserId).sort()).toEqual([u('u8'), u('u9')].sort());
    const bell = await (await as('u8')).get('/notifications').expect(200);
    const mine = (bell.body.items as Body[]).filter((i) =>
      String(i.text).includes('Tidy the book corner'),
    );
    expect(mine).toEqual([
      expect.objectContaining({ text: 'Meera Iyer gave you “Tidy the book corner”', unread: 1 }),
    ]);
  });

  it('groups similar ones, counts unread groups, marks read and read all', async () => {
    const res = await (
      await as('u5')
    )
      .post('/tasks', {
        title: 'Wall display photo',
        target: { userIds: [u('u8'), u('u9'), u('u10')] },
        needsApproval: true,
      })
      .expect(201);
    for (const key of ['u8', 'u9', 'u10']) {
      const copy = await t.prisma.taskAssignment.findFirstOrThrow({
        where: { taskId: res.body.id as string, userId: u(key) },
      });
      await (await as(key)).post(`/assignments/${copy.id}/submit`).expect(200);
    }
    await deliver();
    const meera = await as('u5');
    const bell = await meera.get('/notifications').expect(200);
    const group = (bell.body.items as Body[]).find((i) =>
      String(i.text).includes('Wall display photo'),
    ) as Body;
    expect(group).toMatchObject({
      text: '3 people submitted “Wall display photo”',
      count: 3,
      unread: 3,
    });
    const before = (await meera.get('/notifications/count').expect(200)).body.unread as number;
    await meera.post('/notifications/read', { keys: [group.key] }).expect(204);
    expect((await meera.get('/notifications/count').expect(200)).body.unread).toBe(before - 1);
    await meera.post('/notifications/read-all').expect(204);
    expect((await meera.get('/notifications/count').expect(200)).body.unread).toBe(0);
  });

  it('shows "This task was removed" for a cancelled task (addition e)', async () => {
    const res = await (
      await as('u5')
    )
      .post('/tasks', { title: 'Soon cancelled', target: { userIds: [u('u8')] } })
      .expect(201);
    await deliver();
    await (await as('u5')).delete(`/tasks/${res.body.id as string}`).expect(204);
    const bell = await (await as('u8')).get('/notifications').expect(200);
    const item = (bell.body.items as Body[]).find((i) => i.removed) as Body;
    expect(item).toMatchObject({ text: 'This task was removed', href: null, removed: true });
    expect(JSON.stringify(bell.body)).not.toContain('Soon cancelled');
  });

  it('respects muting per event and channel', async () => {
    const priya = await as('u8');
    const settings = await priya.get('/me/notification-settings').expect(200);
    const assigned = (settings.body.events as Body[]).find((e) => e.event === 'task_assigned');
    expect(assigned).toMatchObject({ inApp: true, sms: true });
    const approved = (settings.body.events as Body[]).find((e) => e.event === 'task_approved');
    expect(approved?.sms).toBeNull();
    await priya
      .put('/me/notification-settings', { event: 'task_assigned', channel: 'in_app', on: false })
      .expect(204);
    await priya
      .put('/me/notification-settings', { event: 'task_approved', channel: 'sms', on: true })
      .expect(400);
    const res = await (
      await as('u5')
    )
      .post('/tasks', { title: 'Muted one', target: { userIds: [u('u8')] } })
      .expect(201);
    await deliver();
    expect(await t.prisma.notification.count({ where: { entityId: res.body.id as string } })).toBe(
      0,
    );
    await priya
      .put('/me/notification-settings', { event: 'task_assigned', channel: 'in_app', on: true })
      .expect(204);
  });

  it('cleans up notifications 90 days after they were created (answer 2)', async () => {
    const n = await t.prisma.notification.findFirstOrThrow({ where: { recipientUserId: u('u9') } });
    await t.prisma.notification.update({
      where: { id: n.id },
      data: { createdAt: addDaysDate(t.clock.now, -91) },
    });
    const out = await worker.cleanUp(t.clock.now);
    expect(out.notifications).toBeGreaterThanOrEqual(1);
    expect(await t.prisma.notification.findUnique({ where: { id: n.id } })).toBeNull();
  });
});

describe('SMS / WhatsApp (answer 3)', () => {
  it('sends assigned to the current mobile, never to deactivated people', async () => {
    await t.prisma.user.update({ where: { id: u('u9') }, data: { mobile: '+919812345678' } });
    const res = await (
      await as('u5')
    )
      .post('/tasks', { title: 'Collect library books', target: { userIds: [u('u9'), u('u10')] } })
      .expect(201);
    await t.prisma.user.update({ where: { id: u('u10') }, data: { status: 'inactive' } });
    await deliver();
    expect(
      sms().some((m) => m.mobile === '+919812345678' && m.text.includes('Collect library books')),
    ).toBe(true);
    const skipped = await t.prisma.notificationDelivery.findMany({
      where: { outbox: { entityId: res.body.id as string, recipientUserId: u('u10') } },
    });
    expect(skipped.map((d) => d.status).sort()).toEqual(['skipped', 'skipped']);
    await t.prisma.user.update({ where: { id: u('u10') }, data: { status: 'active' } });
  });

  it('holds messages in quiet hours and drops them in the morning if no longer relevant', async () => {
    t.clock.now = at('22:00');
    const res = await (
      await as('u5')
    )
      .post('/tasks', {
        title: 'Evening note',
        dueType: 'on_date',
        dueDate: addDays(MONDAY, 1),
        target: { userIds: [u('u8'), u('u9')] },
      })
      .expect(201);
    const sent = sms().length;
    await deliver();
    expect(sms().length).toBe(sent);
    const held = await t.prisma.notificationDelivery.findMany({
      where: { channel: 'sms', outbox: { entityId: res.body.id as string } },
    });
    expect(held.map((d) => d.status)).toEqual(['held', 'held']);
    // Rohan finishes it overnight; Priya doesn't.
    const rohan = await t.prisma.taskAssignment.findFirstOrThrow({
      where: { taskId: res.body.id as string, userId: u('u9') },
    });
    await t.prisma.taskAssignment.update({ where: { id: rohan.id }, data: { status: 'done' } });
    t.clock.now = at('07:05', addDays(MONDAY, 1));
    await deliver();
    const after = await t.prisma.notificationDelivery.findMany({
      where: { channel: 'sms', outbox: { entityId: res.body.id as string } },
      include: { outbox: true },
    });
    const byPerson = Object.fromEntries(after.map((d) => [d.outbox.recipientUserId, d]));
    expect(byPerson[u('u8')]?.status).toBe('sent');
    expect(byPerson[u('u9')]).toMatchObject({ status: 'skipped', lastError: 'no longer relevant' });
  });

  it('retries failures with backoff', async () => {
    t.clock.now = at('10:00', addDays(MONDAY, 1));
    t.messages.failNotifications = 1;
    const res = await (
      await as('u5')
    )
      .post('/tasks', { title: 'Retry me', target: { userIds: [u('u8')] } })
      .expect(201);
    await deliver();
    const first = await t.prisma.notificationDelivery.findFirstOrThrow({
      where: { channel: 'sms', outbox: { entityId: res.body.id as string } },
    });
    expect(first).toMatchObject({ status: 'pending', attempts: 1 });
    t.clock.now = new Date(t.clock.now.getTime() + 2 * 60_000);
    await deliver();
    const second = await t.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(second).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('sends "due soon" by SMS only for tasks that block logout, by default', async () => {
    t.clock.now = at('08:10', addDays(MONDAY, 2));
    const plain = await (
      await as('u5')
    )
      .post('/tasks', {
        title: 'Plain due soon',
        dueType: 'at_time',
        dueTime: '09:00',
        target: { userIds: [u('u8')] },
      })
      .expect(201);
    const blocking = await (
      await as('u5')
    )
      .post('/tasks', {
        title: 'Blocking due soon',
        dueType: 'at_time',
        dueTime: '09:00',
        blocksLogout: true,
        target: { userIds: [u('u8')] },
      })
      .expect(201);
    await new TaskSchedule(t.deps).run(t.clock.now);
    await t.prisma.notificationDelivery.deleteMany({ where: { lastError: 'daily cap' } });
    await deliver();
    const status = async (taskId: string) =>
      (
        await t.prisma.notificationDelivery.findFirstOrThrow({
          where: { channel: 'sms', outbox: { entityId: taskId, event: 'task_due_soon' } },
        })
      ).status;
    expect(await status(plain.body.id as string)).toBe('skipped');
    expect(await status(blocking.body.id as string)).toBe('sent');
  });

  it('sends "assigned" once when someone starts receiving a repeating task, not every day', async () => {
    t.clock.now = at('08:00', addDays(MONDAY, 2));
    const res = await (
      await as('u5')
    )
      .post('/tasks', { title: 'Daily register', repeat: 'daily', target: { userIds: [u('u9')] } })
      .expect(201);
    const schedule = new TaskSchedule(t.deps);
    for (let d = 2; d < 6; d++) {
      t.clock.now = at('06:00', addDays(MONDAY, d));
      await schedule.run(t.clock.now);
    }
    const events = await t.prisma.notificationOutbox.count({
      where: { event: 'task_assigned', entityId: res.body.id as string, recipientUserId: u('u9') },
    });
    expect(events).toBe(1);
    expect(
      await t.prisma.taskAssignment.count({ where: { taskId: res.body.id as string } }),
    ).toBeGreaterThan(3);
  });
});

describe('the daily SMS/WhatsApp cap (answer 3)', () => {
  it('stops at the cap per organisation and records why', async () => {
    // Its own app (last in this file): a cap of 2 a day.
    await t.close();
    t = await createTestApp({ SMS_DAILY_CAP_PER_ORG: '2' }, { now: at('10:00') });
    worker = new NotificationWorker(t.deps);
    const res = await (
      await as('u5')
    )
      .post('/tasks', { title: 'Cap test', target: { userIds: [u('u8'), u('u9'), u('u10')] } })
      .expect(201);
    await deliver();
    const rows = await t.prisma.notificationDelivery.findMany({
      where: { channel: 'sms', outbox: { entityId: res.body.id as string } },
    });
    expect(rows.filter((d) => d.status === 'sent')).toHaveLength(2);
    expect(rows.filter((d) => d.lastError === 'daily cap')).toHaveLength(1);
  });
});

function addDaysDate(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}
