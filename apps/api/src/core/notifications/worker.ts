import { hostname } from 'node:os';
import {
  addDays,
  createAccess,
  FINISHED_STATUSES,
  localDate,
  mutedByDefault,
  SMS_EVENTS,
  zonedInstant,
} from '@kidzonia/shared';
import type { Channel } from '@kidzonia/shared';
import type { $Enums, Prisma, ScopedDb, ScopedTx } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import { loadOrgRegistry, loadRoleGrants } from '../permission-context.js';
import { namesHiddenFor, taskText } from './render.js';

/**
 * Delivers the notification outbox (brief 10.1, Phase 5 c, answer 3), every
 * minute. Safe to run twice: one delivery row per event and channel, one
 * in-app notification per event. Failures retry with backoff; every result is
 * logged. SMS/WhatsApp:
 *  - only assigned, sent back and due soon, per each person's muting (due
 *    soon is off by default except for tasks that block logout);
 *  - never to deactivated people, always to their current mobile;
 *  - quiet hours 21:00-07:00 in the organisation's time zone: held until the
 *    morning, dropped then if no longer relevant (done, closed, cancelled,
 *    or a deadline that has passed);
 *  - a daily cap per organisation, logged when hit.
 *
 * A batch is decided in memory from a handful of queries and written in bulk,
 * so a 1,000-person assignment delivers in one run. SMS/WhatsApp sends are
 * claimed first and marked in small chunks, so a crash re-sends at most one
 * chunk; every attempt carries the same idempotency key (`<outboxId>:sms`),
 * which the provider passes to the vendor so a re-sent message is dropped
 * there instead of reaching the person twice.
 */

export const DELIVERY_JOB = 'notification-delivery';
const BATCH = 500;
const MAX_ATTEMPTS = 5;
const BACKOFF_MIN = [1, 5, 15, 60, 240];
const QUIET_FROM = 21;
const QUIET_TO = 7;
/** One run keeps taking batches for up to this long, then leaves the rest for the next minute. */
const RUN_BUDGET_MS = 40_000;
/** SMS/WhatsApp sends go out this many at a time. */
const SEND_CHUNK = 25;
/** A claimed send that never finished (the run died) is retried after this long. */
const CLAIM_MIN = 5;

export interface DeliveryCounts {
  inApp: number;
  sms: number;
  held: number;
  skipped: number;
  failed: number;
  retried: number;
}

type Status = $Enums.DeliveryStatus;
const FINAL: readonly Status[] = ['sent', 'skipped', 'failed'];
const isSmsEvent = (event: string) => (SMS_EVENTS as readonly string[]).includes(event);

interface DeliveryData {
  status: Status;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
}

/** A delivery row's fields: held and pending wait until `at`; sent is stamped `at`. */
function delivery(status: Status, attempts: number, at: Date, error?: string): DeliveryData {
  return {
    status,
    attempts,
    lastError: error ?? null,
    nextAttemptAt: status === 'held' || status === 'pending' ? at : null,
    sentAt: status === 'sent' ? at : null,
  };
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
const payloadOf = (p: unknown) =>
  p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};

interface OutboxEvent {
  id: string;
  event: string;
  recipientUserId: string;
  entityType: string;
  entityId: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
  deliveries: {
    id: string;
    channel: Channel;
    status: Status;
    attempts: number;
    nextAttemptAt: Date | null;
  }[];
}

interface Send {
  event: OutboxEvent;
  row: { id: string; attempts: number } | null;
  mobile: string;
  roleId: string;
}

export class NotificationWorker {
  constructor(private readonly deps: AppDeps) {}

