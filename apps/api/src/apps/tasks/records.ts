import { z } from 'zod';
import { listFieldKey, questionSchema, targetSchema } from '@kidzonia/shared';
import type { ListChoice, Target } from '@kidzonia/shared';
import type { Prisma, ScopedTx } from '../../db/index.js';
import { toIsoDate } from './calendars.js';
import type { WatcherRef } from './facts.js';

/** What each copy keeps of the task (brief 9.2), so later edits don't rewrite work. */
export const snapshotSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  subtasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      order: z.number(),
      assigneeUserId: z.string().nullable(),
    }),
  ),
  /** Day-end copies: the form version and questions this copy was given (brief 9.11). */
  form: z
    .object({
      formId: z.string(),
      versionId: z.string(),
      version: z.number(),
      questions: z.array(questionSchema),
    })
    .optional(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const parseSnapshot = (v: Prisma.JsonValue): Snapshot => snapshotSchema.parse(v);

export const customValuesSchema = z.record(z.string(), z.string().nullable());
export const parseCustomValues = (v: Prisma.JsonValue): Record<string, string> =>
  Object.fromEntries(
    Object.entries(customValuesSchema.catch({}).parse(v)).filter(
      (e): e is [string, string] => e[1] !== null,
    ),
  );

export const parseTarget = (v: Prisma.JsonValue): Target => targetSchema.parse(v);

export const parentMessageSchema = z
  .object({ templateId: z.string(), className: z.string() })
  .nullable()
  .catch(null);

const categorySelect = { select: { id: true, name: true, color: true } } as const;
const prioritySelect = { select: { id: true, name: true, color: true, sortOrder: true } } as const;
const personSelect = {
  select: { id: true, fullName: true, jobTitle: true, homeSchool: { select: { name: true } } },
} as const;

/** The task fields a copy needs from its task (read live, not snapshotted). */
export const TASK_FOR_COPY = {
  id: true,
  kind: true,
  repeatStartDate: true,
  repeat: true,
  createdBy: true,
  categoryId: true,
  category: categorySelect,
  priorityId: true,
  priority: prioritySelect,
  customValues: true,
  dueType: true,
  dueTime: true,
  dueDate: true,
  needsApproval: true,
  closesAfterMinutes: true,
  watchers: { select: { userId: true, access: true } },
  dayEndForm: { select: { name: true } },
} as const satisfies Prisma.TaskSelect;

export const COPY_SELECT = {
  id: true,
  taskId: true,
  userId: true,
  schoolId: true,
  serviceDate: true,
  dueAt: true,
  closesAt: true,
  status: true,
  needsApproval: true,
  approverUserId: true,
  blocksLogout: true,
  snapshot: true,
  answers: true,
  remarks: true,
  cancelReason: true,
  submittedAt: true,
  decidedAt: true,
  user: personSelect,
  ticks: { select: { subtaskId: true } },
  _count: { select: { attachments: true } },
  task: { select: TASK_FOR_COPY },
} as const satisfies Prisma.TaskAssignmentSelect;

export type CopyRowData = Prisma.TaskAssignmentGetPayload<{ select: typeof COPY_SELECT }>;

export const TASK_SELECT = {
  id: true,
  kind: true,
  title: true,
  description: true,
  categoryId: true,
  category: categorySelect,
  priorityId: true,
  priority: prioritySelect,
  customValues: true,
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
  approver: { select: { id: true, fullName: true } },
  blocksLogout: true,
  parentMessage: true,
  target: true,
  fromTemplateId: true,
  cancelledAt: true,
  dayEndForm: { select: { name: true } },
  createdBy: true,
  creator: {
    select: {
      id: true,
      fullName: true,
      jobTitle: true,
      homeSchoolId: true,
      homeSchool: { select: { name: true } },
    },
  },
  createdAt: true,
  updatedAt: true,
  subtasks: {
    where: { removedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      title: true,
      sortOrder: true,
      assigneeUserId: true,
      assignee: { select: { id: true, fullName: true } },
    },
  },
  watchers: {
    select: {
      userId: true,
      access: true,
      user: personSelect,
    },
    orderBy: [{ createdAt: 'asc' }],
  },
} as const satisfies Prisma.TaskSelect;

export type TaskRowData = Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>;

export const personRefOf = (u: {
  id: string;
  fullName: string;
  jobTitle: string | null;
  homeSchool: { name: string } | null;
}) => ({
  id: u.id,
  fullName: u.fullName,
  jobTitle: u.jobTitle,
  schoolName: u.homeSchool?.name ?? null,
});

export const watcherRefs = (ws: readonly { userId: string; access: WatcherRef['access'] }[]) =>
  ws.map((w) => ({ userId: w.userId, access: w.access }));

/** Value text for custom list choices, for a page of tasks, in one query. */
export async function loadChoices(
  tx: ScopedTx,
  values: readonly Prisma.JsonValue[],
): Promise<Map<string, ListChoice>> {
  const ids = new Set<string>();
  for (const v of values) Object.values(parseCustomValues(v)).forEach((id) => ids.add(id));
  if (ids.size === 0) return new Map();
  const rows = await tx.taskListValue.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, listId: true, value: true },
  });
  return new Map(rows.map((r) => [r.id, { listId: r.listId, valueId: r.id, value: r.value }]));
}

