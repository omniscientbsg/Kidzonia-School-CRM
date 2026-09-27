import { localDate } from '@kidzonia/shared';
import type { Hooks, HolidayImpactHook, UserLeavingHook } from '../../core/hooks.js';
import { fromIsoDate } from './calendars.js';
import { LIVE_STATUSES } from './copies-core.js';
import { loadPeople, resolveApprover } from './people.js';
import { cancelUntouchedFor } from './schedule.js';

/**
 * When someone is deactivated or deleted, work waiting for their approval
 * moves to the next approver up their chain (else an Owner), in the same
 * transaction. After that, Approvals is a plain indexed query again.
 */
export const moveApprovals: UserLeavingHook = async (uow, userId) => {
  const waiting = await uow.tx.taskAssignment.findMany({
    where: { approverUserId: userId, status: { in: [...LIVE_STATUSES] } },
    select: { id: true, userId: true },
  });
  if (waiting.length === 0) return;
  const people = await loadPeople(uow.tx);
  let moved = 0;
  for (const c of waiting) {
    const next = resolveApprover(people, userId, c.userId);
    await uow.tx.taskAssignment.update({
      where: { id: c.id },
      data: { approverUserId: next, needsApproval: next !== null },
      select: { id: true, taskId: true, userId: true, schoolId: true },
    });
    moved++;
  }
  uow.audit({
    action: 'task_copy.approvals_moved',
    entityType: 'user',
    entityId: userId,
    after: { moved },
  });
};

async function today(uow: Parameters<UserLeavingHook>[0], now: Date): Promise<string> {
  const org = await uow.tx.organisation.findFirstOrThrow({ select: { timezone: true } });
  return localDate(now, org.timezone);
}

/** Phase 4: someone who can no longer work gets no more untouched copies. */
const cancelOnLeaving: UserLeavingHook = async (uow, userId, now) => {
  const n = await cancelUntouchedFor(uow, userId, 'No longer active.', now, await today(uow, now));
  if (n > 0) {
    uow.audit({
      action: 'task_copy.cancelled_on_leaving',
      entityType: 'user',
      entityId: userId,
      after: { cancelled: n },
    });
  }
};

const cancelOnRoleRemoved: UserLeavingHook = async (uow, userId, now) => {
  const n = await cancelUntouchedFor(
    uow,
    userId,
    'No longer has a role.',
    now,
    await today(uow, now),
  );
  if (n > 0) {
    uow.audit({
      action: 'task_copy.cancelled_on_role_removed',
      entityType: 'user',
      entityId: userId,
      after: { cancelled: n },
    });
  }
};

/** Phase 4 answer 1: one-time tasks keep their date on a holiday, so say how many fall on it. */
export const oneTimeOnHoliday: HolidayImpactHook = async (db, range) => {
  const copies = await db.taskAssignment.findMany({
    where: {
      status: { in: [...LIVE_STATUSES] },
      serviceDate: { gte: fromIsoDate(range.start), lte: fromIsoDate(range.end) },
      task: { repeat: 'none', kind: 'task', cancelledAt: null },
      ...(range.schoolIds.length > 0 ? { schoolId: { in: [...range.schoolIds] } } : {}),
    },
    select: { taskId: true, task: { select: { title: true } } },
  });
  const titles = [...new Map(copies.map((c) => [c.taskId, c.task.title])).values()];
  return { oneTimeTasks: titles.length, copies: copies.length, titles: titles.slice(0, 10) };
};

export function registerTaskHooks(hooks: Hooks): void {
  const add = <T>(list: T[], fn: T) => {
    if (!list.includes(fn)) list.push(fn);
  };
  add(hooks.userLeaving, moveApprovals);
  add(hooks.userLeaving, cancelOnLeaving);
  add(hooks.roleRemoved, cancelOnRoleRemoved);
  add(hooks.holidayImpact, oneTimeOnHoliday);
}
