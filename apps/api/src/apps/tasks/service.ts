import { isDeepStrictEqual } from 'node:util';
import {
  firstCopy,
  includesNewJoiners,
  isHoliday,
  isOpen,
  listFieldKey,
  planDates,
  taskRecordSchema,
  toPage,
  zonedInstant,
} from '@kidzonia/shared';
import type {
  Access,
  CreateTaskInput,
  DueRule,
  IsoDate,
  PlannedCopy,
  RecordFacts,
  Target,
  TaskRecordInput,
  UpdateTaskInput,
} from '@kidzonia/shared';
import type { z } from 'zod';
import type { peopleQuerySchema, taskListQuerySchema } from '@kidzonia/shared';
import { DbNull, mapDbError, withUnitOfWork } from '../../db/index.js';
import type { Prisma, ScopedTx, UnitOfWork } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import type { AuthInfo } from '../../http/types.js';
import {
  AppError,
  businessRule,
  conflict,
  invalidInput,
  notAllowed,
  notFound,
} from '../../lib/errors.js';
import { checkWritableFields, requireModule, requireWritable } from '../../core/guards.js';
import { emit } from '../../core/outbox.js';
import type { OutboxEvent } from '../../core/outbox.js';
import { userScopeWhere } from '../../core/users/facts.js';
import { fromIsoDate, loadCalendars, toIsoDate } from './calendars.js';
import type { Calendars } from './calendars.js';
import {
  canCancelCopy,
  COPY_SELECT_LITE,
  currentCopies,
  factsOfCopyLite,
  LIVE_STATUSES,
  presentCopyDetail,
  progressOf,
} from './copies-core.js';
import { copyScopeWhere, creatorFacts, taskFacts } from './facts.js';
import { UNTOUCHED } from './schedule.js';
import {
  approverCandidate,
  canWork,
  loadPeople,
  resolveApprover,
  resolveTarget,
} from './people.js';
import type { People, Person } from './people.js';
import {
  COPY_SELECT,
  describeTarget,
  listProps,
  loadChoices,
  parentMessageSchema,
  parseCustomValues,
  parseTarget,
  personRefOf,
  TASK_SELECT,
  watcherRefs,
} from './records.js';
import type { Snapshot, TaskRowData } from './records.js';

type ListQuery = z.output<typeof taskListQuerySchema>;
type PeopleQuery = z.output<typeof peopleQuerySchema>;

const TASKS = 'tasks';
/** Rows per insert when handing out copies; all in one transaction. */
const INSERT_CHUNK = 500;

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

/** The record props each input key writes, for field permission checks. */
function propsOf(
  key: keyof TaskRecordInput,
  before: TaskRecordInput | null,
  after: TaskRecordInput,
) {
  if (key === 'customValues') {
    const a = before?.customValues ?? {};
    const b = after.customValues;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((listId) => (a[listId] ?? null) !== (b[listId] ?? null))
      .map(listFieldKey);
  }
  return [key];
}

function dueRuleOf(v: TaskRecordInput, today: IsoDate): DueRule {
  return {
    dueType: v.dueType,
    dueTime: v.dueTime,
    dueDate: v.dueDate,
    repeat: v.repeat,
    repeatWeekdays: v.repeatWeekdays,
    repeatMonthDay: v.repeatMonthDay,
    repeatStartDate: v.repeatStartDate ?? today,
    repeatEndDate: v.repeatEndDate,
    closesAfterMinutes: v.closesAfterMinutes,
  };
}

/** A stored task in input shape, for merging with a partial update. */
function inputOf(t: TaskRowData): TaskRecordInput {
  const pm = parentMessageSchema.parse(t.parentMessage);
  return {
    title: t.title,
    description: t.description,
    categoryId: t.categoryId,
    priorityId: t.priorityId,
    customValues: parseCustomValues(t.customValues),
    dueType: t.dueType,
    dueTime: t.dueTime,
    dueDate: t.dueDate ? toIsoDate(t.dueDate) : null,
    repeat: t.repeat,
    repeatWeekdays: t.repeatWeekdays,
    repeatMonthDay: t.repeatMonthDay,
    repeatStartDate: toIsoDate(t.repeatStartDate),
    repeatEndDate: t.repeatEndDate ? toIsoDate(t.repeatEndDate) : null,
    closesAfterMinutes: t.closesAfterMinutes,
    needsApproval: t.needsApproval,
    approverMode: t.approverMode,
    approverUserId: t.approverUserId,
    blocksLogout: t.blocksLogout,
    parentMessage: pm,
    subtasks: t.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      assigneeUserId: s.assigneeUserId,
    })),
    watchers: t.watchers.map((w) => ({ userId: w.userId, access: w.access })),
    target: parseTarget(t.target),
  };
}

/** The task columns an input writes. */
function taskData(v: TaskRecordInput, today: IsoDate) {
  return {
    title: v.title,
    description: v.description,
    categoryId: v.categoryId,
    priorityId: v.priorityId,
    customValues: json(
      Object.fromEntries(Object.entries(v.customValues).filter((e) => e[1] !== null)),
    ),
    dueType: v.dueType,
    dueTime: v.dueType === 'end_of_day' ? null : v.dueTime,
    dueDate: v.dueDate ? fromIsoDate(v.dueDate) : null,
    repeat: v.repeat,
    repeatWeekdays: v.repeat === 'weekly' ? v.repeatWeekdays : [],
    repeatMonthDay: v.repeat === 'monthly' ? v.repeatMonthDay : null,
    repeatStartDate: fromIsoDate(v.repeatStartDate ?? today),
    repeatEndDate: v.repeatEndDate ? fromIsoDate(v.repeatEndDate) : null,
    closesAfterMinutes: v.closesAfterMinutes,
    needsApproval: v.needsApproval,
    approverMode: v.approverMode,
    approverUserId: v.needsApproval && v.approverMode === 'named_user' ? v.approverUserId : null,
    blocksLogout: v.blocksLogout,
    parentMessage: v.parentMessage ? json(v.parentMessage) : DbNull,
    target: json({ ...v.target, includeNewJoiners: includesNewJoiners(v.target) }),
  };
}

