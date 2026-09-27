import {
  answerProblems,
  closesAtFor,
  deferRange,
  dueAtFor,
  isOpen,
  isWorkingDay,
  movableFrom,
  OPEN_STATUSES,
  toPage,
} from '@kidzonia/shared';
import type { AnswerValue, StatusMoveName, TaskStatus } from '@kidzonia/shared';
import { emit } from '../../core/outbox.js';
import type { OutboxEvent } from '../../core/outbox.js';
import { fromIsoDate, loadCalendars, toIsoDate } from './calendars.js';
import type { z } from 'zod';
import type { copyListQuerySchema } from '@kidzonia/shared';
import { withUnitOfWork } from '../../db/index.js';
import type { Prisma, UnitOfWork } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import type { AuthInfo } from '../../http/types.js';
import { AppError, businessRule, notAllowed, notFound } from '../../lib/errors.js';
import { requireModule, requireWritable } from '../../core/guards.js';
import {
  answersOf,
  copyPowers,
  factsOfCopy,
  presentCopy,
  presentCopyDetail,
} from './copies-core.js';
import { COPY_SELECT, loadChoices, parseSnapshot } from './records.js';
import type { CopyRowData } from './records.js';

type CopyListQuery = z.output<typeof copyListQuerySchema>;

const TASKS = 'tasks';
const COPY_WRITE_SELECT = { id: true, userId: true, schoolId: true } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One person's copy: doing it (ticks, submit), deciding it (approve, send
 * back) and cancelling it. Every status change is a conditional update from
 * the statuses the shared table allows, so a double submit or two approvers
 * at once can't both win; the loser gets 409 with the current status.
 */
export class CopiesService {
  constructor(private readonly deps: AppDeps) {}

  /** A copy the person may see, or 404. */
  async visible(auth: AuthInfo, id: string): Promise<CopyRowData> {
    const access = await auth.access();
    const c = await auth.db.taskAssignment.findFirst({ where: { id }, select: COPY_SELECT });
    if (!c || !access.can(TASKS, 'view', factsOfCopy(c))) throw notFound('That task');
    return c;
  }

  async detail(auth: AuthInfo, id: string) {
    const access = await auth.access();
    const c = await this.visible(auth, id);
    const choices = await loadChoices(auth.db, [c.task.customValues]);
    return presentCopyDetail(auth.db, access, c, choices);
  }

