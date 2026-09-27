import { z } from 'zod';
import { idSchema } from '../ids.js';
import { pageQuerySchema } from '../pagination.js';
import { TASK_STATUSES } from '../tasks/status.js';
import { timeOfDaySchema } from './common.js';

/**
 * Tasks API shapes (brief 9, 11), shared by the server and the app. Inputs
 * are validated here once; the server re-validates a PUT on the MERGED record
 * (existing + changes) with the same rules, never the fragment alone.
 */

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-30')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'Use a real date');

const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Pick a colour');

export const DUE_TYPES = ['end_of_day', 'at_time', 'on_date'] as const;
export const REPEATS = ['none', 'daily', 'weekly', 'monthly'] as const;
export const APPROVER_MODES = ['creator', 'reporting_manager', 'named_user'] as const;
export const WATCHER_ACCESS = ['view', 'edit'] as const;

export type DueType = (typeof DUE_TYPES)[number];
export type Repeat = (typeof REPEATS)[number];
export type ApproverMode = (typeof APPROVER_MODES)[number];

export const REPEAT_LABEL: Record<Repeat, string> = {
  none: 'Does not repeat',
  daily: 'Every working day',
  weekly: 'Every week',
  monthly: 'Every month',
};

/** Brief 9.3: one target shape. Group = roles × schools (either may be empty = any). */
export const targetSchema = z
  .object({
    userIds: z.array(idSchema).max(1000, 'Too many people named').default([]),
    roleIds: z.array(idSchema).max(50).default([]),
    schoolIds: z.array(idSchema).max(200).default([]),
    excludeUserIds: z.array(idSchema).max(1000).default([]),
    /** For repeating tasks: recompute the group each time, or freeze the list. */
    includeNewJoiners: z.boolean().nullable().default(null),
  })
  .refine((t) => t.userIds.length + t.roleIds.length + t.schoolIds.length > 0, {
    message: 'Choose who this task is for',
    path: ['userIds'],
  });
export type Target = z.output<typeof targetSchema>;

export const hasGroup = (t: Pick<Target, 'roleIds' | 'schoolIds'>): boolean =>
  t.roleIds.length + t.schoolIds.length > 0;

/** Brief 9.3: false when only named people are chosen, true otherwise. */
export const includesNewJoiners = (t: Target): boolean => t.includeNewJoiners ?? hasGroup(t);

/** Addition a: a sub-task can have its own assignee only on a task for one named person. */
export const allowsSubtaskAssignees = (t: Pick<Target, 'userIds' | 'roleIds' | 'schoolIds'>) =>
  t.userIds.length === 1 && !hasGroup(t);

const subtaskInputSchema = z.object({
  /** Present when editing an existing sub-task. */
  id: idSchema.optional(),
  title: z.string().trim().min(1, 'Give the sub-task a name').max(200),
  assigneeUserId: idSchema.nullable().default(null),
});

const parentMessageSchema = z.object({
  templateId: idSchema,
  className: z.string().trim().min(1, 'Choose a class').max(60),
});

const watcherSchema = z.object({ userId: idSchema, access: z.enum(WATCHER_ACCESS) });

/** Every task field, required, with nulls for "not set". The merged record for rules. */
const taskShape = {
  title: z.string().trim().min(1, 'Give the task a title').max(200, 'Keep the title shorter'),
  description: z.string().trim().max(5000).nullable(),
  categoryId: idSchema.nullable(),
  priorityId: idSchema.nullable(),
  /** list id -> value id (null clears). */
  customValues: z.record(idSchema, idSchema.nullable()),
  dueType: z.enum(DUE_TYPES),
  dueTime: timeOfDaySchema.nullable(),
  dueDate: isoDateSchema.nullable(),
  repeat: z.enum(REPEATS),
  repeatWeekdays: z.array(z.number().int().min(0).max(6)).max(7),
  repeatMonthDay: z.number().int().min(1).max(31).nullable(),
  /** Null means "today". */
  repeatStartDate: isoDateSchema.nullable(),
  repeatEndDate: isoDateSchema.nullable(),
  closesAfterMinutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 30)
    .nullable(),
  needsApproval: z.boolean(),
  approverMode: z.enum(APPROVER_MODES),
  approverUserId: idSchema.nullable(),
  blocksLogout: z.boolean(),
  parentMessage: parentMessageSchema.nullable(),
  subtasks: z.array(subtaskInputSchema).max(30, 'At most 30 sub-tasks'),
  watchers: z.array(watcherSchema).max(50, 'At most 50 watchers'),
  target: targetSchema,
};