/** `list_<id>` props, one per list: each is its own field, so serialize() trims them. */
export function listProps(
  customValues: Prisma.JsonValue,
  choices: ReadonlyMap<string, ListChoice>,
): Record<string, ListChoice> {
  const out: Record<string, ListChoice> = {};
  for (const [listId, valueId] of Object.entries(parseCustomValues(customValues))) {
    const c = choices.get(valueId);
    if (c && c.listId === listId) out[listFieldKey(listId)] = c;
  }
  return out;
}

/** A copy in API shape, before field permissions trim it. */
export function copyRecord(c: CopyRowData, choices: ReadonlyMap<string, ListChoice>) {
  const snap = parseSnapshot(c.snapshot);
  const ids = new Set(snap.subtasks.map((s) => s.id));
  const t = c.task;
  return {
    id: c.id,
    taskId: c.taskId,
    kind: t.kind,
    status: c.status,
    serviceDate: toIsoDate(c.serviceDate),
    repeat: t.repeat,
    needsApproval: c.needsApproval,
    blocksLogout: c.blocksLogout,
    subtaskCount: snap.subtasks.length,
    subtasksDone: c.ticks.filter((x) => ids.has(x.subtaskId)).length,
    person: personRefOf(c.user),
    submittedAt: c.submittedAt?.toISOString() ?? null,
    decidedAt: c.decidedAt?.toISOString() ?? null,
    cancelReason: c.cancelReason,
    title: snap.title,
    description: snap.description,
    categoryId: t.categoryId,
    category: t.category,
    priorityId: t.priorityId,
    priority: t.priority,
    dueType: t.dueType,
    dueTime: t.dueTime,
    dueDate: t.dueDate ? toIsoDate(t.dueDate) : null,
    dueAt: c.dueAt.toISOString(),
    closesAt: c.closesAt?.toISOString() ?? null,
    closesAfterMinutes: t.closesAfterMinutes,
    attachmentCount: c._count.attachments,
    remarks: c.remarks,
    ...listProps(t.customValues, choices),
  };
}

/** Shows a target in words, e.g. "All Teachers at Jubilee Hills, Gachibowli, and 1 person". */
export function describeTarget(
  target: Target,
  names: { roles: ReadonlyMap<string, string>; schools: ReadonlyMap<string, string> },
): string {
  const parts: string[] = [];
  if (target.roleIds.length + target.schoolIds.length > 0) {
    const roles = target.roleIds.map((r) => names.roles.get(r) ?? 'a role');
    const who = roles.length > 0 ? `All ${roles.join(', ')}` : 'Everyone';
    const schools = target.schoolIds.map((s) => names.schools.get(s) ?? 'a school');
    parts.push(schools.length > 0 ? `${who} at ${schools.join(', ')}` : `${who} in your schools`);
  }
  const n = target.userIds.length;
  if (n > 0) parts.push(`${String(n)} ${n === 1 ? 'person' : 'people'}`);
  return parts.join(', and ');
}
