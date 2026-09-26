import type { Hooks, UserLeavingHook } from '../../core/hooks.js';
import { LIVE_STATUSES } from './copies-core.js';
import { loadPeople, resolveApprover } from './people.js';

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
      select: { id: true, userId: true, schoolId: true },
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

export function registerTaskHooks(hooks: Hooks): void {
  if (!hooks.userLeaving.includes(moveApprovals)) hooks.userLeaving.push(moveApprovals);
}
