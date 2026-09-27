import { hostname } from 'node:os';
import {
  addDays,
  createAccess,
  dueAtFor,
  closesAtFor,
  includesNewJoiners,
  OPEN_STATUSES,
  planDates,
} from '@kidzonia/shared';
import { questionSchema } from '@kidzonia/shared';
import type { DueRule, IsoDate, PlannedCopy } from '@kidzonia/shared';
import { z } from 'zod';
import { DbNull, mapDbError, withUnitOfWork } from '../../db/index.js';
import type { Prisma, ScopedTx, UnitOfWork } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import { emit } from '../../core/outbox.js';
import type { OutboxEvent } from '../../core/outbox.js';
import { loadPermissions } from '../../core/permission-context.js';
import { userFacts } from '../../core/users/facts.js';
import { fromIsoDate, loadCalendars, toIsoDate } from './calendars.js';
import type { Calendars } from './calendars.js';
import {
  approverCandidate,
  canWork,
  loadPeople,
  resolveApprover,
  resolveTarget,
} from './people.js';
import type { People, Person } from './people.js';
import { parseSnapshot, parseTarget } from './records.js';
import type { Snapshot } from './records.js';

/**
 * The task schedule (brief 9.5, Phase 4). Every 15 minutes and at start-up,
 * for each organisation:
 *
 *  1. makes copies of repeating tasks and day-end forms from today to 6 days
 *     ahead (never for past dates, even after downtime);
 *  2. brings untouched copies in line with what changed since: holidays,
 *     working days and hours, school moves, role and status changes, form
 *     versions, people joining or leaving a group;
 *  3. marks copies overdue at the deadline and closed at closing time;
 *  4. writes reminder events to the outbox.
 *
 * Safe to run twice: inserts skip existing (task, person, date) rows, and every
 * change to an existing copy is conditional on it still being untouched, so
 * a copy someone starts a moment before the job reaches it is left alone
 * (Phase 4 addition b).
 */

export const SCHEDULE_JOB = 'task-schedule';
export const WINDOW_DAYS = 7;
/** A run this much later than the last success counts as downtime. */
const GAP_MS = 40 * 60 * 1000;
const INSERT_CHUNK = 500;

/**
 * "Untouched": not started (to-do), no ticks, no files, no answers. The job
 * only ever changes or removes copies matching this, checked in the same
 * statement that writes, never only in memory.
 */
export const UNTOUCHED = {
  status: 'todo',
  ticks: { none: {} },
  attachments: { none: {} },
  answers: { equals: DbNull },
} as const satisfies Prisma.TaskAssignmentWhereInput;

const TASK_FOR_SCHEDULE = {
  id: true,
  kind: true,
  title: true,
  description: true,
  dueType: true,
  dueTime: true,
  dueDate: true,
  repeat: true,
  repeatWeekdays: true,
  repeatMonthDay: true,
  repeatStartDate: true,
  repeatEndDate: true,
  closesAfterMinutes: true,
  needsApproval: true,
  approverMode: true,
  approverUserId: true,
  blocksLogout: true,
  target: true,
  createdBy: true,
  cancelledAt: true,
  subtasks: {
    where: { removedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, title: true, sortOrder: true, assigneeUserId: true },
  },
  dayEndForm: {
    select: {
      id: true,
      name: true,
      blocksLogout: true,
      archivedAt: true,
      roles: { select: { roleId: true } },
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
        select: { id: true, version: true, questions: true },
      },
    },
  },
} as const satisfies Prisma.TaskSelect;

type ScheduleTask = Prisma.TaskGetPayload<{ select: typeof TASK_FOR_SCHEDULE }>;

export interface ScheduleCounts {
  created: number;
  updated: number;
  removed: number;
  cancelled: number;
  overdue: number;
  closed: number;
  reminders: number;
  skippedStarted: number;
}

const zero = (): ScheduleCounts => ({
  created: 0,
  updated: 0,
  removed: 0,
  cancelled: 0,
  overdue: 0,
  closed: 0,
  reminders: 0,
  skippedStarted: 0,
});