type TaskShape = z.output<z.ZodObject<typeof taskShape>>;

/** Rules across fields, shared by create, the merged record on edit, and the form. */
export function taskRules(v: TaskShape, ctx: z.RefinementCtx): void {
  const issue = (path: string, message: string) => {
    ctx.addIssue({ code: 'custom', path: [path], message });
  };
  if (v.dueType === 'at_time' && !v.dueTime) issue('dueTime', 'Pick a time');
  if (v.dueType === 'on_date') {
    if (!v.dueDate) issue('dueDate', 'Pick a date');
    if (v.repeat !== 'none') issue('repeat', 'A task on a date can’t repeat');
  }
  if (v.repeat === 'weekly' && v.repeatWeekdays.length === 0) {
    issue('repeatWeekdays', 'Pick at least one day');
  }
  if (v.repeat === 'monthly' && v.repeatMonthDay === null) {
    issue('repeatMonthDay', 'Pick a day of the month');
  }
  if (v.repeatEndDate && v.repeatStartDate && v.repeatEndDate < v.repeatStartDate) {
    issue('repeatEndDate', 'Stop repeating after it starts');
  }
  if (v.needsApproval && v.approverMode === 'named_user' && !v.approverUserId) {
    issue('approverUserId', 'Choose who approves');
  }
  if (!allowsSubtaskAssignees(v.target) && v.subtasks.some((s) => s.assigneeUserId)) {
    issue('subtasks', 'Sub-tasks can have their own person only when the task is for one person');
  }
  const watcherIds = v.watchers.map((w) => w.userId);
  if (new Set(watcherIds).size !== watcherIds.length) issue('watchers', 'Someone is listed twice');
}

export const taskRecordSchema = z.object(taskShape).superRefine(taskRules);
export type TaskRecordInput = z.output<typeof taskRecordSchema>;

/** POST /tasks. Everything but title, when and who has a default. */
export const createTaskSchema = z
  .object({
    ...taskShape,
    description: taskShape.description.default(null),
    categoryId: taskShape.categoryId.default(null),
    priorityId: taskShape.priorityId.default(null),
    customValues: taskShape.customValues.default({}),
    dueType: taskShape.dueType.default('end_of_day'),
    dueTime: taskShape.dueTime.default(null),
    dueDate: taskShape.dueDate.default(null),
    repeat: taskShape.repeat.default('none'),
    repeatWeekdays: taskShape.repeatWeekdays.default([]),
    repeatMonthDay: taskShape.repeatMonthDay.default(null),
    repeatStartDate: taskShape.repeatStartDate.default(null),
    repeatEndDate: taskShape.repeatEndDate.default(null),
    closesAfterMinutes: taskShape.closesAfterMinutes.default(null),
    needsApproval: taskShape.needsApproval.default(false),
    approverMode: taskShape.approverMode.default('creator'),
    approverUserId: taskShape.approverUserId.default(null),
    blocksLogout: taskShape.blocksLogout.default(false),
    parentMessage: taskShape.parentMessage.default(null),
    subtasks: taskShape.subtasks.default([]),
    watchers: taskShape.watchers.default([]),
    fromTemplateId: idSchema.nullable().default(null),
  })
  .superRefine(taskRules);
export type CreateTaskInput = z.output<typeof createTaskSchema>;

