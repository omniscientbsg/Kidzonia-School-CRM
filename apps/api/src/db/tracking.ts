import { AsyncLocalStorage } from 'node:async_hooks';
import { TenancyViolation } from './scope-args.js';

/**
 * Activity tracking (brief 10.3). Writes to tracked tables through the scoped
 * client are recorded automatically: the Prisma extension reports each write
 * here, and the unit of work stores the events in the same transaction.
 * Only who / what / which record is kept, never the record's contents.
 */

type Row = Record<string, unknown>;

interface Tracker {
  entityType: string;
  /** Columns the tracker reads; added to `select` so a narrow select can't hide them. */
  needs: readonly string[];
  entityId: (row: Row) => string | null;
  subjects: (row: Row) => string[];
  school: (row: Row) => string | null;
  orgWide?: boolean;
  /**
   * Rows of this table are recorded as part of a parent record: every write
   * in one unit of work becomes ONE activity row about the parent, with all
   * the people affected in subject_user_ids (GIN-indexed, so each person's
   * feed still finds it). A task sent to 1,000 people is one row, not 1,000.
   */
  rollUp?: { entityType: string; entityId: (row: Row) => string | null };
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const list = (...vs: unknown[]): string[] => vs.map(str).filter((v): v is string => v !== null);
const byId = (r: Row) => str(r.id);
const none = () => [];
const noSchool = () => null;

export const TRACKED_MODELS: Readonly<Record<string, Tracker>> = {
  Organisation: {
    entityType: 'organisation',
    needs: ['id'],
    entityId: byId,
    subjects: none,
    school: noSchool,
    orgWide: true,
  },
  School: {
    entityType: 'school',
    needs: ['id', 'franchiseOwnerUserId'],
    entityId: byId,
    subjects: (r) => list(r.franchiseOwnerUserId),
    school: byId,
  },
  User: {
    entityType: 'user',
    needs: ['id', 'homeSchoolId'],
    entityId: byId,
    subjects: (r) => list(r.id),
    school: (r) => str(r.homeSchoolId),
  },
  // Permission rows aren't tracked one by one: saving them also updates the
  // role row, which records one "role updated" event.
  Role: { entityType: 'role', needs: ['id'], entityId: byId, subjects: none, school: noSchool },
  Holiday: {
    entityType: 'holiday',
    needs: ['id'],
    entityId: byId,
    subjects: none,
    school: noSchool,
    orgWide: true,
  },
  PendingFieldChange: {
    entityType: 'field_change',
    needs: ['id', 'subjectUserId', 'requestedBy'],
    entityId: byId,
    subjects: (r) => list(r.subjectUserId, r.requestedBy),
    school: noSchool,
  },
  // Tasks (brief 10.3): a task is about its creator; each copy about its person,
  // so "Vikram gave you a task" reaches everyone it was given to.
  Task: {
    entityType: 'task',
    needs: ['id', 'createdBy'],
    entityId: byId,
    subjects: (r) => list(r.createdBy),
    school: noSchool,
  },
  // Copies roll up into their task: one row per task action, naming everyone affected.
  TaskAssignment: {
    entityType: 'task_copy',
    needs: ['id', 'taskId', 'userId', 'schoolId'],
    entityId: byId,
    subjects: (r) => list(r.userId),
    school: (r) => str(r.schoolId),
    rollUp: { entityType: 'task', entityId: (r) => str(r.taskId) },
  },
  RoleAssignment: {
    entityType: 'role_assignment',
    needs: ['id', 'userId'],
    entityId: byId,
    subjects: (r) => list(r.userId),
    school: noSchool,
  },
};

/** Widens a narrow `select` so the tracker can read what it needs from the result. */
export function withTrackedSelect(model: string, args: unknown): unknown {
  const tracker = TRACKED_MODELS[model];
  const a = args as { select?: Record<string, unknown> } | undefined;
  if (!tracker || !a?.select) return args;
  const select = { ...a.select };
  for (const k of tracker.needs) select[k] = true;
  return { ...a, select };
}

/** Row-returning bulk writes are allowed; the others can't tell us which rows changed. */
const TRACKED_WRITES: Record<string, 'created' | 'updated' | 'deleted' | 'reject'> = {
  create: 'created',
  createManyAndReturn: 'created',
  update: 'updated',
  updateManyAndReturn: 'updated',
  upsert: 'updated',
  delete: 'deleted',
  createMany: 'reject',
  updateMany: 'reject',
  deleteMany: 'reject',
};

export interface ActivityEvent {
  action: string;
  entityType: string;
  entityId: string;
  subjectUserIds: string[];
  schoolId: string | null;
  orgWide: boolean;
  /** Task actions point at their task, so feed visibility is checked in the query. */
  taskId?: string | null;
}

/**
 * Names what one unit of work did to a record, e.g. "submitted" on a task,
 * instead of the generic created / updated / deleted. There is still one row
 * per record per unit of work; this only sets its verb.
 */
export function nameAction(
  state: UnitOfWorkState,
  entityType: string,
  entityId: string,
  action: string,
) {
  const e = state.activity.find((x) => x.entityType === entityType && x.entityId === entityId);
  if (e) {
    e.action = action;
    return;
  }
  state.activity.push({
    action,
    entityType,
    entityId,
    subjectUserIds: [],
    schoolId: null,
    orgWide: false,
    taskId: entityType === 'task' ? entityId : null,
  });
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

export interface UnitOfWorkState {
  actorUserId: string | null;
  requestId: string | null;
  activity: ActivityEvent[];
  audit: AuditEntry[];
}

export const uowStorage = new AsyncLocalStorage<UnitOfWorkState>();

export function isTrackedWrite(model: string, operation: string): boolean {
  return model in TRACKED_MODELS && operation in TRACKED_WRITES;
}

/**
 * Called by the extension before a tracked write runs: refuses writes that
 * couldn't be recorded, so nothing is ever changed without its activity row.
 */
export function assertTrackable(model: string, operation: string): void {
  if (TRACKED_WRITES[operation] === 'reject') {
    throw new TenancyViolation(
      `${model}.${operation} can't be tracked; use the row-returning variant instead`,
    );
  }
  if (!uowStorage.getStore()) {
    throw new TenancyViolation(`Writes to ${model} must run inside withUnitOfWork()`);
  }
}

/** Called by the extension after a tracked write succeeded. */
export function recordWrite(
  model: string,
  operation: string,
  args: unknown,
  result: unknown,
): void {
  const tracker = TRACKED_MODELS[model];
  const kind = TRACKED_WRITES[operation];
  const uow = uowStorage.getStore();
  if (!tracker || !kind || kind === 'reject' || !uow) return;
  const data = (args as { data?: Row } | undefined)?.data;
  // A soft delete is an update that sets deleted_at; report it as a delete.
  const action =
    kind === 'updated' && data && 'deletedAt' in data && data.deletedAt ? 'deleted' : kind;
  const rows = Array.isArray(result) ? (result as Row[]) : [result as Row];
  for (const row of rows) {
    const entityId = tracker.rollUp ? tracker.rollUp.entityId(row) : tracker.entityId(row);
    if (!entityId) continue;
    const entityType = tracker.rollUp?.entityType ?? tracker.entityType;
    const subjects = tracker.subjects(row);
    const school = tracker.school(row);
    if (tracker.rollUp) {
      // One row per parent per unit of work: merge into it if it's there.
      const parent = uow.activity.find(
        (e) => e.entityType === entityType && e.entityId === entityId,
      );
      if (parent) {
        mergeSubjects(parent, subjects);
        if (parent.schoolId !== school) parent.schoolId = null;
        continue;
      }
    }
    const event: ActivityEvent = {
      action,
      entityType,
      entityId,
      subjectUserIds: [...new Set(subjects)],
      schoolId: school,
      orgWide: tracker.orgWide === true,
      taskId: entityType === 'task' ? entityId : null,
    };
    const existing = uow.activity.find(
      (e) =>
        e.entityType === event.entityType &&
        e.entityId === event.entityId &&
        (e.action === event.action || e.action === 'created'),
    );
    if (existing) mergeSubjects(existing, event.subjectUserIds);
    else uow.activity.push(event);
  }
}

/** Adds people to an activity row, keeping each once (copies of one task can be thousands). */
function mergeSubjects(e: ActivityEvent, add: readonly string[]): void {
  if (add.length === 0) return;
  const seen = new Set(e.subjectUserIds);
  for (const id of add) {
    if (!seen.has(id)) {
      seen.add(id);
      e.subjectUserIds.push(id);
    }
  }
}