export interface RunOptions {
  /** Test seam: called after reading, before writing (the race test, addition b). */
  beforeWrites?: () => Promise<void>;
}

function ruleOf(t: ScheduleTask): DueRule {
  if (t.kind === 'day_end') {
    // Day-end reports: every working day, due at each school's closing time (addition c).
    return {
      dueType: 'end_of_day',
      dueTime: null,
      dueDate: null,
      repeat: 'daily',
      repeatWeekdays: [],
      repeatMonthDay: null,
      repeatStartDate: toIsoDate(t.repeatStartDate),
      repeatEndDate: null,
      closesAfterMinutes: t.closesAfterMinutes,
    };
  }
  return {
    dueType: t.dueType,
    dueTime: t.dueTime,
    dueDate: t.dueDate ? toIsoDate(t.dueDate) : null,
    repeat: t.repeat,
    repeatWeekdays: t.repeatWeekdays,
    repeatMonthDay: t.repeatMonthDay,
    repeatStartDate: toIsoDate(t.repeatStartDate),
    repeatEndDate: t.repeatEndDate ? toIsoDate(t.repeatEndDate) : null,
    closesAfterMinutes: t.closesAfterMinutes,
  };
}

/** What a new copy of the task starts from (the task as it is now). */
function snapshotOf(t: ScheduleTask): Snapshot {
  const version = t.dayEndForm?.versions[0];
  return {
    title: t.kind === 'day_end' ? (t.dayEndForm?.name ?? t.title) : t.title,
    description: t.description,
    subtasks: t.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      order: s.sortOrder,
      assigneeUserId: s.assigneeUserId,
    })),
    ...(t.kind === 'day_end' && version
      ? {
          form: {
            formId: t.dayEndForm?.id ?? '',
            versionId: version.id,
            version: version.version,
            questions: questionListSchema.parse(version.questions),
          },
        }
      : {}),
  };
}

const blocksOf = (t: ScheduleTask) =>
  t.kind === 'day_end' ? (t.dayEndForm?.blocksLogout ?? true) : t.blocksLogout;

const questionListSchema = z.array(questionSchema);

const key = (taskId: string, userId: string, date: IsoDate) => `${taskId}|${userId}|${date}`;

export class TaskSchedule {
  constructor(private readonly deps: AppDeps) {}

  /**
   * One run for every organisation (or one, when a change asked for an early
   * look). Takes the job lease first; if another server holds it, skips.
   */
  async run(now: Date, organisationId: string | null = null, options: RunOptions = {}) {
    const { data, logger } = this.deps;
    const job = organisationId ? `${SCHEDULE_JOB}:${organisationId}` : SCHEDULE_JOB;
    const lease = await data.jobs.start(job, now, hostname());
    if (!lease) {
      logger.info({ job }, 'Task schedule already running elsewhere; skipped');
      return null;
    }
    const gapFrom =
      !organisationId &&
      lease.lastSuccessAt &&
      now.getTime() - lease.lastSuccessAt.getTime() > GAP_MS
        ? lease.lastSuccessAt
        : null;
    if (gapFrom) {
      // Brief 9.5 and addition a: copies are never made for past dates, even after downtime.
      logger.warn(
        { job, gapFrom: gapFrom.toISOString(), now: now.toISOString() },
        'Task schedule had not run since the last success; missed days get no copies, starting from today',
      );
    }
    const started = Date.now();
    const totals = zero();
    try {
      const orgs = organisationId ? [organisationId] : await data.jobs.organisationIds();
      for (const org of orgs) {
        const c = await this.runOrganisation(org, now, options);
        for (const k of Object.keys(totals) as (keyof ScheduleCounts)[]) totals[k] += c[k];
      }
      await data.jobs.finish(lease.id, this.deps.now(), {
        ok: true,
        counts: { ...totals },
        gapFrom,
      });
      logger.info({ job, ms: Date.now() - started, counts: totals }, 'Task schedule done');
      return totals;
    } catch (err) {
      await data.jobs.finish(lease.id, this.deps.now(), {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        gapFrom,
      });
      logger.error({ job, err }, 'Task schedule failed');
      throw err;
    }
  }

