import { uowStorage } from './tracking.js';

/**
 * created_by / updated_by audit stamps (brief 5), filled in by the data layer
 * from the unit of work's actor, never from input. A stamp the caller already
 * set is kept (e.g. a task's creator, which is a business fact). Writes
 * outside a unit of work (seeding, jobs without a person) aren't stamped.
 *
 * The lists follow the schema: models with both columns, and models that are
 * only ever created (join rows, versions) or only ever updated (switches).
 */
const BOTH = new Set([
  'Organisation',
  'School',
  'User',
  'Role',
  'RolePermission',
  'RoleFieldPermission',
  'RoleAssignment',
  'Holiday',
  'TaskCategory',
  'TaskPriority',
  'TaskList',
  'TaskListValue',
  'ParentMessageTemplate',
  'TaskTemplate',
  'Task',
  'DayEndForm',
]);
const CREATED_ONLY = new Set([
  'RoleAssignmentSchool',
  'HolidaySchool',
  'TaskWatcher',
  'DayEndFormVersion',
]);
const UPDATED_ONLY = new Set(['AutomaticRoleSetting']);

type Row = Record<string, unknown>;

const onCreate = (model: string, row: Row, by: string): Row => {
  const out = { ...row };
  if ((BOTH.has(model) || CREATED_ONLY.has(model)) && out.createdBy === undefined)
    out.createdBy = by;
  if ((BOTH.has(model) || UPDATED_ONLY.has(model)) && out.updatedBy === undefined)
    out.updatedBy = by;
  return out;
};
const onUpdate = (model: string, row: Row, by: string): Row =>
  (BOTH.has(model) || UPDATED_ONLY.has(model)) && row.updatedBy === undefined
    ? { ...row, updatedBy: by }
    : row;

export function withStamps(model: string | undefined, operation: string, args: unknown): unknown {
  const by = uowStorage.getStore()?.actorUserId;
  if (!model || !by || !args || typeof args !== 'object') return args;
  if (!BOTH.has(model) && !CREATED_ONLY.has(model) && !UPDATED_ONLY.has(model)) return args;
  const a = args as Row & { data?: unknown; create?: unknown; update?: unknown };
  switch (operation) {
    case 'create':
      return a.data && typeof a.data === 'object'
        ? { ...a, data: onCreate(model, a.data as Row, by) }
        : args;
    case 'createMany':
    case 'createManyAndReturn': {
      const rows = Array.isArray(a.data) ? (a.data as Row[]) : a.data ? [a.data as Row] : [];
      return { ...a, data: rows.map((r) => onCreate(model, r, by)) };
    }
    case 'update':
    case 'updateMany':
    case 'updateManyAndReturn':
      return a.data && typeof a.data === 'object'
        ? { ...a, data: onUpdate(model, a.data as Row, by) }
        : args;
    case 'upsert':
      return {
        ...a,
        create:
          a.create && typeof a.create === 'object'
            ? onCreate(model, a.create as Row, by)
            : a.create,
        update:
          a.update && typeof a.update === 'object'
            ? onUpdate(model, a.update as Row, by)
            : a.update,
      };
    default:
      return args;
  }
}
