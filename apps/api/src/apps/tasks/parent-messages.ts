import { hostname } from 'node:os';
import {
  addDays,
  fieldView,
  localDate,
  parentMessageLogQuerySchema,
  peopleNames,
  renderParentMessage,
  TASK_MODULES,
  zonedInstant,
} from '@kidzonia/shared';
import type { $Enums, Prisma, ScopedTx } from '../../db/index.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { requireModule } from '../../core/guards.js';
import { authOf } from '../../core/users/routes.js';
import type { AppDeps } from '../../deps.js';
import { CoreParentContacts } from '../../core/parent-contacts/source.js';
import type { ParentContactSource } from '../../core/parent-contacts/source.js';
import { parentMessageSchema } from './records.js';

/**
 * Messages to parents (brief 9.12, Phase 6 answers 1-3).
 *
 * When one person's copy of a task with "Message parents" is approved, or
 * marked done without approval, a `parent_messages` row is queued in the same
 * transaction: one per copy, so work sent back and approved again messages
 * parents once. This worker (every minute) then:
 *  1. finds the class's parents who agreed (through the contact source);
 *  2. sends one message per parent per child, with the rules below;
 *  3. closes the message with its counts.
 *
 * Rules: never 21:00-07:00 in the organisation's time zone (held until the
 * morning); at most PARENT_DAILY_LIMIT_PER_PARENT messages a parent a day and
 * PARENT_DAILY_CAP_PER_ORG a day per organisation (skipped, logged); the
 * number is read at the moment of sending and only while the parent still
 * agrees (an opt-out after queueing stops the message). Each send carries an
 * idempotency key the same on every attempt. Numbers are never logged.
 */

export const PARENT_MESSAGE_JOB = 'parent-messages';
const PARENT_MESSAGES = TASK_MODULES.parentMessages;
const QUIET_FROM = 21;
const QUIET_TO = 7;
const MAX_ATTEMPTS = 5;
const BACKOFF_MIN = [1, 5, 15, 60, 240];
const BATCH = 500;

type Status = $Enums.DeliveryStatus;
const FINAL: readonly Status[] = ['sent', 'skipped', 'failed'];

/** Queues the parent message for a copy that has just been approved or completed. */
export async function queueParentMessage(tx: ScopedTx, copyId: string) {
  const copy = await tx.taskAssignment.findFirst({
    where: { id: copyId },
    select: {
      id: true,
      organisationId: true,
      schoolId: true,
      task: { select: { id: true, title: true, kind: true, parentMessage: true } },
    },
  });
  if (!copy || copy.task.kind !== 'task') return;
  const pm = parentMessageSchema.parse(copy.task.parentMessage);
  if (!pm) return;
  await tx.parentMessage.createMany({
    data: [
      {
        organisationId: copy.organisationId,
        taskId: copy.task.id,
        assignmentId: copy.id,
        templateId: pm.templateId,
        schoolId: copy.schoolId,
        className: pm.className,
        // Blank means the task's title (Phase 6 answer 2).
        eventName: pm.eventName?.trim() || copy.task.title,
        activity: pm.activity?.trim() || copy.task.title,
      },
    ],
    skipDuplicates: true,
  });
}

export interface ParentMessageCounts {
  queued: number;
  sent: number;
  held: number;
  skipped: number;
  failed: number;
  retried: number;
}

export class ParentMessageWorker {
  private readonly source: ParentContactSource;

  constructor(
    private readonly deps: AppDeps,
    source?: ParentContactSource,
  ) {
    this.source = source ?? new CoreParentContacts();
  }