  async runOrganisation(organisationId: string, now: Date, options: RunOptions = {}) {
    const db = this.deps.data.forOrganisation(organisationId);
    const counts = zero();
    const cals = await loadCalendars(db, now);
    const today = cals.today;
    const horizon = addDays(today, WINDOW_DAYS - 1);
    const windowCals = await loadCalendars(db, now, { from: today, to: horizon });
    const people = await loadPeople(db);

    const tasks = await db.task.findMany({
      where: {
        cancelledAt: null,
        repeat: { not: 'none' },
        repeatStartDate: { lte: fromIsoDate(horizon) },
        OR: [{ repeatEndDate: null }, { repeatEndDate: { gte: fromIsoDate(today) } }],
      },
      select: TASK_FOR_SCHEDULE,
    });
    const liveTasks = tasks.filter(
      (t) => t.kind !== 'day_end' || (t.dayEndForm && !t.dayEndForm.archivedAt),
    );
    const everHad = await this.peopleWithCopies(
      db,
      liveTasks.map((t) => t.id),
    );
    const recipients = await this.recipients(db, organisationId, liveTasks, people, everHad);

    // 1. What each person should have in the window.
    const planned = new Map<string, { task: ScheduleTask; person: Person; copy: PlannedCopy }>();
    for (const t of liveTasks) {
      const rule = ruleOf(t);
      for (const person of recipients.get(t.id) ?? []) {
        const cal = windowCals.forSchool(person.homeSchoolId);
        for (const copy of planDates(rule, cal, today, horizon, now)) {
          planned.set(key(t.id, person.id, copy.serviceDate), { task: t, person, copy });
        }
      }
    }
    const existing = await db.taskAssignment.findMany({
      where: {
        taskId: { in: liveTasks.map((t) => t.id) },
        serviceDate: { gte: fromIsoDate(today), lte: fromIsoDate(horizon) },
      },
      select: { taskId: true, userId: true, serviceDate: true },
    });
    const have = new Set(existing.map((c) => key(c.taskId, c.userId, toIsoDate(c.serviceDate))));

    // 2. Untouched copies from today on, of every task (one-time ones too).
    const untouched = await db.taskAssignment.findMany({
      where: {
        ...UNTOUCHED,
        serviceDate: { gte: fromIsoDate(today) },
        OR: [{ serviceDate: { gt: fromIsoDate(today) } }, { dueAt: { gt: now } }],
        task: { cancelledAt: null },
      },
      select: {
        id: true,
        taskId: true,
        userId: true,
        schoolId: true,
        serviceDate: true,
        dueAt: true,
        closesAt: true,
        blocksLogout: true,
        snapshot: true,
        task: { select: TASK_FOR_SCHEDULE },
      },
    });

    await options.beforeWrites?.();

    await withUnitOfWork(
      db,
      { organisationId, userId: null, requestId: 'task-schedule' },
      async (uow) => {
        await this.createMissing(uow, organisationId, planned, have, everHad, people, counts);
        await this.reconcile(uow, untouched, planned, windowCals, people, counts);
        await this.overdueAndClosed(uow, organisationId, now, counts);
        counts.reminders += await this.dueSoon(uow, organisationId, now);
      },
      { timeoutMs: 120_000 },
    );
    return counts;
  }

  /** Everyone who has ever had a copy of each task ("taskId|userId"). */
  private async peopleWithCopies(db: ScopedTx, taskIds: readonly string[]) {
    if (taskIds.length === 0) return new Set<string>();
    const rows = await db.taskAssignment.findMany({
      where: { taskId: { in: [...taskIds] } },
      distinct: ['taskId', 'userId'],
      select: { taskId: true, userId: true },
    });
    return new Set(rows.map((r) => `${r.taskId}|${r.userId}`));
  }