interface TaskContext {
  task: TaskRowData;
  copies: CopyLite[];
  facts: RecordFacts;
}

export type CopyLite = Prisma.TaskAssignmentGetPayload<{ select: typeof COPY_SELECT_LITE }>;

export class TasksService {
  constructor(private readonly deps: AppDeps) {}

  private get max(): number {
    return this.deps.config.TASK_MAX_RECIPIENTS;
  }

  // ---------- reading one task ----------

  private async loadContext(tx: ScopedTx, id: string): Promise<TaskContext | null> {
    const task = await tx.task.findFirst({ where: { id }, select: TASK_SELECT });
    if (!task) return null;
    const copies = await tx.taskAssignment.findMany({
      where: { taskId: id },
      select: COPY_SELECT_LITE,
      orderBy: [{ serviceDate: 'asc' }, { id: 'asc' }],
    });
    return { task, copies, facts: this.factsOf(task, copies) };
  }

  private factsOf(task: TaskRowData, copies: readonly CopyLite[]): RecordFacts {
    return taskFacts({
      createdBy: task.createdBy,
      creatorSchoolId: task.creator.homeSchoolId,
      approverUserId:
        task.needsApproval && task.approverMode === 'named_user' ? task.approverUserId : null,
      watchers: watcherRefs(task.watchers),
      subtaskAssigneeIds: task.subtasks
        .map((s) => s.assigneeUserId)
        .filter((x): x is string => x !== null),
      copies,
    });
  }

  /** What the viewer may do to the task itself. */
  private powers(access: Access, task: TaskRowData) {
    const me = access.userId;
    const writable = !access.readOnly && task.cancelledAt === null;
    const isCreator = task.createdBy === me;
    const overCreator = creatorFacts(task.createdBy, task.creator.homeSchoolId);
    const watcher = task.watchers.find((w) => w.userId === me);
    // Reach over whoever made the task, not over one of its people: a principal
    // can't rewrite a head-office task because it reached their teachers.
    const roleEdit = !isCreator && access.can(TASKS, 'edit', overCreator);
    const creatorEdit =
      isCreator && (access.can(TASKS, 'edit', overCreator) || access.can(TASKS, 'create'));
    return {
      edit: writable && (creatorEdit || roleEdit || watcher?.access === 'edit'),
      retarget: writable && (creatorEdit || roleEdit),
      cancel: writable && (isCreator || access.can(TASKS, 'delete', overCreator)),
      seePeople:
        isCreator ||
        watcher !== undefined ||
        task.approverUserId === me ||
        access.primary.role?.isOwner === true,
    };
  }

  private async visibleContext(auth: AuthInfo, id: string) {
    const access = await auth.access();
    const ctx = await this.loadContext(auth.db, id);
    if (!ctx || !access.can(TASKS, 'view', ctx.facts)) throw notFound('That task');
    return { access, ctx };
  }

  /** The copies the viewer may see on a task: all of them, or those in reach. */
  private visibleCopies(access: Access, ctx: TaskContext): CopyLite[] {
    if (this.powers(access, ctx.task).seePeople) return ctx.copies;
    return ctx.copies.filter((c) => access.can(TASKS, 'view', factsOfCopyLite(c, ctx.task)));
  }

  async detail(auth: AuthInfo, id: string, copyId: string | null) {
    const { access, ctx } = await this.visibleContext(auth, id);
    const { task } = ctx;
    const today = (await loadCalendars(auth.db, this.deps.now())).today;
    const visible = this.visibleCopies(access, ctx);
    const current = currentCopies(visible, today);
    const powers = this.powers(access, task);

    // Your work: the copy asked for (e.g. from Approvals), else your own current one.
    let copyRow = null;
    if (copyId) {
      if (!visible.some((c) => c.id === copyId)) throw notFound('That task');
      copyRow = await auth.db.taskAssignment.findFirst({
        where: { id: copyId },
        select: COPY_SELECT,
      });
    } else {
      const mine = currentCopies(
        ctx.copies.filter((c) => c.userId === access.userId),
        today,
      )[0];
      if (mine) {
        copyRow = await auth.db.taskAssignment.findFirst({
          where: { id: mine.id },
          select: COPY_SELECT,
        });
      }
    }
    const choices = await loadChoices(auth.db, [task.customValues]);
    const myCopy = copyRow ? await presentCopyDetail(auth.db, access, copyRow, choices) : null;

    const [roles, schools, template] = await Promise.all([
      auth.db.role.findMany({ select: { id: true, name: true } }),
      auth.db.school.findMany({ select: { id: true, name: true } }),
      this.messageTemplate(auth.db, task.parentMessage),
    ]);
    const target = parseTarget(task.target);
    const record = {
      ...this.rowRecord(task, progressOf(current), choices),
      repeatWeekdays: task.repeatWeekdays,
      repeatMonthDay: task.repeatMonthDay,
      repeatStartDate: toIsoDate(task.repeatStartDate),
      repeatEndDate: task.repeatEndDate ? toIsoDate(task.repeatEndDate) : null,
      closesAfterMinutes: task.closesAfterMinutes,
      approverMode: task.approverMode,
      approver: task.approver,
      subtasks: task.subtasks.map((s) => ({ id: s.id, title: s.title, assignee: s.assignee })),
      watchers: task.watchers.map((w) => ({ person: personRefOf(w.user), access: w.access })),
      parentMessage: template,
      targetSummary: describeTarget(target, {
        roles: new Map(roles.map((r) => [r.id, r.name])),
        schools: new Map(schools.map((s) => [s.id, s.name])),
      }),
      // Who a task is for is only for people who can change it.
      target: powers.retarget ? target : null,
      fromTemplateId: task.fromTemplateId,
      people: current
        .map((c) => ({
          id: c.id,
          person: personRefOf(c.user),
          status: c.status,
          serviceDate: toIsoDate(c.serviceDate),
          submittedAt: c.submittedAt?.toISOString() ?? null,
          canDecide:
            !access.readOnly && c.status === 'submitted' && c.approverUserId === access.userId,
          canCancel:
            !access.readOnly &&
            (LIVE_STATUSES as readonly string[]).includes(c.status) &&
            canCancelCopy(access, task.createdBy, c),
          // Defer follows the cancel rule, for work still owed (brief 9.7).
          canDefer:
            !access.readOnly && isOpen(c.status) && canCancelCopy(access, task.createdBy, c),
        }))
        .sort((a, b) => a.person.fullName.localeCompare(b.person.fullName)),
      myCopy,
      can: {
        edit: powers.edit,
        cancel: powers.cancel,
        seePeople: powers.seePeople || visible.length > 1,
      },
    };
    return access.serialize(TASKS, record, ctx.facts);
  }

