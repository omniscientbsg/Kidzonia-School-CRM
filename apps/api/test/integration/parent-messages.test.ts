import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, zonedInstant } from '@kidzonia/shared';
import { ParentMessageWorker } from '../../src/apps/tasks/parent-messages.js';
import { ConsoleMessageProvider } from '../../src/core/messaging.js';
import { as as asSession, createTestApp, mobileOf, signIn } from '../support/app.js';
import type { TestApp } from '../support/app.js';

/**
 * Messages to parents (brief 9.12, Phase 6 answers 1-3): queued once per copy
 * on approval or done, sent only to parents who agreed, held overnight,
 * limited per parent and per organisation, idempotent, and logged with counts
 * only. Seeded: Nursery A at Jubilee Hills has five children; three parents
 * agreed (Neha, who also has a child in KG 1; Kiran; Swathi), one didn't, one
 * opted out.
 */

const MONDAY = '2026-10-05';
const at = (time: string, date = MONDAY) => zonedInstant(date, time, 'Asia/Kolkata');

let t: TestApp;
let worker: ParentMessageWorker;
/**
 * Sessions are reused while the test clock stays within a few hours, and made
 * afresh when it jumps days (access tokens last 12 hours; signing in on every
 * call would hit the sign-in rate limit).
 */
const sessions = new Map<string, { at: number; s: Awaited<ReturnType<typeof signIn>> }>();
async function as(key: string) {
  const now = t.clock.now.getTime();
  const hit = sessions.get(key);
  if (!hit || Math.abs(now - hit.at) > 6 * 3600_000) {
    sessions.set(key, { at: now, s: await signIn(t, mobileOf(key), t.demo.organisationId) });
  }
  return asSession(
    t,
    sessions.get(key)?.s ?? (await signIn(t, mobileOf(key), t.demo.organisationId)),
  );
}
const u = (k: string) => t.demo.users[k] ?? '';
const tpl = (k: string) => t.tasks.messages[k] ?? '';

beforeAll(async () => {
  t = await createTestApp({}, { now: at('10:00') });
  worker = new ParentMessageWorker(t.deps);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.prisma.rateLimit.deleteMany();
});

type Body = Record<string, unknown>;
const deliver = () => worker.run(t.clock.now);
const sent = () => t.messages.parentMessages;

/** A task for Priya (Nursery A) with "Message parents"; returns her copy's id. */
async function priyaTask(
  title: string,
  opts: { needsApproval?: boolean; className?: string; eventName?: string; activity?: string } = {},
) {
  const res = await (
    await as('u5')
  )
    .post('/tasks', {
      title,
      target: { userIds: [u('u8')] },
      needsApproval: opts.needsApproval ?? false,
      parentMessage: {
        templateId: tpl('tpl3'),
        className: opts.className ?? 'Nursery A',
        eventName: opts.eventName ?? null,
        activity: opts.activity ?? null,
      },
    })
    .expect(201);
  const copy = await t.prisma.taskAssignment.findFirstOrThrow({
    where: { taskId: res.body.id as string },
  });
  return { taskId: res.body.id as string, copyId: copy.id };
}
const messageOf = (copyId: string) =>
  t.prisma.parentMessage.findFirst({ where: { assignmentId: copyId } });

describe('when parents are messaged', () => {
  it('on approval, once, even after a send-back; never on submit or send-back', async () => {
    const { copyId } = await priyaTask('Leaf painting', { needsApproval: true });
    const priya = await as('u8');
    const meera = await as('u5');
    await priya.post(`/assignments/${copyId}/submit`).expect(200);
    expect(await messageOf(copyId)).toBeNull();
    await meera.post(`/assignments/${copyId}/send-back`, { remarks: 'Add photos' }).expect(200);
    expect(await messageOf(copyId)).toBeNull();
    await priya.post(`/assignments/${copyId}/submit`).expect(200);
    await meera.post(`/assignments/${copyId}/approve`).expect(200);
    const before = sent().length;
    await deliver();
    await deliver();
    const m = await messageOf(copyId);
    expect(m).toMatchObject({ status: 'sent', recipientsCount: 3, sentCount: 3 });
    const mine = sent().slice(before);
    expect(mine.map((x) => x.mobile).sort()).toEqual([
      '+919999900001',
      '+919999900002',
      '+919999900003',
    ]);
    // Filled in per child; {activity} defaults to the task's title.
    expect(mine.find((x) => x.mobile === '+919999900001')?.text).toBe(
      'Dear parent, today Nursery A completed Leaf painting. Photos are on the school app.',
    );
    // Only one message per copy, however often it's approved.
    expect(await t.prisma.parentMessage.count({ where: { assignmentId: copyId } })).toBe(1);
  });

  it('on done when no approval is needed, with the event name and activity given', async () => {
    const { copyId } = await priyaTask('Sports day prep', { activity: 'relay practice' });
    await (await as('u8')).post(`/assignments/${copyId}/submit`).expect(200);
    const before = sent().length;
    await deliver();
    expect(sent().slice(before)[0]?.text).toBe(
      'Dear parent, today Nursery A completed relay practice. Photos are on the school app.',
    );
  });

  it('never for cancelled work, head office work, or a class with no agreed parents', async () => {
    const cancelled = await priyaTask('Cancelled one');
    await (
      await as('u5')
    )
      .post(`/assignments/${cancelled.copyId}/cancel`, { reason: 'Rain' })
      .expect(200);
    expect(await messageOf(cancelled.copyId)).toBeNull();
    const empty = await priyaTask('Empty class', { className: 'Playgroup' });
    await (await as('u8')).post(`/assignments/${empty.copyId}/submit`).expect(200);
    await deliver();
    expect(await messageOf(empty.copyId)).toMatchObject({
      status: 'skipped',
      skipReason: 'No parent in Playgroup has agreed to messages.',
    });
  });
});

