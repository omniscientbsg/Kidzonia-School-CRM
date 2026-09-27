import { completionOf, isOpen, missingRequired, OPEN_STATUSES } from '@kidzonia/shared';
import type { AnswerValue } from '@kidzonia/shared';
import type { Access, IsoDate, ListChoice, Progress, TaskStatus } from '@kidzonia/shared';
import type { Prisma, ScopedTx } from '../../db/index.js';
import { toIsoDate } from './calendars.js';
import { bareCopyFacts, copyFacts } from './facts.js';
import { copyRecord, parseSnapshot, watcherRefs } from './records.js';
import type { CopyRowData } from './records.js';

/** Copies that still count as "live" work: open or waiting for approval. */
export const LIVE_STATUSES: readonly TaskStatus[] = [...OPEN_STATUSES, 'submitted'];

/** Permission facts for a loaded copy row. */
export function factsOfCopy(c: CopyRowData) {
  const snap = parseSnapshot(c.snapshot);
  return copyFacts({
    userId: c.userId,
    schoolId: c.schoolId,
    approverUserId: c.approverUserId,
    task: {
      createdBy: c.task.createdBy,
      watchers: watcherRefs(c.task.watchers),
      subtaskAssigneeIds: snap.subtasks
        .map((s) => s.assigneeUserId)
        .filter((id): id is string => id !== null),
    },
  });
}

/**
 * For a task given on several dates, the copy that represents each person
 * now: their latest copy up to today, else their next one. Progress ("7 of 10
 * done") counts these, so a repeating task shows today's picture.
 */
export function currentCopies<T extends { userId: string; serviceDate: Date }>(
  copies: readonly T[],
  today: IsoDate,
): T[] {
  const byUser = new Map<string, T>();
  for (const c of copies) {
    const d = toIsoDate(c.serviceDate);
    const best = byUser.get(c.userId);
    if (!best) {
      byUser.set(c.userId, c);
      continue;
    }
    const b = toIsoDate(best.serviceDate);
    const better = d <= today ? b > today || d > b : b > today && d < b;
    if (better) byUser.set(c.userId, c);
  }
  return [...byUser.values()];
}

/** The one shared completion count: closed and cancelled copies never count. */
export function progressOf(copies: readonly { status: TaskStatus }[]): Progress {
  return completionOf(copies);
}

/**
 * Decision 6: the creator, or someone with edit reach over the person. Never
 * the person themselves (roles often let people edit their own records), and
 * watching or approving is not enough.
 */
export function canCancelCopy(
  access: Access,
  createdBy: string,
  c: { userId: string; schoolId: string | null },
): boolean {
  if (createdBy === access.userId) return true;
  return c.userId !== access.userId && access.can('tasks', 'edit', bareCopyFacts(c));
}

/**
 * What the signed-in person may do to a copy. Cancelling needs the creator or
 * edit reach over the person themselves: watching or approving is not enough.
 */
export function copyPowers(access: Access, c: CopyRowData) {
  const me = access.userId;
  const writable = !access.readOnly;
  const facts = factsOfCopy(c);
  const open = isOpen(c.status);
  const snap = parseSnapshot(c.snapshot);
  const ticked = new Set(c.ticks.map((t) => t.subtaskId));
  const allTicked = snap.subtasks.every((s) => ticked.has(s.id));
  // Day-end copies: every required question answered (brief 9.6).
  const answered = missingRequired(snap.form?.questions ?? [], answersOf(c)).length === 0;
  const work = writable && open && c.userId === me;
  const decide = writable && c.status === 'submitted' && c.approverUserId === me;
  const cancel =
    writable && (open || c.status === 'submitted') && canCancelCopy(access, c.task.createdBy, c);
  return {
    work,
    submit: work && allTicked && answered,
    answer: work && snap.form !== undefined,
    // Deferring follows the cancel rule, for work still owed (brief 9.7).
    defer: cancel && open,
    attach: work && access.fieldAccess('tasks', 'proof', facts) === 'edit',
    decide,
    writeRemarks: decide && access.fieldAccess('tasks', 'remarks', facts) === 'edit',
    cancel,
  };
}

/** The answers stored on a day-end copy, by question id. */
export function answersOf(c: { answers: Prisma.JsonValue }): Record<string, AnswerValue> | null {
  const v = c.answers;
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, AnswerValue>)
    : null;
}

/** A copy for lists, trimmed by field permissions. */
export function presentCopy(
  access: Access,
  c: CopyRowData,
  choices: ReadonlyMap<string, ListChoice>,
) {
  return access.serialize('tasks', copyRecord(c, choices), factsOfCopy(c));
}

export interface AttachmentRow {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: Date;
}

/** A copy with its sub-tasks, files and what the viewer may do, for the drawer. */
export async function presentCopyDetail(
  tx: ScopedTx,
  access: Access,
  c: CopyRowData,
  choices: ReadonlyMap<string, ListChoice>,
) {
  const snap = parseSnapshot(c.snapshot);
  const ticked = new Set(c.ticks.map((t) => t.subtaskId));
  const assigneeIds = snap.subtasks
    .map((s) => s.assigneeUserId)
    .filter((id): id is string => id !== null);
  const [names, attachments] = await Promise.all([
    assigneeIds.length > 0
      ? tx.user.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
    tx.taskAttachment.findMany({
      where: { assignmentId: c.id },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        uploadedBy: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const nameOf = new Map(names.map((n) => [n.id, n]));
  const can = copyPowers(access, c);
  const me = access.userId;
  const tickable = !access.readOnly && isOpen(c.status);
  const record = {
    ...copyRecord(c, choices),
    subtasks: snap.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      assignee: s.assigneeUserId ? (nameOf.get(s.assigneeUserId) ?? null) : null,
      done: ticked.has(s.id),
      // The assignee ticks any sub-task; a sub-task's own person only theirs (addition a).
      canTick: tickable && (c.userId === me || s.assigneeUserId === me),
    })),
    questions: snap.form?.questions ?? null,
    answers: answersOf(c),
    attachments: attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      isImage: a.contentType.startsWith('image/'),
      uploadedBy: a.uploadedBy,
      createdAt: a.createdAt.toISOString(),
    })),
    can,
  };
  return access.serialize('tasks', record, factsOfCopy(c));
}

/** The few copy columns lists and facts need (no joins beyond the person). */
export const COPY_SELECT_LITE = {
  id: true,
  taskId: true,
  userId: true,
  schoolId: true,
  serviceDate: true,
  dueAt: true,
  status: true,
  approverUserId: true,
  submittedAt: true,
  snapshot: true,
  user: {
    select: { id: true, fullName: true, jobTitle: true, homeSchool: { select: { name: true } } },
  },
} as const satisfies Prisma.TaskAssignmentSelect;

/** Facts for a lite copy, with its task's watchers and creator. */
export function factsOfCopyLite(
  c: {
    userId: string;
    schoolId: string | null;
    approverUserId: string | null;
    snapshot: Prisma.JsonValue;
  },
  task: { createdBy: string; watchers: readonly { userId: string; access: 'view' | 'edit' }[] },
) {
  const snap = parseSnapshot(c.snapshot);
  return copyFacts({
    userId: c.userId,
    schoolId: c.schoolId,
    approverUserId: c.approverUserId,
    task: {
      createdBy: task.createdBy,
      watchers: watcherRefs(task.watchers),
      subtaskAssigneeIds: snap.subtasks
        .map((s) => s.assigneeUserId)
        .filter((id): id is string => id !== null),
    },
  });
}