  /**
   * Who each repeating task is for right now. Day-end forms: everyone holding
   * the form's roles. Groups with new joiners: worked out again with the
   * creator's current reach. Otherwise (or if the creator has gone): the
   * people who already have copies.
   */
  private async recipients(
    db: ScopedTx,
    organisationId: string,
    tasks: readonly ScheduleTask[],
    people: People,
    everHad: ReadonlySet<string>,
  ): Promise<Map<string, Person[]>> {
    const out = new Map<string, Person[]>();
    const [roles, schools] = await Promise.all([
      db.role.findMany({ where: { deletedAt: null }, select: { id: true } }),
      db.school.findMany({ where: { deletedAt: null }, select: { id: true } }),
    ]);
    const liveRoles = new Set(roles.map((r) => r.id));
    const liveSchools = new Set(schools.map((s) => s.id));
    const accessOf = new Map<string, ReturnType<typeof createAccess>>();
    const frozen = (taskId: string) =>
      [...people.values()].filter((p) => canWork(p) && everHad.has(`${taskId}|${p.id}`));

    for (const t of tasks) {
      if (t.kind === 'day_end') {
        const formRoles = new Set(t.dayEndForm?.roles.map((r) => r.roleId) ?? []);
        out.set(
          t.id,
          [...people.values()].filter((p) => canWork(p) && formRoles.has(p.roleId ?? '')),
        );
        continue;
      }
      const target = parseTarget(t.target);
      const creator = people.get(t.createdBy);
      if (!includesNewJoiners(target) || !canWork(creator)) {
        out.set(t.id, frozen(t.id));
        continue;
      }
      let access = accessOf.get(t.createdBy);
      if (!access) {
        const loaded = await loadPermissions(this.deps.data, db, {
          id: t.createdBy,
          organisationId,
        });
        access = createAccess(loaded.ctx);
        accessOf.set(t.createdBy, access);
      }
      const a = access;
      // Named people who can no longer be given tasks are dropped quietly here:
      // this isn't the creator choosing them, it's the job keeping up.
      const named = target.userIds.filter((id) => {
        const p = people.get(id);
        return (
          canWork(p) &&
          (id === t.createdBy ||
            a.can('tasks', 'assign', userFacts({ id, homeSchoolId: p.homeSchoolId })))
        );
      });
      const resolved = resolveTarget(
        a,
        people,
        {
          ...target,
          userIds: named,
          roleIds: target.roleIds.filter((r) => liveRoles.has(r)),
          schoolIds: target.schoolIds.filter((s) => liveSchools.has(s)),
        },
        liveRoles,
        liveSchools,
      );
      out.set(t.id, resolved.people);
    }
    return out;
  }