  /** My tasks (open, waiting, and the last week's finished) or Approvals. */
  async list(auth: AuthInfo, q: CopyListQuery) {
    const access = await auth.access();
    const me = access.userId;
    let where: Prisma.TaskAssignmentWhereInput;
    let orderBy: Prisma.TaskAssignmentOrderByWithRelationInput[];
    if (q.tab === 'my') {
      requireModule(access, TASKS, 'view');
      const since = new Date(this.deps.now().getTime() - 7 * DAY_MS);
      where = {
        userId: me,
        OR: [{ status: { in: [...OPEN_STATUSES, 'submitted'] } }, { updatedAt: { gte: since } }],
      };
      orderBy = [{ dueAt: 'asc' }, { id: 'asc' }];
    } else {
      // Approvals: work waiting for this person's decision, wherever it came from.
      where = { approverUserId: me, status: 'submitted' };
      orderBy = [{ submittedAt: 'asc' }, { id: 'asc' }];
    }
    if (q.q && access.fieldAccess(TASKS, 'title') !== 'hidden') {
      where = { AND: [where, { task: { title: { contains: q.q, mode: 'insensitive' } } }] };
    }
    const rows = await auth.db.taskAssignment.findMany({
      where,
      select: COPY_SELECT,
      orderBy,
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, q.limit);
    const choices = await loadChoices(
      auth.db,
      page.items.map((c) => c.task.customValues),
    );
    return {
      items: page.items
        .filter((c) => access.can(TASKS, 'view', factsOfCopy(c)))
        .map((c) => presentCopy(access, c, choices)),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Moves a copy from one of the statuses a move allows. Returns false when
   * the copy had already moved on (someone else, or a repeated request).
   */
  private async move(
    uow: UnitOfWork,
    id: string,
    name: StatusMoveName,
    to: TaskStatus,
    data: Prisma.TaskAssignmentUpdateManyMutationInput = {},
  ): Promise<boolean> {
    const moved = await uow.tx.taskAssignment.updateManyAndReturn({
      where: { id, status: { in: [...movableFrom(name)] } },
      data: { ...data, status: to },
      select: COPY_WRITE_SELECT,
    });
    return moved.length === 1;
  }

  private async alreadyMoved(auth: AuthInfo, id: string): Promise<never> {
    const now = await auth.db.taskAssignment.findFirst({ where: { id }, select: { status: true } });
    const status = now?.status ?? 'cancelled';
    const said: Partial<Record<TaskStatus, string>> = {
      submitted: 'This was already submitted.',
      done: 'This was already marked as done.',
      approved: 'This was already approved.',
      sent_back: 'This was already sent back.',
      cancelled: 'This task was cancelled.',
      expired: 'This task has closed.',
    };
    throw new AppError(
      'conflict',
      said[status] ?? 'This task changed in the meantime. Refresh and try again.',
      undefined,
      undefined,
      { status },
    );
  }

  /** The first tick, answer or file starts the work (brief 9.4). */
  private async startIfTodo(uow: UnitOfWork, c: CopyRowData) {
    if (c.status === 'todo') await this.move(uow, c.id, 'start', 'in_progress');
  }

  async tick(auth: AuthInfo, id: string, subtaskId: string, done: boolean) {
    const access = await auth.access();
    requireWritable(access);
    const c = await this.visible(auth, id);
    const sub = parseSnapshot(c.snapshot).subtasks.find((s) => s.id === subtaskId);
    if (!sub) throw notFound('That sub-task');
    // The person ticks anything on their copy; a sub-task's own person only theirs (addition a).
    if (c.userId !== access.userId && sub.assigneeUserId !== access.userId) {
      throw notAllowed('Only the person doing this task can tick its sub-tasks.');
    }
    if (!isOpen(c.status)) {
      throw businessRule('This task isn’t open any more, so its sub-tasks can’t change.');
    }
    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      if (done) {
        await uow.tx.taskAssignmentSubtask.createMany({
          data: [
            {
              organisationId: auth.organisationId,
              assignmentId: id,
              subtaskId,
              doneBy: access.userId,
            },
          ],
          skipDuplicates: true,
        });
        await this.startIfTodo(uow, c);
      } else {
        await uow.tx.taskAssignmentSubtask.deleteMany({ where: { assignmentId: id, subtaskId } });
      }
    });
    return this.detail(auth, id);
  }

  /** Submit for approval, or mark as done when no approval is needed (brief 9.6). */
  async submit(auth: AuthInfo, id: string) {
    const access = await auth.access();
    requireWritable(access);
    const c = await this.visible(auth, id);
    if (c.userId !== access.userId) {
      throw notAllowed('Only the person doing this task can submit it.');
    }
    if (!isOpen(c.status)) await this.alreadyMoved(auth, id);
    if (!copyPowers(access, c).submit) {
      throw businessRule('Tick every sub-task before you submit.');
    }
    const now = this.deps.now();
    const ok = await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      uow.act('task', c.taskId, c.needsApproval ? 'submitted' : 'completed');
      const moved = c.needsApproval
        ? await this.move(uow, id, 'submit', 'submitted', { submittedAt: now })
        : await this.move(uow, id, 'complete', 'done', { submittedAt: now, decidedAt: now });
      if (moved && c.needsApproval && c.approverUserId) {
        // Brief 10.1: the approver and the watchers hear about submitted work.
        const told = new Set([c.approverUserId, ...c.task.watchers.map((w) => w.userId)]);
        told.delete(c.userId);
        await emit(
          uow.tx,
          auth.organisationId,
          [...told].map((recipientUserId): OutboxEvent => ({
            event: 'task_submitted',
            recipientUserId,
            entityType: 'task',
            entityId: c.taskId,
            dedupeKey: `task_submitted:${id}:${now.toISOString()}:${recipientUserId}`,
            payload: { copyId: id, by: c.userId },
          })),
        );
      }
      if (moved && !c.needsApproval && c.task.needsApproval) {
        // Decision 5: nobody could approve it (an Owner's own work); keep a record.
        uow.audit({
          action: 'task_copy.completed_without_approver',
          entityType: 'task_copy',
          entityId: id,
        });
      }
      return moved;
    });
    if (!ok) await this.alreadyMoved(auth, id);
    return this.detail(auth, id);
  }

  async decide(auth: AuthInfo, id: string, approve: boolean, remarks: string | null) {
    const access = await auth.access();
    requireWritable(access);
    const c = await this.visible(auth, id);
    if (c.approverUserId !== access.userId) {
      throw notAllowed('Only the approver of this task can approve it or send it back.');
    }
    if (c.status !== 'submitted') await this.alreadyMoved(auth, id);
    if (remarks && !copyPowers(access, c).writeRemarks) {
      throw new AppError('not_allowed', 'Your role doesn’t let you add remarks.', {
        remarks: 'You can’t add remarks.',
      });
    }
    const now = this.deps.now();
    const ok = await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      uow.act('task', c.taskId, approve ? 'approved' : 'sent_back');
      const data = { decidedAt: now, decidedBy: access.userId, remarks };
      const moved = approve
        ? await this.move(uow, id, 'approve', 'approved', data)
        : await this.move(uow, id, 'send_back', 'sent_back', data);
      if (moved) {
        await emit(uow.tx, auth.organisationId, [
          {
            event: approve ? 'task_approved' : 'task_sent_back',
            recipientUserId: c.userId,
            entityType: 'task',
            entityId: c.taskId,
            dedupeKey: `${approve ? 'task_approved' : 'task_sent_back'}:${id}:${now.toISOString()}`,
            payload: { copyId: id, remarks },
          },
        ]);
        uow.audit({
          action: approve ? 'task_copy.approved' : 'task_copy.sent_back',
          entityType: 'task_copy',
          entityId: id,
          after: { remarks },
        });
      }
      return moved;
    });
    if (!ok) await this.alreadyMoved(auth, id);
    return this.detail(auth, id);
  }

  /** Decision 6: the creator, or edit reach over the person, with a reason they see. */
  async cancel(auth: AuthInfo, id: string, reason: string) {
    const access = await auth.access();
    requireWritable(access);
    const c = await this.visible(auth, id);
    if (!copyPowers(access, c).cancel) {
      if (c.status === 'cancelled' || !isOpen(c.status)) await this.alreadyMoved(auth, id);
      throw notAllowed('You can’t cancel this person’s task.');
    }
    const now = this.deps.now();
    const ok = await withUnitOfWork(auth.db, auth.actor, (uow) => {
      uow.act('task', c.taskId, 'cancelled_copy');
      return this.move(uow, id, 'cancel', 'cancelled', {
        cancelReason: reason,
        cancelledBy: access.userId,
        decidedAt: now,
      });
    });
    if (!ok) await this.alreadyMoved(auth, id);
    return this.detail(auth, id);
  }

  /**
   * Defer (brief 9.7): move one person's copy to another working day, from
   * tomorrow up to TASK_DEFER_MAX_DAYS ahead. The creator or edit reach over
   * the person, never the person themselves; always with a reason; audited.
   */
  async defer(auth: AuthInfo, id: string, toDate: string, reason: string) {
    const access = await auth.access();
    requireWritable(access);
    const c = await this.visible(auth, id);
    if (!copyPowers(access, c).defer) {
      if (!isOpen(c.status)) await this.alreadyMoved(auth, id);
      throw notAllowed('You can’t move this person’s task.');
    }
    const now = this.deps.now();
    const cals = await loadCalendars(auth.db, now, { from: toDate, to: toDate });
    const range = deferRange(cals.today, this.deps.config.TASK_DEFER_MAX_DAYS);
    if (toDate < range.from || toDate > range.to) {
      throw new AppError(
        'invalid_input',
        `Pick a day from tomorrow up to ${String(this.deps.config.TASK_DEFER_MAX_DAYS)} days ahead.`,
        { toDate: 'Pick another day.' },
      );
    }
    const person = await auth.db.user.findFirst({
      where: { id: c.userId },
      select: { homeSchoolId: true },
    });
    const cal = cals.forSchool(person?.homeSchoolId ?? null);
    if (!isWorkingDay(cal, toDate)) {
      throw new AppError('invalid_input', 'That’s not a working day for their school.', {
        toDate: 'Pick a working day.',
      });
    }
    const clash = await auth.db.taskAssignment.count({
      where: { taskId: c.taskId, userId: c.userId, serviceDate: fromIsoDate(toDate) },
    });
    if (clash > 0) throw new AppError('conflict', 'They already have this task on that day.');
    const t = c.task;
    const rule = {
      dueType: t.dueType,
      dueTime: t.dueTime,
      dueDate: null,
      repeat: 'none' as const,
      repeatWeekdays: [],
      repeatMonthDay: null,
      repeatStartDate: toDate,
      repeatEndDate: null,
      closesAfterMinutes: t.closesAfterMinutes,
    };
    // A fixed date's time stays a time on the new day; end of day follows the school.
    const dueAt = dueAtFor(
      {
        ...rule,
        dueType: t.dueType === 'on_date' ? (t.dueTime ? 'at_time' : 'end_of_day') : t.dueType,
      },
      toDate,
      cal,
    );
    const started = c.ticks.length > 0 || c._count.attachments > 0 || answersOf(c) !== null;
    const from = toIsoDate(c.serviceDate);
    const ok = await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      uow.act('task', c.taskId, 'deferred');
      const moved = await uow.tx.taskAssignment.updateManyAndReturn({
        where: { id, status: { in: [...OPEN_STATUSES] } },
        data: {
          serviceDate: fromIsoDate(toDate),
          dueAt,
          closesAt: closesAtFor(rule, dueAt),
          // Overdue no longer applies on the new day.
          ...(c.status === 'overdue' ? { status: started ? 'in_progress' : 'todo' } : {}),
        },
        select: { id: true, taskId: true, userId: true, schoolId: true },
      });
      if (moved.length === 1) {
        uow.audit({
          action: 'task_copy.deferred',
          entityType: 'task_copy',
          entityId: id,
          before: { serviceDate: from },
          after: { serviceDate: toDate, reason },
        });
      }
      return moved.length === 1;
    });
    if (!ok) await this.alreadyMoved(auth, id);
    return this.detail(auth, id);
  }

  /** Day-end answers (brief 9.11), checked against this copy's own questions. */
  async answer(auth: AuthInfo, id: string, answers: Record<string, AnswerValue>) {
    const access = await auth.access();
    requireWritable(access);
    const c = await this.visible(auth, id);
    const powers = copyPowers(access, c);
    if (!powers.answer) {
      if (c.userId === access.userId && !isOpen(c.status)) {
        throw businessRule('This report isn’t open any more, so its answers can’t change.');
      }
      throw notAllowed('Only the person filling in this report can answer it.');
    }
    const questions = parseSnapshot(c.snapshot).form?.questions ?? [];
    const problems = answerProblems(questions, answers);
    if (Object.keys(problems).length > 0) {
      throw new AppError('invalid_input', 'Some answers don’t fit their questions.', problems);
    }
    const merged = { ...(answersOf(c) ?? {}), ...answers };
    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      await uow.tx.taskAssignment.updateManyAndReturn({
        where: { id, status: { in: [...OPEN_STATUSES] } },
        data: { answers: merged },
        select: { id: true, taskId: true, userId: true, schoolId: true },
      });
      await this.startIfTodo(uow, c);
    });
    return this.detail(auth, id);
  }

  /** Used by attachments: a file counts as starting the work. */
  async started(auth: AuthInfo, c: CopyRowData) {
    if (c.status !== 'todo') return;
    await withUnitOfWork(auth.db, auth.actor, (uow) => this.startIfTodo(uow, c));
  }
}