  private async messageTemplate(tx: ScopedTx, raw: Prisma.JsonValue) {
    const pm = parentMessageSchema.parse(raw);
    if (!pm) return null;
    const t = await tx.parentMessageTemplate.findFirst({
      where: { id: pm.templateId },
      select: { id: true, name: true, body: true },
    });
    return t
      ? { templateId: t.id, templateName: t.name, body: t.body, className: pm.className }
      : null;
  }

  /** A task list row in API shape, before field permissions. */
  private rowRecord(
    t: TaskRowData,
    progress: ReturnType<typeof progressOf>,
    choices: Awaited<ReturnType<typeof loadChoices>>,
  ) {
    return {
      id: t.id,
      kind: t.kind,
      repeat: t.repeat,
      // Day-end reports show the form's name as "Assigned by" (Phase 4 answer 5).
      creator: t.dayEndForm
        ? { id: t.createdBy, fullName: t.dayEndForm.name, jobTitle: null, schoolName: null }
        : personRefOf(t.creator),
      createdBy: t.createdBy,
      progress,
      needsApproval: t.needsApproval,
      blocksLogout: t.blocksLogout,
      createdAt: t.createdAt.toISOString(),
      cancelledAt: t.cancelledAt?.toISOString() ?? null,
      title: t.title,
      description: t.description,
      categoryId: t.categoryId,
      category: t.category,
      priorityId: t.priorityId,
      priority: t.priority,
      dueType: t.dueType,
      dueTime: t.dueTime,
      dueDate: t.dueDate ? toIsoDate(t.dueDate) : null,
      ...listProps(t.customValues, choices),
    };
  }

  // ---------- lists: Assigned by me, My team, Watching ----------