/** PUT /tasks/:id: a partial update; the server validates the merged record. */
export const updateTaskSchema = z.object(taskShape).partial();
export type UpdateTaskInput = z.output<typeof updateTaskSchema>;

export const targetPreviewSchema = z.object({
  target: targetSchema,
  /** A one-time task's date: the preview then warns about holidays on it (Phase 4). */
  dueDate: isoDateSchema.nullish(),
});

export const cancelCopySchema = z.object({
  reason: z.string().trim().min(3, 'Say briefly why').max(300),
});

export const decideCopySchema = z.object({
  remarks: z.string().trim().max(1000).nullable().default(null),
});

export const tickSubtaskSchema = z.object({ done: z.boolean() });

// ---------- queries ----------

export const TASK_VIEWS = ['byme', 'team', 'watching'] as const;
export const COPY_TABS = ['my', 'approvals'] as const;

export const taskListQuerySchema = pageQuerySchema.extend({
  view: z.enum(TASK_VIEWS),
  q: z.string().trim().max(100).optional(),
  categoryId: idSchema.optional(),
  priorityId: idSchema.optional(),
  /** A custom list value, "listId:valueId". */
  listValue: z
    .string()
    .regex(/^[0-9a-f-]{36}:[0-9a-f-]{36}$/i)
    .optional(),
  sort: z.enum(['recent', 'priority']).default('recent'),
});

export const copyListQuerySchema = pageQuerySchema.extend({
  tab: z.enum(COPY_TABS),
  q: z.string().trim().max(100).optional(),
});

export const peopleQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
});

// ---------- task setup ----------

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Give it a name').max(40),
  color: colorSchema,
});
export const priorityInputSchema = categoryInputSchema;
export const priorityOrderSchema = z.object({ ids: z.array(idSchema).min(1).max(50) });
export const listInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the list a name').max(40),
});
export const listValueInputSchema = z.object({
  value: z.string().trim().min(1, 'Type a value').max(60),
});
export const messageTemplateInputSchema = z.object({
  name: z.string().trim().min(1, 'Give it a name').max(60),
  body: z.string().trim().min(1, 'Write the message').max(1000),
});

/**
 * A template is a task without people and without fixed dates (brief 9.10).
 * Parsing strips everything else: target, watchers, a named approver,
 * sub-task assignees, due and repeat dates are never stored.
 */
export const templatePayloadSchema = z
  .object({
    title: z.string().trim().max(200).default(''),
    description: z.string().trim().max(5000).nullable().default(null),
    categoryId: idSchema.nullable().default(null),
    priorityId: idSchema.nullable().default(null),
    customValues: z.record(idSchema, idSchema.nullable()).default({}),
    dueType: z.enum(DUE_TYPES).default('end_of_day'),
    dueTime: timeOfDaySchema.nullable().default(null),
    repeat: z.enum(REPEATS).default('none'),
    repeatWeekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    repeatMonthDay: z.number().int().min(1).max(31).nullable().default(null),
    closesAfterMinutes: z
      .number()
      .int()
      .min(1)
      .max(60 * 24 * 30)
      .nullable()
      .default(null),
    needsApproval: z.boolean().default(false),
    approverMode: z.enum(APPROVER_MODES).default('creator'),
    blocksLogout: z.boolean().default(false),
    parentMessage: parentMessageSchema.nullable().default(null),
    subtasks: z
      .array(z.object({ title: z.string().trim().min(1).max(200) }))
      .max(30)
      .default([]),
  })
  // A named approver is a person, so it never goes into a template.
  .transform((p) => ({
    ...p,
    approverMode: p.approverMode === 'named_user' ? ('creator' as const) : p.approverMode,
  }));
export type TemplatePayload = z.output<typeof templatePayloadSchema>;

export const templateInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the template a name').max(80),
  payload: templatePayloadSchema,
});
export const templateUpdateSchema = templateInputSchema.partial();

// ---------- responses ----------