  async run(now: Date): Promise<DeliveryCounts | null> {
    const { data, logger } = this.deps;
    const lease = await data.jobs.start(DELIVERY_JOB, now, hostname());
    if (!lease) return null;
    const totals: DeliveryCounts = { inApp: 0, sms: 0, held: 0, skipped: 0, failed: 0, retried: 0 };
    try {
      for (const org of await data.jobs.organisationIds()) {
        const c = await this.runOrganisation(org, now);
        for (const k of Object.keys(totals) as (keyof DeliveryCounts)[]) totals[k] += c[k];
      }
      await data.jobs.finish(lease.id, this.deps.now(), { ok: true, counts: { ...totals } });
      if (Object.values(totals).some((n) => n > 0)) {
        logger.info({ job: DELIVERY_JOB, counts: totals }, 'Notifications delivered');
      }
      return totals;
    } catch (err) {
      await data.jobs.finish(lease.id, this.deps.now(), {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      logger.error({ job: DELIVERY_JOB, err }, 'Notification delivery failed');
      throw err;
    }
  }

  async runOrganisation(organisationId: string, now: Date): Promise<DeliveryCounts> {
    const db = this.deps.data.forOrganisation(organisationId);
    const counts: DeliveryCounts = { inApp: 0, sms: 0, held: 0, skipped: 0, failed: 0, retried: 0 };
    const started = Date.now();
    // Walk forward through the outbox, so events still waiting (held, retrying) aren't read twice.
    let after: { createdAt: Date; id: string } | undefined;
    for (;;) {
      const events: OutboxEvent[] = await db.notificationOutbox.findMany({
        where: {
          deliveredAt: null,
          createdAt: { lte: now },
          ...(after
            ? {
                OR: [
                  { createdAt: { gt: after.createdAt } },
                  { createdAt: after.createdAt, id: { gt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: BATCH,
        select: {
          id: true,
          event: true,
          recipientUserId: true,
          entityType: true,
          entityId: true,
          payload: true,
          createdAt: true,
          deliveries: {
            select: { id: true, channel: true, status: true, attempts: true, nextAttemptAt: true },
          },
        },
      });
      if (events.length === 0) break;
      await this.deliverBatch(db, organisationId, events, now, counts);
      after = events.at(-1);
      if (events.length < BATCH || Date.now() - started > RUN_BUDGET_MS) break;
    }
    return counts;
  }

  private async deliverBatch(
    db: ScopedTx,
    organisationId: string,
    events: OutboxEvent[],
    now: Date,
    counts: DeliveryCounts,
  ): Promise<void> {
    if (events.length === 0) return;
    // Everything the decisions need, in a handful of queries for the whole batch.
    const org = await db.organisation.findFirstOrThrow({ select: { timezone: true } });
    const recipientIds = unique(events.map((e) => e.recipientUserId));
    const copyIds = events
      .map((e) => payloadOf(e.payload).copyId)
      .filter((x): x is string => typeof x === 'string');
    const taskEvents = events.filter((e) => e.entityType === 'task');
    const copySelect = {
      id: true,
      taskId: true,
      userId: true,
      status: true,
      dueAt: true,
      blocksLogout: true,
    };
    const [people, prefs, copies, latestCopies] = await Promise.all([
      db.user.findMany({
        where: { id: { in: recipientIds } },
        select: {
          id: true,
          mobile: true,
          status: true,
          deletedAt: true,
          roleAssignment: { select: { roleId: true } },
        },
      }),
      db.notificationPreference.findMany({ where: { userId: { in: recipientIds } } }),
      copyIds.length
        ? db.taskAssignment.findMany({ where: { id: { in: copyIds } }, select: copySelect })
        : Promise.resolve([]),
      // Events without a copy id (e.g. "assigned") are about the person's latest copy of the task.
      taskEvents.length
        ? db.taskAssignment.findMany({
            where: {
              taskId: { in: unique(taskEvents.map((e) => e.entityId)) },
              userId: { in: unique(taskEvents.map((e) => e.recipientUserId)) },
            },
            orderBy: { serviceDate: 'desc' },
            select: copySelect,
          })
        : Promise.resolve([]),
    ]);
    const personById = new Map(people.map((p) => [p.id, p]));
    const prefByKey = new Map(prefs.map((p) => [`${p.userId}:${p.event}:${p.channel}`, p.muted]));
    const copyById = new Map(copies.map((c) => [c.id, c]));
    const latestCopy = new Map<string, (typeof latestCopies)[number]>();
    for (const c of latestCopies) {
      const k = `${c.taskId}:${c.userId}`;
      if (!latestCopy.has(k)) latestCopy.set(k, c);
    }
    const muted = (userId: string, event: string, channel: Channel, blocks: boolean) =>
      prefByKey.get(`${userId}:${event}:${channel}`) ?? mutedByDefault(event, channel, blocks);

    const local = localDate(now, org.timezone);
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        hourCycle: 'h23',
        timeZone: org.timezone,
      }).format(now),
    );
    const quiet = hour >= QUIET_FROM || hour < QUIET_TO;
    const morning = zonedInstant(
      hour >= QUIET_FROM ? addDays(local, 1) : local,
      '07:00',
      org.timezone,
    );
    const cap = this.deps.config.SMS_DAILY_CAP_PER_ORG;
    let sentToday = await db.notificationDelivery.count({
      where: {
        channel: 'sms',
        status: 'sent',
        sentAt: { gte: zonedInstant(local, '00:00', org.timezone) },
      },
    });
    let capLogged = false;

    // Decide every channel of every event in memory first.
    const notifications: Prisma.NotificationCreateManyInput[] = [];
    const newRows: Prisma.NotificationDeliveryCreateManyInput[] = [];
    const updates: { id: string; data: DeliveryData }[] = [];
    const toSend: Send[] = [];
    const finals = new Map<string, number>();
    const finished = (outboxId: string) => finals.set(outboxId, (finals.get(outboxId) ?? 0) + 1);
    const put = (
      e: OutboxEvent,
      channel: Channel,
      existingId: string | null,
      data: DeliveryData,
    ) => {
      if (existingId) updates.push({ id: existingId, data });
      else newRows.push({ organisationId, outboxId: e.id, channel, ...data });
      if (FINAL.includes(data.status)) finished(e.id);
    };

    for (const e of events) {
      const person = personById.get(e.recipientUserId);
      const role =
        person && !person.deletedAt && person.status !== 'inactive' ? person.roleAssignment : null;
      const p = payloadOf(e.payload);
      const copy =
        (typeof p.copyId === 'string' ? copyById.get(p.copyId) : undefined) ??
        (e.entityType === 'task'
          ? latestCopy.get(`${e.entityId}:${e.recipientUserId}`)
          : undefined);
      const blocks = copy?.blocksLogout ?? false;
      const existing = (ch: Channel) => e.deliveries.find((d) => d.channel === ch);
      e.deliveries.filter((d) => FINAL.includes(d.status)).forEach(() => finished(e.id));

      // In-app.
      if (!existing('in_app')) {
        if (!role || muted(e.recipientUserId, e.event, 'in_app', blocks)) {
          put(
            e,
            'in_app',
            null,
            delivery('skipped', 0, now, role ? 'muted' : 'recipient inactive'),
          );
          counts.skipped++;
        } else {
          notifications.push({
            organisationId,
            recipientUserId: e.recipientUserId,
            outboxId: e.id,
            event: e.event,
            entityType: e.entityType,
            entityId: e.entityId,
            payload: e.payload ?? {},
            groupKey: `${e.event}:${e.entityId}:${localDate(e.createdAt, org.timezone)}`,
            createdAt: e.createdAt,
          });
          put(e, 'in_app', null, delivery('sent', 1, now));
          counts.inApp++;
        }
      }

      // SMS / WhatsApp.
      if (!isSmsEvent(e.event)) continue;
      const sms = existing('sms');
      if (sms && FINAL.includes(sms.status)) continue;
      if (sms?.nextAttemptAt && sms.nextAttemptAt > now) continue;
      const attempts = sms?.attempts ?? 0;
      const skip = (reason: string) => {
        put(e, 'sms', sms?.id ?? null, delivery('skipped', attempts, now, reason));
        counts.skipped++;
      };
      const stale =
        copy !== undefined &&
        ((FINISHED_STATUSES as readonly string[]).includes(copy.status) ||
          ['expired', 'cancelled', 'submitted'].includes(copy.status) ||
          (e.event === 'task_due_soon' && copy.dueAt <= now));
      // Watchers hear about other people's approvals and send-backs in the app only.
      const watching = typeof p.personId === 'string' && p.personId !== e.recipientUserId;
      if (!person || !role) skip('recipient inactive');
      else if (watching) skip('watching: in the app only');
      else if (muted(e.recipientUserId, e.event, 'sms', blocks)) skip('muted');
      else if (stale) skip('no longer relevant');
      else if (quiet) {
        put(e, 'sms', sms?.id ?? null, delivery('held', attempts, morning));
        counts.held++;
      } else if (sentToday >= cap) {
        if (!capLogged) {
          this.deps.logger.warn(
            { organisationId, cap },
            'Daily SMS/WhatsApp cap reached; further messages skipped today',
          );
          capLogged = true;
        }
        skip('daily cap');
      } else {
        sentToday++;
        toSend.push({
          event: e,
          row: sms ? { id: sms.id, attempts } : null,
          mobile: person.mobile,
          roleId: role.roleId,
        });
      }
    }

    // The in-app side and every decision that isn't a send, in bulk; unique keys make repeats safe.
    if (notifications.length) {
      await db.notification.createMany({ data: notifications, skipDuplicates: true });
    }
    if (newRows.length)
      await db.notificationDelivery.createMany({ data: newRows, skipDuplicates: true });
    for (const u of updates) {
      await db.notificationDelivery.update({
        where: { id: u.id },
        data: u.data,
        select: { id: true },
      });
    }

    // Sends. Claim them all first (pending, due again in a few minutes if this run dies),
    // then send in small parallel chunks, marking each chunk as soon as it's out: a crash
    // can re-send at most one chunk.
    const texts = await this.smsTexts(db, toSend);
    const claimUntil = new Date(now.getTime() + CLAIM_MIN * 60_000);
    const fresh = toSend.filter((s) => !s.row);
    if (fresh.length) {
      await db.notificationDelivery.createMany({
        data: fresh.map((s) => ({
          organisationId,
          outboxId: s.event.id,
          channel: 'sms' as const,
          ...delivery('pending', 0, claimUntil),
        })),
        skipDuplicates: true,
      });
    }
    const retrying = toSend.filter((s) => s.row).map((s) => s.row?.id ?? '');
    if (retrying.length) {
      await db.notificationDelivery.updateMany({
        where: { id: { in: retrying } },
        data: { status: 'pending', nextAttemptAt: claimUntil },
      });
    }
    const where = (s: Send) => ({ outboxId: s.event.id, channel: 'sms' as const });
    for (let i = 0; i < toSend.length; i += SEND_CHUNK) {
      const chunk = toSend.slice(i, i + SEND_CHUNK);
      const results = await Promise.allSettled(
        chunk.map(async (s) => {
          const text = texts.get(s.event.id);
          if (!text) return false;
          // Always the person's current mobile, read now (answer 3).
          await this.deps.messages.sendNotification({
            to: s.mobile,
            text: `Kidzonia 360: ${text}`,
            // The same key on every attempt, so a re-sent group isn't texted twice.
            idempotencyKey: `${s.event.id}:sms`,
          });
          return true;
        }),
      );
      const sent = new Map<number, string[]>();
      for (const [j, r] of results.entries()) {
        const s = chunk[j];
        if (!s) continue;
        const attempts = s.row?.attempts ?? 0;
        if (r.status === 'fulfilled' && r.value) {
          sent.set(attempts + 1, [...(sent.get(attempts + 1) ?? []), s.event.id]);
          finished(s.event.id);
          counts.sms++;
        } else if (r.status === 'fulfilled') {
          await db.notificationDelivery.updateMany({
            where: where(s),
            data: delivery('skipped', attempts, now, 'no longer relevant'),
          });
          finished(s.event.id);
          counts.skipped++;
        } else {
          const tries = attempts + 1;
          const failed = tries >= MAX_ATTEMPTS;
          const next = new Date(now.getTime() + (BACKOFF_MIN[tries - 1] ?? 240) * 60_000);
          const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
          await db.notificationDelivery.updateMany({
            where: where(s),
            data: delivery(failed ? 'failed' : 'pending', tries, next, message),
          });
          this.deps.logger.warn(
            { outboxId: s.event.id, attempts: tries, failed },
            'SMS/WhatsApp notification failed',
          );
          if (failed) {
            finished(s.event.id);
            counts.failed++;
          } else counts.retried++;
        }
      }
      for (const [attempts, ids] of sent) {
        await db.notificationDelivery.updateMany({
          where: { outboxId: { in: ids }, channel: 'sms' },
          data: delivery('sent', attempts, now),
        });
      }
    }

    // Done when every channel has finished (sent, skipped or failed).
    const done = events
      .filter((e) => (finals.get(e.id) ?? 0) >= (isSmsEvent(e.event) ? 2 : 1))
      .map((e) => e.id);
    if (done.length) {
      await db.notificationOutbox.updateMany({
        where: { id: { in: done } },
        data: { deliveredAt: now },
      });
    }
  }

  /**
   * SMS/WhatsApp text for many events at once. These events are always about
   * the recipient's own copy, so they can see the task; only their role's
   * field permissions (the task title, people's names) change the wording.
   * A cancelled or deleted task gets no text, and so no message.
   */
  private async smsTexts(db: ScopedTx, sends: readonly Send[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (sends.length === 0) return out;
    const taskIds = unique(
      sends.filter((s) => s.event.entityType === 'task').map((s) => s.event.entityId),
    );
    const byIds = unique(
      sends
        .map((s) => payloadOf(s.event.payload).by)
        .filter((x): x is string => typeof x === 'string'),
    );
    const [tasks, actors, registry, roles] = await Promise.all([
      db.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, title: true, cancelledAt: true },
      }),
      byIds.length
        ? db.user.findMany({ where: { id: { in: byIds } }, select: { id: true, fullName: true } })
        : Promise.resolve([]),
      loadOrgRegistry(db),
      Promise.all(
        unique(sends.map((s) => s.roleId)).map(
          async (id) => [id, await loadRoleGrants(db, id)] as const,
        ),
      ),
    ]);
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const actorById = new Map(actors.map((a) => [a.id, a.fullName]));
    const roleById = new Map(roles);
    for (const { event: e, roleId } of sends) {
      const task = taskById.get(e.entityId);
      if (e.entityType !== 'task' || !task || task.cancelledAt) continue;
      // Field access only depends on the role and whose record it is.
      const access = createAccess({
        registry,
        userId: e.recipientUserId,
        role: roleById.get(roleId) ?? null,
        scope: { allSchools: false, schoolIds: [] },
        teamUserIds: new Set(),
        managerSwitches: {},
      });
      const own = { subjectUserIds: [e.recipientUserId], schoolIds: [] };
      const title = access.fieldAccess('tasks', 'title', own) !== 'hidden' ? task.title : 'a task';
      const byId = payloadOf(e.payload).by;
      const by =
        typeof byId === 'string'
          ? namesHiddenFor(access)
            ? 'Someone'
            : (actorById.get(byId) ?? 'Someone')
          : null;
      out.set(e.id, taskText(e.event, title, by));
    }
    return out;
  }

  /** Daily: notifications (and delivered events) older than NOTIFICATIONS_KEEP_DAYS go. */
  async cleanUp(now: Date): Promise<Record<string, number>> {
    const before = new Date(now.getTime() - this.deps.config.NOTIFICATIONS_KEEP_DAYS * 86_400_000);
    let notifications = 0;
    let outbox = 0;
    for (const org of await this.deps.data.jobs.organisationIds()) {
      const db: ScopedDb = this.deps.data.forOrganisation(org);
      notifications += (await db.notification.deleteMany({ where: { createdAt: { lt: before } } }))
        .count;
      outbox += (
        await db.notificationOutbox.deleteMany({
          where: { createdAt: { lt: before }, deliveredAt: { not: null } },
        })
      ).count;
    }
    return { notifications, outbox };
  }
}