  async run(now: Date): Promise<ParentMessageCounts | null> {
    const { data, logger } = this.deps;
    const lease = await data.jobs.start(PARENT_MESSAGE_JOB, now, hostname());
    if (!lease) return null;
    const totals: ParentMessageCounts = {
      queued: 0,
      sent: 0,
      held: 0,
      skipped: 0,
      failed: 0,
      retried: 0,
    };
    try {
      for (const org of await data.jobs.organisationIds()) {
        const c = await this.runOrganisation(org, now);
        for (const k of Object.keys(totals) as (keyof ParentMessageCounts)[]) totals[k] += c[k];
      }
      await data.jobs.finish(lease.id, this.deps.now(), { ok: true, counts: { ...totals } });
      if (Object.values(totals).some((n) => n > 0)) {
        logger.info({ job: PARENT_MESSAGE_JOB, counts: totals }, 'Parent messages processed');
      }
      return totals;
    } catch (err) {
      await data.jobs.finish(lease.id, this.deps.now(), {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      logger.error({ job: PARENT_MESSAGE_JOB, err }, 'Parent messages failed');
      throw err;
    }
  }

  async runOrganisation(organisationId: string, now: Date): Promise<ParentMessageCounts> {
    const db = this.deps.data.forOrganisation(organisationId);
    const counts: ParentMessageCounts = {
      queued: 0,
      sent: 0,
      held: 0,
      skipped: 0,
      failed: 0,
      retried: 0,
    };
    await this.expand(db, organisationId, counts);
    await this.deliver(db, organisationId, now, counts);
    await this.finish(db, now);
    return counts;
  }

  /** Step 1: queued messages get their recipients, or are skipped with a reason. */
  private async expand(db: ScopedTx, organisationId: string, counts: ParentMessageCounts) {
    const queued = await db.parentMessage.findMany({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true, schoolId: true, className: true, templateId: true },
    });
    for (const m of queued) {
      const skip = (reason: string) =>
        db.parentMessage.update({
          where: { id: m.id },
          data: { status: 'skipped', skipReason: reason, finishedAt: this.deps.now() },
          select: { id: true },
        });
      if (!m.schoolId) {
        await skip('Head office work has no class to message.');
        counts.skipped++;
        continue;
      }
      const template = m.templateId
        ? await db.parentMessageTemplate.findFirst({
            where: { id: m.templateId, archivedAt: null },
            select: { id: true },
          })
        : null;
      if (!template) {
        await skip('The message template was removed.');
        counts.skipped++;
        continue;
      }
      const recipients = await this.source.recipients(db, m.schoolId, m.className);
      if (recipients.length === 0) {
        await skip(`No parent in ${m.className} has agreed to messages.`);
        counts.skipped++;
        continue;
      }
      await db.parentMessageRecipient.createMany({
        data: recipients.map((r) => ({
          organisationId,
          parentMessageId: m.id,
          guardianId: r.guardianId,
          studentId: r.studentId,
        })),
        skipDuplicates: true,
      });
      await db.parentMessage.update({
        where: { id: m.id },
        data: { status: 'sending', recipientsCount: recipients.length },
        select: { id: true },
      });
      counts.queued++;
    }
  }

  /** Step 2: one message per parent per child, within the limits. */
  private async deliver(
    db: ScopedTx,
    organisationId: string,
    now: Date,
    counts: ParentMessageCounts,
  ) {
    const due = await db.parentMessageRecipient.findMany({
      where: {
        status: { in: ['pending', 'held'] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        message: { status: 'sending' },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: {
        id: true,
        guardianId: true,
        attempts: true,
        student: { select: { fullName: true } },
        message: {
          select: {
            id: true,
            className: true,
            eventName: true,
            activity: true,
            templateId: true,
            school: { select: { name: true } },
          },
        },
      },
    });
    if (due.length === 0) return;

    const org = await db.organisation.findFirstOrThrow({ select: { timezone: true } });
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
    const startOfDay = zonedInstant(local, '00:00', org.timezone);
    const cap = this.deps.config.PARENT_DAILY_CAP_PER_ORG;
    const perParent = this.deps.config.PARENT_DAILY_LIMIT_PER_PARENT;
    let sentToday = await db.parentMessageRecipient.count({
      where: { status: 'sent', sentAt: { gte: startOfDay } },
    });
    const byParent = new Map(
      (
        await db.parentMessageRecipient.groupBy({
          by: ['guardianId'],
          where: {
            status: 'sent',
            sentAt: { gte: startOfDay },
            guardianId: { in: [...new Set(due.map((d) => d.guardianId))] },
          },
          _count: { _all: true },
        })
      ).map((g) => [g.guardianId, g._count._all]),
    );
    const templates = new Map(
      (
        await db.parentMessageTemplate.findMany({
          where: { id: { in: [...new Set(due.map((d) => d.message.templateId ?? ''))] } },
          select: { id: true, body: true },
        })
      ).map((t) => [t.id, t.body]),
    );
    let capLogged = false;
    const set = (id: string, status: Status, data: Record<string, unknown> = {}) =>
      db.parentMessageRecipient.update({
        where: { id },
        data: { status, ...data },
        select: { id: true },
      });

    for (const r of due) {
      if (quiet) {
        await set(r.id, 'held', { nextAttemptAt: morning });
        counts.held++;
        continue;
      }
      if (sentToday >= cap) {
        if (!capLogged) {
          this.deps.logger.warn(
            { organisationId, cap },
            'Daily parent message cap reached; the rest are skipped today',
          );
          capLogged = true;
        }
        await set(r.id, 'skipped', { lastError: 'daily cap', nextAttemptAt: null });
        counts.skipped++;
        continue;
      }
      if ((byParent.get(r.guardianId) ?? 0) >= perParent) {
        await set(r.id, 'skipped', { lastError: 'parent daily limit', nextAttemptAt: null });
        counts.skipped++;
        continue;
      }
      const mobile = await this.source.sendableMobile(db, r.guardianId);
      const body = templates.get(r.message.templateId ?? '');
      if (!mobile || !body) {
        await set(r.id, 'skipped', {
          lastError: mobile ? 'template removed' : 'no longer agreed',
          nextAttemptAt: null,
        });
        counts.skipped++;
        continue;
      }
      const text = renderParentMessage(body, {
        student_name: r.student.fullName,
        class_name: r.message.className,
        event_name: r.message.eventName,
        activity: r.message.activity,
        school_name: r.message.school?.name ?? '',
      });
      try {
        await this.deps.messages.sendParentMessage({
          to: mobile,
          text,
          idempotencyKey: `${r.message.id}:${r.id}`,
        });
        await set(r.id, 'sent', {
          attempts: r.attempts + 1,
          sentAt: now,
          nextAttemptAt: null,
          lastError: null,
        });
        sentToday++;
        byParent.set(r.guardianId, (byParent.get(r.guardianId) ?? 0) + 1);
        counts.sent++;
      } catch (err) {
        const tries = r.attempts + 1;
        const failed = tries >= MAX_ATTEMPTS;
        await set(r.id, failed ? 'failed' : 'pending', {
          attempts: tries,
          nextAttemptAt: failed
            ? null
            : new Date(now.getTime() + (BACKOFF_MIN[tries - 1] ?? 240) * 60_000),
          lastError: err instanceof Error ? err.message.slice(0, 200) : 'send failed',
        });
        // The recipient's id only: never the number.
        this.deps.logger.warn(
          { recipientId: r.id, attempts: tries, failed },
          'Parent message failed',
        );
        if (failed) counts.failed++;
        else counts.retried++;
      }
    }
  }

  /** Step 3: a message whose every recipient is final gets its counts and status. */
  private async finish(db: ScopedTx, now: Date) {
    const open = await db.parentMessage.findMany({
      where: { status: 'sending' },
      select: { id: true },
      take: 500,
    });
    if (open.length === 0) return;
    const grouped = await db.parentMessageRecipient.groupBy({
      by: ['parentMessageId', 'status'],
      where: { parentMessageId: { in: open.map((m) => m.id) } },
      _count: { _all: true },
    });
    for (const m of open) {
      const rows = grouped.filter((g) => g.parentMessageId === m.id);
      const n = (s: Status) => rows.find((g) => g.status === s)?._count._all ?? 0;
      const total = rows.reduce((a, g) => a + g._count._all, 0);
      const final = FINAL.reduce((a, s) => a + n(s), 0);
      if (total > 0 && final < total) continue;
      const sent = n('sent');
      const failed = n('failed');
      const skipped = n('skipped');
      const status: $Enums.ParentMessageStatus =
        total === 0
          ? 'skipped'
          : sent === total
            ? 'sent'
            : sent > 0
              ? 'partly_sent'
              : failed > 0
                ? 'failed'
                : 'skipped';
      await db.parentMessage.update({
        where: { id: m.id },
        data: {
          status,
          sentCount: sent,
          failedCount: failed,
          skippedCount: skipped,
          finishedAt: now,
          ...(status === 'skipped' ? { skipReason: 'No parent could be messaged today.' } : {}),
        },
        select: { id: true },
      });
    }
  }
}

/**
 * The parent message log (Phase 6 answer 4: its own `parent_messages` module).
 * Counts only: never a parent's number or a child's name. Limited to the
 * person's school scope; head-office work (no school) only with all schools.
 */
export function parentMessageRoutes(): RouteDef[] {
  return [
    {
      method: 'get',
      path: '/parent-messages',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        const access = await auth.access();
        requireModule(access, PARENT_MESSAGES, 'view');
        const q = parse(parentMessageLogQuerySchema, req.query);
        const and: Prisma.ParentMessageWhereInput[] = access.contexts.map((c) =>
          c.role?.isOwner || c.scope.allSchools ? {} : { schoolId: { in: [...c.scope.schoolIds] } },
        );
        if (q.schoolId) and.push({ schoolId: q.schoolId });
        if (q.status) and.push({ status: q.status });
        if (q.className) and.push({ className: { equals: q.className, mode: 'insensitive' } });
        const org = await auth.db.organisation.findFirstOrThrow({ select: { timezone: true } });
        if (q.from) and.push({ createdAt: { gte: zonedInstant(q.from, '00:00', org.timezone) } });
        if (q.to) {
          and.push({ createdAt: { lt: zonedInstant(addDays(q.to, 1), '00:00', org.timezone) } });
        }
        if (q.cursor) and.push({ id: { lt: q.cursor } });
        const rows = await auth.db.parentMessage.findMany({
          where: { AND: and },
          orderBy: { id: 'desc' },
          take: q.limit + 1,
          select: {
            id: true,
            taskId: true,
            className: true,
            templateId: true,
            status: true,
            skipReason: true,
            recipientsCount: true,
            sentCount: true,
            failedCount: true,
            skippedCount: true,
            createdAt: true,
            finishedAt: true,
            task: { select: { title: true } },
            school: { select: { id: true, name: true } },
            assignment: { select: { userId: true, user: { select: { fullName: true } } } },
          },
        });
        const page = rows.slice(0, q.limit);
        const templates = await auth.db.parentMessageTemplate.findMany({
          where: { id: { in: page.map((r) => r.templateId ?? '').filter(Boolean) } },
          select: { id: true, name: true },
        });
        const names = peopleNames(access);
        res.json({
          items: page.map((r) => {
            const tasks = fieldView(access, 'tasks', {
              subjectUserIds: [r.assignment.userId],
              schoolIds: r.school ? [r.school.id] : [],
            });
            return {
              id: r.id,
              taskId: r.taskId,
              taskTitle: tasks.show('title', r.task.title, 'A task'),
              personName: names.show(r.assignment.user.fullName),
              schoolName: r.school?.name ?? null,
              className: r.className,
              templateName: templates.find((t) => t.id === r.templateId)?.name ?? null,
              status: r.status,
              skipReason: r.skipReason,
              recipientsCount: r.recipientsCount,
              sentCount: r.sentCount,
              failedCount: r.failedCount,
              skippedCount: r.skippedCount,
              createdAt: r.createdAt.toISOString(),
              finishedAt: r.finishedAt?.toISOString() ?? null,
            };
          }),
          nextCursor: rows.length > q.limit ? (page.at(-1)?.id ?? null) : null,
        });
      },
    },
  ];
}
