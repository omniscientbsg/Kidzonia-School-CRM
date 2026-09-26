import type { RecordFacts, ReachScope, WatcherAccess } from '@kidzonia/shared';
import type { Prisma } from '../../db/index.js';

/**
 * Permission facts for the two kinds of task record (brief 9.1). Kept in one
 * place so every check (lists, the drawer, files, actions) agrees.
 *
 * Approvers, the creator and sub-task assignees are `participants`: they get
 * access to that one record and nothing else. List queries never use
 * participants; the Watching, Approvals and Assigned-by-me lists join their
 * own membership columns instead.
 */

export interface WatcherRef {
  userId: string;
  access: WatcherAccess;
}

export interface CopyFactsInput {
  userId: string;
  schoolId: string | null;
  approverUserId: string | null;
  task: {
    createdBy: string;
    watchers: readonly WatcherRef[];
    subtaskAssigneeIds: readonly string[];
  };
}

/** One person's copy: about the assignee, in the copy's school. */
export function copyFacts(c: CopyFactsInput): RecordFacts {
  const participants: { userId: string; actions: string[] }[] = [
    { userId: c.task.createdBy, actions: ['view'] },
    ...c.task.subtaskAssigneeIds.map((userId) => ({ userId, actions: ['view'] })),
  ];
  // The approver may also write remarks on the copy they decide (field rules still apply).
  if (c.approverUserId) participants.push({ userId: c.approverUserId, actions: ['view', 'edit'] });
  return {
    subjectUserIds: [c.userId],
    schoolIds: c.schoolId ? [c.schoolId] : [],
    watchers: c.task.watchers,
    participants,
  };
}

/** A copy without watchers or participants: "reach over this person" only. */
export function bareCopyFacts(c: { userId: string; schoolId: string | null }): RecordFacts {
  return { subjectUserIds: [c.userId], schoolIds: c.schoolId ? [c.schoolId] : [] };
}

export interface TaskFactsInput {
  createdBy: string;
  creatorSchoolId: string | null;
  approverUserId: string | null;
  watchers: readonly WatcherRef[];
  subtaskAssigneeIds: readonly string[];
  /** The copies to base reach on (all of them, or the ones already known visible). */
  copies: readonly { userId: string; schoolId: string | null; approverUserId: string | null }[];
}

/** The task itself: about its creator and everyone it was given to. */
export function taskFacts(t: TaskFactsInput): RecordFacts {
  const subjects = new Set([t.createdBy, ...t.copies.map((c) => c.userId)]);
  const schools = new Set(t.copies.map((c) => c.schoolId).filter((s): s is string => s !== null));
  if (t.creatorSchoolId) schools.add(t.creatorSchoolId);
  const approvers = new Set(
    [t.approverUserId, ...t.copies.map((c) => c.approverUserId)].filter(
      (a): a is string => a !== null,
    ),
  );
  return {
    subjectUserIds: [...subjects],
    schoolIds: [...schools],
    watchers: t.watchers,
    participants: [
      ...[...approvers].map((userId) => ({ userId, actions: ['view'] })),
      ...t.subtaskAssigneeIds.map((userId) => ({ userId, actions: ['view'] })),
    ],
  };
}

/** Facts about the creator alone: editing a task needs reach over whoever made it. */
export function creatorFacts(createdBy: string, creatorSchoolId: string | null): RecordFacts {
  return { subjectUserIds: [createdBy], schoolIds: creatorSchoolId ? [creatorSchoolId] : [] };
}

/** A reach scope as a WHERE clause on copies (must agree with can() on bareCopyFacts). */
export function copyScopeWhere(scope: ReachScope): Prisma.TaskAssignmentWhereInput {
  if (scope.kind === 'all') return {};
  if (scope.kind === 'none') return { id: { in: [] } };
  const or: Prisma.TaskAssignmentWhereInput[] = [];
  if (scope.userIds.length > 0) or.push({ userId: { in: [...scope.userIds] } });
  if (scope.schoolIds === 'any') or.push({ schoolId: { not: null } });
  else if (scope.schoolIds.length > 0) or.push({ schoolId: { in: [...scope.schoolIds] } });
  return or.length > 0 ? { OR: or } : { id: { in: [] } };
}