describe('the rules for parents (answer 3)', () => {
  it('holds messages overnight and sends them in the morning', async () => {
    t.clock.now = at('21:30');
    const { copyId } = await priyaTask('Evening craft');
    await (await as('u8')).post(`/assignments/${copyId}/submit`).expect(200);
    const before = sent().length;
    await deliver();
    expect(sent().length).toBe(before);
    expect(await t.prisma.parentMessageRecipient.count({ where: { status: 'held' } })).toBe(3);
    t.clock.now = at('07:05', addDays(MONDAY, 1));
    await deliver();
    expect(await messageOf(copyId)).toMatchObject({ status: 'sent', sentCount: 3 });
  });

  it('sends a parent at most three messages a day', async () => {
    t.clock.now = at('09:00', addDays(MONDAY, 2));
    const neha = '+919999900001';
    const count = () =>
      t.prisma.parentMessageRecipient.count({
        where: {
          status: 'sent',
          guardian: { mobile: neha },
          sentAt: { gte: at('00:00', addDays(MONDAY, 2)) },
        },
      });
    for (const title of ['One', 'Two', 'Three', 'Four']) {
      const { copyId } = await priyaTask(`Limit ${title}`);
      await (await as('u8')).post(`/assignments/${copyId}/submit`).expect(200);
      await deliver();
    }
    expect(await count()).toBe(3);
    const limited = await t.prisma.parentMessageRecipient.findFirstOrThrow({
      where: { guardian: { mobile: neha }, lastError: 'parent daily limit' },
    });
    expect(limited.status).toBe('skipped');
  });

  it('never texts a parent who opted out after the message was queued', async () => {
    t.clock.now = at('10:00', addDays(MONDAY, 3));
    const kiran = await t.prisma.guardian.findFirstOrThrow({ where: { mobile: '+919999900002' } });
    const { copyId } = await priyaTask('Opt out race');
    await (await as('u8')).post(`/assignments/${copyId}/submit`).expect(200);
    // Queued with Kiran agreed; Kiran opts out before the worker sends.
    // The Owner marks it (Meera still has earlier blocking work, which refuses non-task writes).
    await (
      await as('u1')
    )
      .put(`/parent-contacts/guardians/${kiran.id}/consent`, { consent: 'opted_out' })
      .expect(204);
    const before = sent().length;
    await deliver();
    expect(
      sent()
        .slice(before)
        .map((x) => x.mobile),
    ).not.toContain('+919999900002');
    const r = await t.prisma.parentMessageRecipient.findMany({
      where: { message: { assignmentId: copyId }, guardianId: kiran.id },
    });
    // Opted out before the recipients were chosen: not a recipient at all.
    expect(r).toEqual([]);
    await (
      await as('u1')
    )
      .put(`/parent-contacts/guardians/${kiran.id}/consent`, { consent: 'agreed' })
      .expect(204);
  });

  it('checks consent again at the moment of sending', async () => {
    t.clock.now = at('10:30', addDays(MONDAY, 3));
    const kiran = await t.prisma.guardian.findFirstOrThrow({ where: { mobile: '+919999900002' } });
    const { copyId } = await priyaTask('Opt out at send');
    await (await as('u8')).post(`/assignments/${copyId}/submit`).expect(200);
    // Recipients chosen overnight-style: held, then Kiran opts out before the morning send.
    t.clock.now = at('22:00', addDays(MONDAY, 3));
    await deliver();
    await (
      await as('u1')
    )
      .put(`/parent-contacts/guardians/${kiran.id}/consent`, { consent: 'opted_out' })
      .expect(204);
    t.clock.now = at('07:10', addDays(MONDAY, 4));
    const before = sent().length;
    await deliver();
    expect(
      sent()
        .slice(before)
        .map((x) => x.mobile),
    ).not.toContain('+919999900002');
    const r = await t.prisma.parentMessageRecipient.findFirstOrThrow({
      where: { message: { assignmentId: copyId }, guardianId: kiran.id },
    });
    expect(r).toMatchObject({ status: 'skipped', lastError: 'no longer agreed' });
    await (
      await as('u1')
    )
      .put(`/parent-contacts/guardians/${kiran.id}/consent`, { consent: 'agreed' })
      .expect(204);
  });

  it('sends the same idempotency key again after a crash, so a parent gets one text', async () => {
    t.clock.now = at('11:00', addDays(MONDAY, 4));
    const { copyId } = await priyaTask('Crash check');
    await (await as('u8')).post(`/assignments/${copyId}/submit`).expect(200);
    await deliver();
    const r = await t.prisma.parentMessageRecipient.findFirstOrThrow({
      where: { message: { assignmentId: copyId }, status: 'sent' },
    });
    const key = `${r.parentMessageId}:${r.id}`;
    // Died after sending, before recording: the row still says pending.
    await t.prisma.parentMessageRecipient.update({
      where: { id: r.id },
      data: { status: 'pending', sentAt: null },
    });
    await t.prisma.parentMessage.update({
      where: { id: r.parentMessageId },
      data: { status: 'sending' },
    });
    await deliver();
    expect(t.messages.parentCalls.filter((c) => c.idempotencyKey === key)).toHaveLength(2);
    expect(sent().filter((c) => c.idempotencyKey === key)).toHaveLength(1);
  });
});