  private async createMissing(
    uow: UnitOfWork,
    organisationId: string,
    planned: Map<string, { task: ScheduleTask; person: Person; copy: PlannedCopy }>,
    have: ReadonlySet<string>,
    everHad: ReadonlySet<string>,
    people: People,
    counts: ScheduleCounts,
  ) {
    const rows: Prisma.TaskAssignmentCreateManyInput[] = [];
    const snapshots = new Map<string, Prisma.InputJsonValue>();
    for (const [k, { task, person, copy }] of planned) {
      if (have.has(k)) continue;
      let snap = snapshots.get(task.id);
      if (!snap) {
        snap = JSON.parse(JSON.stringify(snapshotOf(task))) as Prisma.InputJsonValue;
        snapshots.set(task.id, snap);
      }
      const approver =
        task.kind !== 'day_end' && task.needsApproval
          ? resolveApprover(people, approverCandidate(task.approverMode, task, person), person.id)
          : null;
      rows.push({
        organisationId,
        taskId: task.id,
        userId: person.id,
        schoolId: person.homeSchoolId,
        serviceDate: fromIsoDate(copy.serviceDate),
        dueAt: copy.dueAt,
        closesAt: copy.closesAt,
        needsApproval: approver !== null,
        approverUserId: approver,
        blocksLogout: blocksOf(task),
        snapshot: snap,
      });
    }
    const made: { id: string; taskId: string; userId: string }[] = [];
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      made.push(
        ...(await uow.tx.taskAssignment.createManyAndReturn({
          data: rows.slice(i, i + INSERT_CHUNK),
          skipDuplicates: true,
          select: { id: true, taskId: true, userId: true },
        })),
      );
    }
    counts.created += made.length;
    // Someone new to a task (a new joiner) hears about it once, not every day.
    const firsts = new Map<string, { taskId: string; userId: string; id: string }>();
    for (const m of made) {
      const k = `${m.taskId}|${m.userId}`;
      if (!everHad.has(k) && !firsts.has(k)) firsts.set(k, m);
    }
    await emit(
      uow.tx,
      organisationId,
      [...firsts.values()].map((m) => ({
        event: 'task_assigned' as const,
        recipientUserId: m.userId,
        entityType: 'task',
        entityId: m.taskId,
        dedupeKey: `task_assigned:${m.taskId}:${m.userId}`,
        payload: { copyId: m.id },
      })),
    );
  }

  /** Brings untouched copies in line; anything started meanwhile is left alone. */
  private async reconcile(
    uow: UnitOfWork,
    copies: readonly {
      id: string;
      taskId: string;
      userId: string;
      schoolId: string | null;
      serviceDate: Date;
      dueAt: Date;
      closesAt: Date | null;
      blocksLogout: boolean;
      snapshot: Prisma.JsonValue;
      task: ScheduleTask;
    }[],
    planned: Map<string, { task: ScheduleTask; person: Person; copy: PlannedCopy }>,
    cals: Calendars,
    people: People,
    counts: ScheduleCounts,
  ) {
    const tx = uow.tx;
    for (const c of copies) {
      const person = people.get(c.userId);
      const date = toIsoDate(c.serviceDate);
      if (!canWork(person)) {
        const gone = people.get(c.userId);
        const reason = !gone || !gone.active ? 'No longer active.' : 'No longer has a role.';
        if (await this.cancelIfUntouched(tx, c.id, reason)) counts.cancelled++;
        else counts.skippedStarted++;
        continue;
      }
      let expected: {
        dueAt: Date;
        closesAt: Date | null;
        schoolId: string | null;
        blocksLogout: boolean;
        snapshot?: Snapshot;
      };
      if (c.task.repeat !== 'none' || c.task.kind === 'day_end') {
        const plan = planned.get(key(c.taskId, c.userId, date));
        if (!plan) {
          // A holiday, a day off, a new pattern or no longer in the group.
          if (await this.deleteIfUntouched(tx, c.id)) counts.removed++;
          else counts.skippedStarted++;
          continue;
        }
        const current = parseSnapshot(c.snapshot);
        const next = snapshotOf(c.task);
        const formChanged =
          c.task.kind === 'day_end' &&
          (current.form?.versionId !== next.form?.versionId || current.title !== next.title);
        expected = {
          dueAt: plan.copy.dueAt,
          closesAt: plan.copy.closesAt,
          schoolId: person.homeSchoolId,
          blocksLogout: blocksOf(c.task),
          ...(formChanged ? { snapshot: next } : {}),
        };
      } else {
        // One-time tasks keep their date, even on a holiday (answer 1); only
        // the time moves with the person's (possibly new) school hours.
        const rule = ruleOf(c.task);
        const dueAt = dueAtFor(rule, date, cals.forSchool(person.homeSchoolId));
        expected = {
          dueAt,
          closesAt: closesAtFor(rule, dueAt),
          schoolId: person.homeSchoolId,
          blocksLogout: c.blocksLogout,
        };
      }
      const same =
        expected.dueAt.getTime() === c.dueAt.getTime() &&
        (expected.closesAt?.getTime() ?? null) === (c.closesAt?.getTime() ?? null) &&
        expected.schoolId === c.schoolId &&
        expected.blocksLogout === c.blocksLogout &&
        !expected.snapshot;
      if (same) continue;
      const done = await tx.taskAssignment.updateManyAndReturn({
        where: { id: c.id, ...UNTOUCHED },
        data: {
          dueAt: expected.dueAt,
          closesAt: expected.closesAt,
          schoolId: expected.schoolId,
          blocksLogout: expected.blocksLogout,
          ...(expected.snapshot
            ? { snapshot: JSON.parse(JSON.stringify(expected.snapshot)) as Prisma.InputJsonValue }
            : {}),
        },
        select: { id: true, taskId: true, userId: true, schoolId: true },
      });
      if (done.length > 0) counts.updated++;
      else counts.skippedStarted++;
    }
  }

  private async deleteIfUntouched(tx: ScopedTx, id: string): Promise<boolean> {
    try {
      await tx.taskAssignment.delete({
        where: { id, ...UNTOUCHED },
        select: { id: true, taskId: true, userId: true, schoolId: true },
      });
      return true;
    } catch (err) {
      // Not found any more with those conditions: someone started it. Leave it.
      if (mapDbError(err)?.code === 'not_found') return false;
      throw err;
    }
  }

  private async cancelIfUntouched(tx: ScopedTx, id: string, reason: string): Promise<boolean> {
    const done = await tx.taskAssignment.updateManyAndReturn({
      where: { id, ...UNTOUCHED },
      data: { status: 'cancelled', cancelReason: reason, decidedAt: this.deps.now() },
      select: { id: true, taskId: true, userId: true, schoolId: true },
    });
    return done.length > 0;
  }

  /** Overdue at the deadline, closed at closing time (brief 9.4, 9.5). */
  private async overdueAndClosed(
    uow: UnitOfWork,
    organisationId: string,
    now: Date,
    counts: ScheduleCounts,
  ) {
    const closed = await uow.tx.taskAssignment.updateManyAndReturn({
      where: { status: { in: [...OPEN_STATUSES] }, closesAt: { not: null, lte: now } },
      data: { status: 'expired' },
      select: { id: true, taskId: true, userId: true, schoolId: true },
    });
    counts.closed += closed.length;
    const late = await uow.tx.taskAssignment.updateManyAndReturn({
      where: { status: { in: ['todo', 'in_progress', 'sent_back'] }, dueAt: { lte: now } },
      data: { status: 'overdue' },
      select: { id: true, taskId: true, userId: true, schoolId: true },
    });
    counts.overdue += late.length;
    await emit(
      uow.tx,
      organisationId,
      late.map((c) => ({
        event: 'task_overdue' as const,
        recipientUserId: c.userId,
        entityType: 'task',
        entityId: c.taskId,
        dedupeKey: `task_overdue:${c.id}`,
        payload: { copyId: c.id },
      })),
    );
  }

  /**
   * "Due soon" (brief 10.1): an hour before a timed deadline, and an hour
   * before closing time for end-of-day tasks (whose deadline is closing time).
   */
  private async dueSoon(uow: UnitOfWork, organisationId: string, now: Date): Promise<number> {
    const soon = await uow.tx.taskAssignment.findMany({
      where: {
        status: { in: [...OPEN_STATUSES] },
        dueAt: { gt: now, lte: new Date(now.getTime() + 60 * 60 * 1000) },
      },
      select: { id: true, taskId: true, userId: true, dueAt: true },
    });
    const events: OutboxEvent[] = soon.map((c) => ({
      event: 'task_due_soon',
      recipientUserId: c.userId,
      entityType: 'task',
      entityId: c.taskId,
      dedupeKey: `task_due_soon:${c.id}`,
      payload: { copyId: c.id, dueAt: c.dueAt.toISOString() },
    }));
    return emit(uow.tx, organisationId, events);
  }
}

/** Cancels someone's untouched copies from today on (deactivation, role removed). */
export async function cancelUntouchedFor(
  uow: UnitOfWork,
  userId: string,
  reason: string,
  now: Date,
  today: IsoDate,
): Promise<number> {
  const done = await uow.tx.taskAssignment.updateManyAndReturn({
    where: {
      userId,
      ...UNTOUCHED,
      serviceDate: { gte: fromIsoDate(today) },
      OR: [{ serviceDate: { gt: fromIsoDate(today) } }, { dueAt: { gt: now } }],
    },
    data: { status: 'cancelled', cancelReason: reason, decidedAt: now },
    select: { id: true, taskId: true, userId: true, schoolId: true },
  });
  return done.length;
}