  async list(auth: AuthInfo, q: ListQuery) {
    const access = await auth.access();
    requireModule(access, TASKS, 'view');
    const me = access.userId;
    const and: Prisma.TaskWhereInput[] = [{ kind: 'task' }];
    let copyFilter: Prisma.TaskAssignmentWhereInput = {};

    if (q.view === 'byme') {
      and.push({ createdBy: me });
    } else if (q.view === 'watching') {
      and.push({ watchers: { some: { userId: me } } });
    } else {
      // My team: tasks given to people in my reach, other than me.
      const scoped: Prisma.TaskAssignmentWhereInput = {
        AND: [
          { userId: { not: me } },
          ...access
            .scopes(TASKS)
            .map(copyScopeWhere)
            .filter((w) => Object.keys(w).length > 0),
        ],
      };
      and.push({ assignments: { some: scoped } });
      copyFilter = scoped;
    }

    // Hidden fields can't be searched, filtered or sorted on (as in Users).
    const visible = (field: string) => access.fieldAccess(TASKS, field) !== 'hidden';
    if (q.q) {
      const or: Prisma.TaskWhereInput[] = [];
      if (visible('title')) or.push({ title: { contains: q.q, mode: 'insensitive' } });
      if (visible('description')) or.push({ description: { contains: q.q, mode: 'insensitive' } });
      and.push(or.length > 0 ? { OR: or } : { id: { in: [] } });
    }
    if (q.categoryId) {
      if (!visible('category')) throw invalidInput('You can’t filter by category.');
      and.push({ categoryId: q.categoryId });
    }
    if (q.priorityId) {
      if (!visible('priority')) throw invalidInput('You can’t filter by priority.');
      and.push({ priorityId: q.priorityId });
    }
    if (q.listValue) {
      const [listId = '', valueId = ''] = q.listValue.split(':');
      const key = listFieldKey(listId);
      if (
        !access.primary.registry.module(TASKS).fields?.some((f) => f.key === key) ||
        !visible(key)
      ) {
        throw invalidInput('You can’t filter by that list.');
      }
      and.push({ customValues: { path: [listId], equals: valueId } });
    }
    if (q.sort === 'priority' && !visible('priority'))
      throw invalidInput('You can’t sort by that.');

    const rows = await auth.db.task.findMany({
      where: { AND: and },
      select: TASK_SELECT,
      orderBy:
        q.sort === 'priority'
          ? [{ priority: { sortOrder: 'asc' } }, { createdAt: 'desc' }, { id: 'desc' }]
          : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, q.limit);
    const ids = page.items.map((t) => t.id);
    const [copies, choices, cals] = await Promise.all([
      auth.db.taskAssignment.findMany({
        where: { AND: [{ taskId: { in: ids } }, copyFilter] },
        select: COPY_SELECT_LITE,
      }),
      loadChoices(
        auth.db,
        page.items.map((t) => t.customValues),
      ),
      loadCalendars(auth.db, this.deps.now()),
    ]);
    const byTask = new Map<string, CopyLite[]>();
    for (const c of copies) byTask.set(c.taskId, [...(byTask.get(c.taskId) ?? []), c]);

    const items = page.items
      .map((t) => {
        const own = byTask.get(t.id) ?? [];
        const facts = this.factsOf(t, own);
        if (!access.can(TASKS, 'view', facts)) return null;
        const current = currentCopies(own, cals.today);
        return access.serialize(TASKS, this.rowRecord(t, progressOf(current), choices), facts);
      })
      .filter((x) => x !== null);
    return { items, nextCursor: page.nextCursor };
  }

  // ---------- pickers ----------

  /** Roles and schools for the "All [role] at [school]" quick-add. */
  async targetOptions(auth: AuthInfo) {
    const access = await auth.access();
    requireModule(access, TASKS, 'create');
    const canAssign = access.can(TASKS, 'assign');
    if (!canAssign) return { canAssign, roles: [], schools: [] };
    const scopes = access.contexts.map((c) =>
      c.role?.isOwner || c.scope.allSchools ? {} : { id: { in: [...c.scope.schoolIds] } },
    );
    const [roles, schools] = await Promise.all([
      auth.db.role.findMany({
        where: { deletedAt: null, isOwner: false },
        select: { id: true, name: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      auth.db.school.findMany({
        where: { AND: [{ deletedAt: null }, ...scopes] },
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return { canAssign, roles, schools };
  }

  /** People the viewer can give tasks to (themselves included), paginated. */
  async assignablePeople(auth: AuthInfo, q: PeopleQuery) {
    const access = await auth.access();
    requireModule(access, TASKS, 'create');
    // Prisma reads an empty clause inside OR as "match nothing", so a scope
    // meaning "everyone" ({}) is dropped rather than nested.
    const scopes = access
      .scopes(TASKS, 'assign')
      .map(userScopeWhere)
      .filter((w) => Object.keys(w).length > 0);
    return this.people(
      auth,
      q,
      scopes.length === 0 ? [] : [{ OR: [{ id: access.userId }, { AND: scopes }] }],
    );
  }

  /** Anyone who can do tasks: watchers and named approvers may come from any department. */
  async anyone(auth: AuthInfo, q: PeopleQuery) {
    const access = await auth.access();
    requireModule(access, TASKS, 'create');
    return this.people(auth, q, []);
  }

  private async people(auth: AuthInfo, q: PeopleQuery, and: Prisma.UserWhereInput[]) {
    const rows = await auth.db.user.findMany({
      where: {
        AND: [
          { deletedAt: null, status: { not: 'inactive' }, roleAssignment: { isNot: null } },
          ...(q.q ? [{ fullName: { contains: q.q, mode: 'insensitive' as const } }] : []),
          ...and,
        ],
      },
      select: {
        id: true,
        fullName: true,
        jobTitle: true,
        homeSchool: { select: { name: true } },
        roleAssignment: { select: { role: { select: { name: true } } } },
      },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, q.limit);
    return {
      items: page.items.map((u) => ({
        ...personRefOf(u),
        roleName: u.roleAssignment?.role.name ?? '',
      })),
      nextCursor: page.nextCursor,
    };
  }

  // ---------- creating ----------

  /** People and names needed to check a target. */
  private async targetInputs(tx: ScopedTx) {
    const [people, roles, schools] = await Promise.all([
      loadPeople(tx),
      tx.role.findMany({ where: { deletedAt: null }, select: { id: true } }),
      tx.school.findMany({ where: { deletedAt: null }, select: { id: true } }),
    ]);
    return {
      people,
      liveRoles: new Set(roles.map((r) => r.id)),
      liveSchools: new Set(schools.map((s) => s.id)),
    };
  }

  private resolve(
    access: Access,
    inputs: Awaited<ReturnType<TasksService['targetInputs']>>,
    target: Target,
  ) {
    const resolved = resolveTarget(
      access,
      inputs.people,
      target,
      inputs.liveRoles,
      inputs.liveSchools,
    );
    if (resolved.people.length === 0) {
      throw new AppError('business_rule', 'No one you can give tasks to matches who you chose.', {
        target: 'No one matches.',
      });
    }
    if (resolved.people.length > this.max) {
      throw new AppError(
        'business_rule',
        `This would go to ${String(resolved.people.length)} people. One task can go to at most ${String(this.max)}.`,
        { target: 'Too many people.' },
      );
    }
    return resolved.people;
  }

  async previewTarget(auth: AuthInfo, target: Target, dueDate: string | null = null) {
    const access = await auth.access();
    requireModule(access, TASKS, 'create');
    const inputs = await this.targetInputs(auth.db);
    const found = resolveTarget(
      access,
      inputs.people,
      target,
      inputs.liveRoles,
      inputs.liveSchools,
    );
    // Phase 4 answer 1: a one-time task on a holiday is kept, so warn before saving.
    const holidays = new Map<string, number>();
    if (dueDate) {
      const cals = await loadCalendars(auth.db, this.deps.now(), { from: dueDate, to: dueDate });
      const names = await auth.db.holiday.findMany({
        where: {
          deletedAt: null,
          startDate: { lte: fromIsoDate(dueDate) },
          endDate: { gte: fromIsoDate(dueDate) },
        },
        select: { name: true },
      });
      const name = names.map((h) => h.name).join(', ') || 'A holiday';
      for (const p of found.people) {
        if (isHoliday(cals.forSchool(p.homeSchoolId), dueDate)) {
          holidays.set(name, (holidays.get(name) ?? 0) + 1);
        }
      }
    }
    return {
      count: found.people.length,
      sample: found.people.slice(0, 5).map((p) => p.fullName),
      limit: this.max,
      holidays: [...holidays.entries()].map(([name, people]) => ({ name, people })),
    };
  }

  /**
   * Creating a task with a field the role hides, or explicitly makes
   * view-only, is refused. (A role without the Edit action can still fill in
   * a new task's details: creating is its own action.)
   */
  private assertCreatableFields(access: Access, input: CreateTaskInput, defaults: TaskRecordInput) {
    const ctx = access.primary;
    if (ctx.role?.isOwner) return;
    const mod = ctx.registry.module(TASKS);
    const denied: string[] = [];
    for (const key of Object.keys(defaults) as (keyof TaskRecordInput)[]) {
      if (key !== 'title' && isDeepStrictEqual(input[key], defaults[key])) continue;
      for (const prop of propsOf(key, defaults, input)) {
        const field = (mod.fields ?? []).find((f) => (f.props ?? [f.key]).includes(prop));
        if (!field) continue;
        const rule = ctx.role?.fields[TASKS]?.[field.key];
        if (
          rule &&
          (rule.access === 'hidden' || (rule.access === 'view' && rule.ownRecord !== 'edit'))
        ) {
          denied.push(prop);
        }
      }
    }
    if (denied.length > 0) {
      throw new AppError(
        'not_allowed',
        'Your role doesn’t let you set some of these details.',
        Object.fromEntries(denied.map((p) => [p, 'You can’t set this.'])),
      );
    }
  }

  /** Categories, lists, templates, approvers, watchers and sub-task people exist and can act. */
  private async assertReferences(
    tx: ScopedTx,
    access: Access,
    people: People,
    v: TaskRecordInput,
    before: TaskRecordInput | null,
  ) {
    const changed = (k: keyof TaskRecordInput) => !before || !isDeepStrictEqual(before[k], v[k]);
    if (v.categoryId && changed('categoryId')) {
      const ok = await tx.taskCategory.count({ where: { id: v.categoryId, archivedAt: null } });
      if (!ok)
        throw invalidInput('That category no longer exists.', {
          categoryId: 'Pick another category.',
        });
    }
    if (v.priorityId && changed('priorityId')) {
      const ok = await tx.taskPriority.count({ where: { id: v.priorityId, archivedAt: null } });
      if (!ok)
        throw invalidInput('That priority no longer exists.', {
          priorityId: 'Pick another priority.',
        });
    }
    const values = Object.entries(v.customValues).filter(
      (e): e is [string, string] => e[1] !== null && (before?.customValues[e[0]] ?? null) !== e[1],
    );
    if (values.length > 0) {
      const found = await tx.taskListValue.findMany({
        where: {
          id: { in: values.map((e) => e[1]) },
          archivedAt: null,
          list: { archivedAt: null },
        },
        select: { id: true, listId: true },
      });
      const ok = values.every(([listId, valueId]) =>
        found.some((f) => f.id === valueId && f.listId === listId),
      );
      if (!ok)
        throw invalidInput('One of the list values no longer exists.', {
          customValues: 'Pick again.',
        });
    }
    if (v.parentMessage && changed('parentMessage')) {
      const ok = await tx.parentMessageTemplate.count({
        where: { id: v.parentMessage.templateId, archivedAt: null },
      });
      if (!ok)
        throw invalidInput('That message template no longer exists.', {
          parentMessage: 'Pick another.',
        });
    }
    if (v.needsApproval && v.approverMode === 'named_user' && changed('approverUserId')) {
      if (!canWork(people.get(v.approverUserId ?? ''))) {
        throw businessRule('Choose an approver who is active and has a role.', {
          approverUserId: 'Choose someone active.',
        });
      }
    }
    if (changed('watchers')) {
      for (const w of v.watchers) {
        const p = people.get(w.userId);
        if (!canWork(p)) {
          throw businessRule('Watchers must be active and have a role.', {
            watchers: 'Remove them.',
          });
        }
      }
    }
    for (const s of v.subtasks) {
      const prior = before?.subtasks.find((x) => x.id === s.id);
      if (!s.assigneeUserId || prior?.assigneeUserId === s.assigneeUserId) continue;
      const p = people.get(s.assigneeUserId);
      const inReach =
        p?.id === access.userId ||
        (p !== undefined &&
          access.can(TASKS, 'assign', {
            subjectUserIds: [p.id],
            schoolIds: p.homeSchoolId ? [p.homeSchoolId] : [],
          }));
      if (!canWork(p) || !inReach) {
        throw businessRule('A sub-task’s person must be someone you can give tasks to.', {
          subtasks: 'Choose someone you can give tasks to.',
        });
      }
    }
  }

  /** The copies one person should have under a rule (the first one when nothing else is planned). */
  private planFor(
    rule: DueRule,
    cals: Calendars,
    person: Person,
    horizon: IsoDate,
    now: Date,
  ): PlannedCopy[] {
    const cal = cals.forSchool(person.homeSchoolId);
    if (rule.repeat !== 'none') {
      const within = planDates(rule, cal, cals.today, horizon, now);
      if (within.length > 0) return within;
    }
    const first = firstCopy(rule, cal, cals.today, now);
    return first ? [first] : [];
  }

  private assertTimesPossible(v: TaskRecordInput, cals: Calendars, now: Date) {
    if (v.repeat !== 'none') return;
    if (v.dueType === 'on_date' && v.dueDate && v.dueDate < cals.today) {
      throw invalidInput('That date has passed.', { dueDate: 'Pick today or later.' });
    }
    if (v.dueType === 'at_time' && v.dueTime && (v.repeatStartDate ?? cals.today) === cals.today) {
      if (zonedInstant(cals.today, v.dueTime, cals.timezone) <= now) {
        throw invalidInput('That time has already passed today.', {
          dueTime: 'Pick a later time, or a date.',
        });
      }
    }
  }

  private copyRow(
    organisationId: string,
    taskId: string,
    v: TaskRecordInput,
    people: People,
    createdBy: string,
    person: Person,
    planned: PlannedCopy,
    snapshot: Snapshot,
  ) {
    const approver = v.needsApproval
      ? resolveApprover(
          people,
          approverCandidate(
            v.approverMode,
            { createdBy, approverUserId: v.approverUserId },
            person,
          ),
          person.id,
        )
      : null;
    return {
      organisationId,
      taskId,
      userId: person.id,
      schoolId: person.homeSchoolId,
      serviceDate: fromIsoDate(planned.serviceDate),
      dueAt: planned.dueAt,
      closesAt: planned.closesAt,
      // Nobody to approve (an Owner's own work): the copy completes without approval.
      needsApproval: approver !== null,
      approverUserId: approver,
      blocksLogout: v.blocksLogout,
      snapshot: json(snapshot),
    };
  }

  private async insertCopies(uow: UnitOfWork, rows: ReturnType<TasksService['copyRow']>[]) {
    let n = 0;
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const made = await uow.tx.taskAssignment.createManyAndReturn({
        data: rows.slice(i, i + INSERT_CHUNK),
        // Insert-if-not-exists on (task, person, date): safe to run twice (brief 9.5).
        skipDuplicates: true,
        select: { id: true },
      });
      n += made.length;
    }
    return n;
  }

  async create(auth: AuthInfo, input: CreateTaskInput) {
    const access = await auth.access();
    requireWritable(access);
    requireModule(access, TASKS, 'create');
    const { fromTemplateId, ...record } = input;
    const defaults = taskRecordSchema.parse({
      ...record,
      title: record.title,
      description: null,
      categoryId: null,
      priorityId: null,
      customValues: {},
      dueType: 'end_of_day',
      dueTime: null,
      dueDate: null,
      repeat: 'none',
      repeatWeekdays: [],
      repeatMonthDay: null,
      repeatStartDate: null,
      repeatEndDate: null,
      closesAfterMinutes: null,
      needsApproval: false,
      approverMode: 'creator',
      approverUserId: null,
      blocksLogout: false,
      parentMessage: null,
      subtasks: [],
      watchers: [],
    });
    this.assertCreatableFields(access, input, defaults);
    if (record.watchers.some((w) => w.userId === access.userId)) {
      throw businessRule('You follow your own tasks already; remove yourself as a watcher.');
    }
    const now = this.deps.now();
    const tx = auth.db;
    const [inputs, cals] = await Promise.all([this.targetInputs(tx), loadCalendars(tx, now)]);
    const targets = this.resolve(access, inputs, record.target);
    await this.assertReferences(tx, access, inputs.people, record, null);
    this.assertTimesPossible(record, cals, now);
    const rule = dueRuleOf(record, cals.today);
    const planned = targets.flatMap((person) => {
      const copy = firstCopy(rule, cals.forSchool(person.homeSchoolId), cals.today, now);
      return copy ? [{ person, copy }] : [];
    });
    if (planned.length === 0) {
      throw businessRule(
        'This task doesn’t fall on a working day in the next two months. Check when it repeats.',
      );
    }

    return withUnitOfWork(
      tx,
      auth.actor,
      async (uow) => {
        const task = await uow.tx.task.create({
          data: {
            organisationId: auth.organisationId,
            ...taskData(record, cals.today),
            fromTemplateId,
            createdBy: auth.userId,
            generatedThrough: fromIsoDate(
              planned
                .map((p) => p.copy.serviceDate)
                .sort()
                .at(-1) ?? cals.today,
            ),
          },
          select: { id: true, createdBy: true },
        });
        uow.act('task', task.id, 'assigned');
        const subtasks = await this.writeSubtasks(uow, auth.organisationId, task.id, record, []);
        if (record.watchers.length > 0) {
          await uow.tx.taskWatcher.createMany({
            data: record.watchers.map((w) => ({
              organisationId: auth.organisationId,
              taskId: task.id,
              userId: w.userId,
              access: w.access,
              createdBy: auth.userId,
            })),
          });
        }
        const snapshot = this.snapshotOf(record, subtasks);
        const assigned = await this.insertCopies(
          uow,
          planned.map((p) =>
            this.copyRow(
              auth.organisationId,
              task.id,
              record,
              inputs.people,
              auth.userId,
              p.person,
              p.copy,
              snapshot,
            ),
          ),
        );
        await this.tell(
          uow,
          auth.organisationId,
          task.id,
          planned.map((p) => p.person.id),
          record.watchers.map((w) => w.userId),
          auth.userId,
        );
        return { id: task.id, assigned };
      },
      { timeoutMs: 60_000 },
    );
  }

  /** Brief 10.1: task_assigned to new people, watcher_added to new watchers. */
  private async tell(
    uow: UnitOfWork,
    organisationId: string,
    taskId: string,
    people: readonly string[],
    watchers: readonly string[],
    by: string,
  ) {
    const events: OutboxEvent[] = [
      ...[...new Set(people)]
        .filter((u) => u !== by)
        .map((u): OutboxEvent => ({
          event: 'task_assigned',
          recipientUserId: u,
          entityType: 'task',
          entityId: taskId,
          dedupeKey: `task_assigned:${taskId}:${u}`,
          payload: { by },
        })),
      ...[...new Set(watchers)].map((u): OutboxEvent => ({
        event: 'watcher_added',
        recipientUserId: u,
        entityType: 'task',
        entityId: taskId,
        dedupeKey: `watcher_added:${taskId}:${u}`,
        payload: { by },
      })),
    ];
    await emit(uow.tx, organisationId, events);
  }

  private snapshotOf(
    v: TaskRecordInput,
    subtasks: readonly {
      id: string;
      title: string;
      sortOrder: number;
      assigneeUserId: string | null;
    }[],
  ): Snapshot {
    return {
      title: v.title,
      description: v.description,
      subtasks: subtasks.map((s) => ({
        id: s.id,
        title: s.title,
        order: s.sortOrder,
        assigneeUserId: s.assigneeUserId,
      })),
    };
  }

  /**
   * Makes the task's sub-tasks match the input: existing ones are updated,
   * new ones created, missing ones marked removed (never deleted, because
   * copies already handed out still point at them).
   */
  private async writeSubtasks(
    uow: UnitOfWork,
    organisationId: string,
    taskId: string,
    v: TaskRecordInput,
    existing: readonly { id: string }[],
  ) {
    const keep = new Set(v.subtasks.map((s) => s.id).filter((x): x is string => x !== undefined));
    for (const s of v.subtasks) {
      if (s.id && !existing.some((e) => e.id === s.id)) {
        throw invalidInput('One of the sub-tasks doesn’t belong to this task.');
      }
    }
    const gone = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (gone.length > 0) {
      await uow.tx.taskSubtask.updateMany({
        where: { id: { in: gone } },
        data: { removedAt: this.deps.now() },
      });
    }
    const out: { id: string; title: string; sortOrder: number; assigneeUserId: string | null }[] =
      [];
    for (const [i, s] of v.subtasks.entries()) {
      const data = { title: s.title, sortOrder: i, assigneeUserId: s.assigneeUserId };
      const row = s.id
        ? await uow.tx.taskSubtask.update({
            where: { id: s.id },
            data,
            select: { id: true, title: true, sortOrder: true, assigneeUserId: true },
          })
        : await uow.tx.taskSubtask.create({
            data: { organisationId, taskId, ...data },
            select: { id: true, title: true, sortOrder: true, assigneeUserId: true },
          });
      out.push(row);
    }
    return out;
  }

  // ---------- editing ----------

  /**
   * PUT /tasks/:id (brief 9.5, decision 1). The task always changes. Copies
   * change only while untouched: status to-do and either a later date, or
   * today with the deadline still ahead. Anything started, submitted or
   * finished keeps the version the person worked from.
   */
  async update(auth: AuthInfo, id: string, patch: UpdateTaskInput) {
    const access = await auth.access();
    requireWritable(access);
    const { ctx } = await this.visibleContext(auth, id);
    const { task } = ctx;
    if (task.cancelledAt) throw conflict('This task was cancelled, so it can’t be changed.');
    const powers = this.powers(access, task);
    if (!powers.edit) throw notAllowed('You can’t change this task.');
    if (!powers.retarget && (patch.target !== undefined || patch.watchers !== undefined)) {
      throw notAllowed(
        'Only the person who set this task, or their managers, can change who it’s for.',
      );
    }

    const before = inputOf(task);
    const parsed = taskRecordSchema.safeParse({ ...before, ...patch });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw invalidInput(issue?.message ?? 'Please check the details.', {
        [issue?.path.map(String).join('.') ?? '_']: issue?.message ?? '',
      });
    }
    const after = parsed.data;
    const changedKeys = (Object.keys(after) as (keyof TaskRecordInput)[]).filter(
      (k) => !isDeepStrictEqual(before[k], after[k]),
    );
    if (changedKeys.length === 0) {
      return { id, updatedCopies: 0, keptCopies: 0, addedCopies: 0, removedCopies: 0 };
    }
    const props = changedKeys.flatMap((k) => propsOf(k, before, after));
    const pending = checkWritableFields(access, TASKS, props, ctx.facts);
    if (pending.length > 0) {
      throw businessRule(
        'Your role needs approval to change some of these details, which tasks don’t support.',
      );
    }
    if (after.watchers.some((w) => w.userId === task.createdBy)) {
      throw businessRule('The person who set the task already follows it.');
    }

    const now = this.deps.now();
    const tx = auth.db;
    const [inputs, cals] = await Promise.all([this.targetInputs(tx), loadCalendars(tx, now)]);
    await this.assertReferences(tx, access, inputs.people, after, before);
    if (
      changedKeys.some((k) =>
        ['dueType', 'dueTime', 'dueDate', 'repeat', 'repeatStartDate'].includes(k),
      )
    ) {
      this.assertTimesPossible(after, cals, now);
    }

    // Who it's for: re-resolved only when changed, and only with the editor's
    // reach; otherwise everyone who already has a copy stays.
    const targetChanged = changedKeys.includes('target');
    const targets = targetChanged
      ? this.resolve(access, inputs, after.target)
      : [...new Set(ctx.copies.map((c) => c.userId))]
          .map((u) => inputs.people.get(u))
          .filter((p): p is Person => p !== undefined);

    const untouched = (c: CopyLite) =>
      c.status === 'todo' &&
      (toIsoDate(c.serviceDate) > cals.today ||
        (toIsoDate(c.serviceDate) === cals.today && c.dueAt > now));
    const updatable = ctx.copies.filter(untouched);
    const horizon =
      updatable
        .map((c) => toIsoDate(c.serviceDate))
        .sort()
        .at(-1) ?? cals.today;
    const rule = dueRuleOf(after, toIsoDate(task.repeatStartDate));
    const plans = new Map(targets.map((p) => [p.id, this.planFor(rule, cals, p, horizon, now)]));
    await this.deps.testSeams?.beforeTaskEditWrites?.();

    return withUnitOfWork(
      tx,
      auth.actor,
      async (uow) => {
        await uow.tx.task.update({
          where: { id },
          data: {
            ...taskData(after, toIsoDate(task.repeatStartDate)),
            updatedBy: auth.userId,
          },
          select: { id: true, createdBy: true },
        });
        const subtasks = await this.writeSubtasks(
          uow,
          auth.organisationId,
          id,
          after,
          task.subtasks,
        );
        if (changedKeys.includes('watchers')) {
          await uow.tx.taskWatcher.deleteMany({ where: { taskId: id } });
          if (after.watchers.length > 0) {
            await uow.tx.taskWatcher.createMany({
              data: after.watchers.map((w) => ({
                organisationId: auth.organisationId,
                taskId: id,
                userId: w.userId,
                access: w.access,
                createdBy: auth.userId,
              })),
            });
          }
        }
        const snapshot = this.snapshotOf(after, subtasks);
        let updated = 0;
        let removed = 0;
        let startedMeanwhile = 0;
        const toInsert: ReturnType<TasksService['copyRow']>[] = [];
        const existingKeys = new Set(
          ctx.copies.map((c) => `${c.userId}:${toIsoDate(c.serviceDate)}`),
        );

        // `updatable` was read before this transaction; someone may have ticked,
        // answered or attached since. Every write below repeats the untouched
        // check in its own WHERE (as the schedule job does), so work started in
        // the meantime is never rewritten or removed (brief 9.5, lesson 14).
        for (const c of updatable) {
          const plan = plans.get(c.userId)?.find((p) => p.serviceDate === toIsoDate(c.serviceDate));
          const person = inputs.people.get(c.userId);
          if (!plan || !person) {
            try {
              await uow.tx.taskAssignment.delete({
                where: { id: c.id, ...UNTOUCHED },
                select: { id: true, taskId: true, userId: true, schoolId: true },
              });
              removed++;
            } catch (err) {
              // No longer untouched: someone started it meanwhile. Leave it.
              if (mapDbError(err)?.code !== 'not_found') throw err;
              startedMeanwhile++;
            }
            continue;
          }
          const row = this.copyRow(
            auth.organisationId,
            id,
            after,
            inputs.people,
            task.createdBy,
            person,
            plan,
            snapshot,
          );
          const done = await uow.tx.taskAssignment.updateManyAndReturn({
            where: { id: c.id, ...UNTOUCHED },
            data: {
              dueAt: row.dueAt,
              closesAt: row.closesAt,
              needsApproval: row.needsApproval,
              approverUserId: row.approverUserId,
              blocksLogout: row.blocksLogout,
              snapshot: row.snapshot,
            },
            select: { id: true, taskId: true, userId: true, schoolId: true },
          });
          if (done.length > 0) updated++;
          else startedMeanwhile++;
        }
        for (const person of targets) {
          for (const plan of plans.get(person.id) ?? []) {
            if (existingKeys.has(`${person.id}:${plan.serviceDate}`)) continue;
            toInsert.push(
              this.copyRow(
                auth.organisationId,
                id,
                after,
                inputs.people,
                task.createdBy,
                person,
                plan,
                snapshot,
              ),
            );
          }
        }
        const added = await this.insertCopies(uow, toInsert);
        const hadCopy = new Set(ctx.copies.map((c) => c.userId));
        const newWatchers = after.watchers
          .map((w) => w.userId)
          .filter((u) => !before.watchers.some((w) => w.userId === u));
        await this.tell(
          uow,
          auth.organisationId,
          id,
          toInsert.map((r) => r.userId).filter((u) => !hadCopy.has(u)),
          newWatchers,
          auth.userId,
        );
        const kept = ctx.copies.filter(
          (c) => !untouched(c) && (LIVE_STATUSES as readonly string[]).includes(c.status),
        ).length;
        return {
          id,
          updatedCopies: updated,
          keptCopies: kept + startedMeanwhile,
          addedCopies: added,
          removedCopies: removed,
        };
      },
      { timeoutMs: 60_000 },
    );
  }

  /** DELETE /tasks/:id: cancels the task and every copy still owed or waiting. */
  async cancel(auth: AuthInfo, id: string) {
    const access = await auth.access();
    requireWritable(access);
    const { ctx } = await this.visibleContext(auth, id);
    if (ctx.task.cancelledAt) throw conflict('This task was already cancelled.');
    if (!this.powers(access, ctx.task).cancel) throw notAllowed('You can’t cancel this task.');
    const now = this.deps.now();
    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      uow.act('task', id, 'cancelled');
      await uow.tx.task.update({
        where: { id },
        data: { cancelledAt: now, updatedBy: auth.userId },
        select: { id: true, createdBy: true },
      });
      await uow.tx.taskAssignment.updateManyAndReturn({
        where: { taskId: id, status: { in: [...LIVE_STATUSES] } },
        data: {
          status: 'cancelled',
          cancelReason: 'The task was cancelled.',
          cancelledBy: auth.userId,
          decidedAt: now,
        },
        select: { id: true, userId: true, schoolId: true },
      });
    });
  }
}