export const categorySchema = z.object({ id: idSchema, name: z.string(), color: z.string() });
export const prioritySchema = categorySchema.extend({ sortOrder: z.number() });
export const listValueSchema = z.object({ id: idSchema, value: z.string() });
export const customListSchema = z.object({
  id: idSchema,
  name: z.string(),
  values: z.array(listValueSchema),
});
export const messageTemplateSchema = z.object({
  id: idSchema,
  name: z.string(),
  body: z.string(),
});
export const templateSchema = z.object({
  id: idSchema,
  name: z.string(),
  payload: templatePayloadSchema,
  updatedAt: z.string(),
});
export type Category = z.infer<typeof categorySchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type CustomList = z.infer<typeof customListSchema>;
export type MessageTemplate = z.infer<typeof messageTemplateSchema>;
export type TaskTemplate = z.infer<typeof templateSchema>;

/** GET /task-setup: everything the task form and Task setup need, in one call. */
export const taskSetupSchema = z.object({
  categories: z.array(categorySchema),
  priorities: z.array(prioritySchema),
  lists: z.array(customListSchema),
  messageTemplates: z.array(messageTemplateSchema),
});
export type TaskSetup = z.infer<typeof taskSetupSchema>;

const personRefSchema = z.object({
  id: idSchema,
  fullName: z.string(),
  jobTitle: z.string().nullable(),
  schoolName: z.string().nullable(),
});
export type PersonRef = z.infer<typeof personRefSchema>;

export const statusSchema = z.enum(TASK_STATUSES);

export const listChoiceSchema = z.object({
  listId: idSchema,
  valueId: idSchema,
  value: z.string(),
});
export type ListChoice = z.infer<typeof listChoiceSchema>;

/**
 * Field-permission-trimmed records: any field can be missing, so everything
 * governed by a field is optional. Custom list values arrive as `list_<id>`.
 */
const trimmed = {
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  category: categorySchema.nullable().optional(),
  priorityId: idSchema.nullable().optional(),
  priority: prioritySchema.nullable().optional(),
  dueType: z.enum(DUE_TYPES).optional(),
  dueTime: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
};

export const copyRowSchema = z
  .object({
    id: idSchema,
    taskId: idSchema,
    kind: z.enum(['task', 'day_end']),
    status: statusSchema,
    serviceDate: z.string(),
    repeat: z.enum(REPEATS),
    needsApproval: z.boolean(),
    blocksLogout: z.boolean(),
    subtaskCount: z.number(),
    subtasksDone: z.number(),
    person: personRefSchema,
    submittedAt: z.string().nullable(),
    cancelReason: z.string().nullable(),
    dueAt: z.string().optional(),
    attachmentCount: z.number().optional(),
    remarks: z.string().nullable().optional(),
    ...trimmed,
  })
  .catchall(z.unknown());
export type CopyRow = z.infer<typeof copyRowSchema>;

export const progressSchema = z.object({
  total: z.number(),
  done: z.number(),
  submitted: z.number(),
  overdue: z.number(),
});
export type Progress = z.infer<typeof progressSchema>;

export const taskRowSchema = z
  .object({
    id: idSchema,
    kind: z.enum(['task', 'day_end']),
    repeat: z.enum(REPEATS),
    creator: personRefSchema,
    progress: progressSchema,
    needsApproval: z.boolean(),
    blocksLogout: z.boolean(),
    createdAt: z.string(),
    cancelledAt: z.string().nullable(),
    ...trimmed,
  })
  .catchall(z.unknown());
export type TaskRow = z.infer<typeof taskRowSchema>;