describe('what people see', () => {
  it('the task shows each copy’s message, and the log shows counts only', async () => {
    // A fresh day, so no parent has reached their daily limit.
    t.clock.now = at('10:00', addDays(MONDAY, 7));
    const { taskId, copyId } = await priyaTask('Visible check');
    await (await as('u8')).post(`/assignments/${copyId}/submit`).expect(200);
    await deliver();
    const detail = await (await as('u5')).get(`/tasks/${taskId}`).expect(200);
    expect((detail.body.people as Body[])[0]?.parentMessage).toMatchObject({
      status: 'sent',
      sentCount: 3,
      className: 'Nursery A',
    });
    const log = await (await as('u5')).get('/parent-messages').expect(200);
    const item = (log.body.items as Body[]).find((i) => i.taskTitle === 'Visible check');
    expect(item).toMatchObject({
      personName: 'Priya Sharma',
      schoolName: 'Jubilee Hills',
      className: 'Nursery A',
      templateName: 'Class activity done',
    });
    const text = JSON.stringify(log.body);
    expect(text).not.toMatch(/99999|Aarav|Neha/);
    // Another school's principal sees none of it; a teacher can't open the log.
    const kavita = await (await as('u6')).get('/parent-messages').expect(200);
    expect(JSON.stringify(kavita.body)).not.toContain('Visible check');
    await (await as('u8')).get('/parent-messages').expect(403);
  });

  it('never writes a parent’s number to the logs', async () => {
    const lines: unknown[] = [];
    const logger = { info: (o: unknown) => lines.push(o) } as unknown as ConstructorParameters<
      typeof ConsoleMessageProvider
    >[0];
    await new ConsoleMessageProvider(logger).sendParentMessage({
      to: '+919999900001',
      text: 'Hello',
      idempotencyKey: 'k',
    });
    expect(JSON.stringify(lines)).not.toContain('9999900001');
    expect(JSON.stringify(lines)).toContain('••001');
  });
});

describe('the organisation’s daily cap (answer 3)', () => {
  it('stops at the organisation’s daily cap, and says why', async () => {
    await t.close();
    sessions.clear();
    t = await createTestApp({ PARENT_DAILY_CAP_PER_ORG: '2' }, { now: at('10:00') });
    worker = new ParentMessageWorker(t.deps);
    const { copyId } = await priyaTask('Cap check');
    await (await as('u8')).post(`/assignments/${copyId}/submit`).expect(200);
    await deliver();
    expect(await messageOf(copyId)).toMatchObject({
      status: 'partly_sent',
      sentCount: 2,
      skippedCount: 1,
    });
    expect(await t.prisma.parentMessageRecipient.count({ where: { lastError: 'daily cap' } })).toBe(
      1,
    );
  });
});