export const attachmentSchema = z.object({
  id: idSchema,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  isImage: z.boolean(),
  uploadedBy: idSchema,
  createdAt: z.string(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const copySubtaskSchema = z.object({
  id: idSchema,
  title: z.string(),
  assignee: z.object({ id: idSchema, fullName: z.string() }).nullable(),
  done: z.boolean(),
  /** Whether the signed-in person may tick or untick it. */
  canTick: z.boolean(),
});

export const copyDetailSchema = copyRowSchema.extend({
  subtasks: z.array(copySubtaskSchema),
  attachments: z.array(attachmentSchema).optional(),
  decidedAt: z.string().nullable(),
  /** Day-end copies: the questions this copy was given, and the answers so far. */
  questions: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        type: z.enum(['yes_no', 'number', 'short_text', 'pick_one', 'checklist']),
        required: z.boolean(),
        options: z.array(z.string()),
      }),
    )
    .nullable()
    .optional(),
  answers: z
    .record(
      z.string(),
      z.union([z.boolean(), z.number(), z.string(), z.array(z.string()), z.null()]),
    )
    .nullable()
    .optional(),
  can: z.object({
    answer: z.boolean().optional(),
    defer: z.boolean().optional(),
    /** The assignee working on an open copy (tick, attach, submit). */
    work: z.boolean(),
    submit: z.boolean(),
    attach: z.boolean(),
    decide: z.boolean(),
    writeRemarks: z.boolean(),
    cancel: z.boolean(),
  }),
});
export type CopyDetail = z.infer<typeof copyDetailSchema>;

export const personCopySchema = z.object({
  id: idSchema,
  person: personRefSchema,
  status: statusSchema,
  serviceDate: z.string(),
  submittedAt: z.string().nullable(),
  canDecide: z.boolean(),
  canCancel: z.boolean(),
  canDefer: z.boolean(),
});
export type PersonCopy = z.infer<typeof personCopySchema>;

export const taskDetailSchema = taskRowSchema.extend({
  repeatWeekdays: z.array(z.number()),
  repeatMonthDay: z.number().nullable(),
  repeatStartDate: z.string(),
  repeatEndDate: z.string().nullable(),
  closesAfterMinutes: z.number().nullable().optional(),
  approverMode: z.enum(APPROVER_MODES),
  approver: z.object({ id: idSchema, fullName: z.string() }).nullable(),
  subtasks: z.array(
    z.object({
      id: idSchema,
      title: z.string(),
      assignee: z.object({ id: idSchema, fullName: z.string() }).nullable(),
    }),
  ),
  watchers: z
    .array(z.object({ person: personRefSchema, access: z.enum(WATCHER_ACCESS) }))
    .optional(),
  parentMessage: z
    .object({
      templateId: idSchema,
      templateName: z.string(),
      body: z.string(),
      className: z.string(),
    })
    .nullable(),
  targetSummary: z.string(),
  target: targetSchema.nullable(),
  fromTemplateId: idSchema.nullable(),
  people: z.array(personCopySchema),
  myCopy: copyDetailSchema.nullable(),
  can: z.object({
    edit: z.boolean(),
    cancel: z.boolean(),
    /** Seeing everyone's copies, not only your own. */
    seePeople: z.boolean(),
  }),
});
export type TaskDetail = z.infer<typeof taskDetailSchema>;

/** Result of creating a task. */
export const createdTaskSchema = z.object({ id: idSchema, assigned: z.number() });

/** Result of editing a task: what happened to copies already handed out. */
export const updatedTaskSchema = z.object({
  id: idSchema,
  updatedCopies: z.number(),
  keptCopies: z.number(),
  addedCopies: z.number(),
  removedCopies: z.number(),
});
export type UpdatedTask = z.infer<typeof updatedTaskSchema>;

export const targetPreviewResultSchema = z.object({
  count: z.number(),
  sample: z.array(z.string()),
  limit: z.number(),
  /** Holidays on the chosen date for some of these people, e.g. "Diwali (Jubilee Hills)". */
  holidays: z.array(z.object({ name: z.string(), people: z.number() })).default([]),
});

export const assignablePersonSchema = personRefSchema.extend({ roleName: z.string() });
export type AssignablePerson = z.infer<typeof assignablePersonSchema>;
