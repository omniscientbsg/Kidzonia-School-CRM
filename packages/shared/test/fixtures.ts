import { registry } from '../src/modules/index.js';
import type {
  FieldRule,
  ModuleGrant,
  PermissionContext,
  RecordFacts,
  RoleGrants,
} from '../src/permissions/index.js';
import type { Action, Reach } from '../src/registry/index.js';

/** A tiny org chart, mirroring the demo: HO → principal → teachers. */
export const ids = {
  owner: 'u-owner',
  deptHead: 'u-dept',
  principal: 'u-principal',
  teacherA: 'u-teacher-a',
  teacherB: 'u-teacher-b',
  otherPrincipal: 'u-principal-2',
  otherTeacher: 'u-teacher-c',
  hoStaff: 'u-ho',
  schoolJH: 's-jh',
  schoolGB: 's-gb',
} as const;

export const grant = (actions: Action[], reach: Reach | null = null): ModuleGrant => ({
  actions,
  reach,
});

export const rule = (access: FieldRule['access'], extra: Partial<FieldRule> = {}): FieldRule => ({
  access,
  ownRecord: 'same',
  needsApproval: false,
  ...extra,
});

export function role(
  modules: RoleGrants['modules'],
  fields: RoleGrants['fields'] = {},
  isOwner = false,
): RoleGrants {
  return { roleId: 'r', roleName: 'Test role', isOwner, modules, fields };
}

export function ctx(overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    registry,
    userId: ids.principal,
    role: null,
    scope: { allSchools: false, schoolIds: [ids.schoolJH] },
    teamUserIds: new Set(),
    managerSwitches: {},
    ...overrides,
  };
}

export const ownerRole = role({}, {}, true);

export const teacherRole = role(
  {
    tasks: grant(['view', 'edit'], 'own'),
    task_reports: grant(['view'], 'own'),
    hrms_staff: grant(['view'], 'own'),
  },
  {
    tasks: { watchers: rule('hidden'), remarks: rule('view'), proof: rule('edit') },
    hrms_staff: {
      homeAddress: rule('view', { ownRecord: 'edit', needsApproval: true }),
      bankDetails: rule('view', { ownRecord: 'edit', needsApproval: true }),
    },
  },
);

export const principalRole = role(
  {
    tasks: grant(['view', 'create', 'edit', 'assign', 'approve'], 'team'),
    dayend: grant(['view'], 'team'),
    task_reports: grant(['view'], 'team'),
    hrms_staff: grant(['view'], 'team'),
    users: grant(['view'], 'school'),
  },
  { hrms_staff: { aadhaar: rule('hidden'), bankDetails: rule('hidden'), salary: rule('hidden') } },
);

export const deptHeadRole = role(
  {
    tasks: grant(['view', 'create', 'edit', 'assign', 'approve'], 'all'),
    dayend: grant(['view'], 'all'),
    task_reports: grant(['view', 'export'], 'all'),
    users: grant(['view'], 'all'),
    schools: grant(['view']),
  },
  { users: { mobile: rule('hidden') } },
);

export const facts = (
  subjectUserIds: string[],
  schoolIds: string[] = [],
  watchers?: RecordFacts['watchers'],
): RecordFacts =>
  watchers ? { subjectUserIds, schoolIds, watchers } : { subjectUserIds, schoolIds };

export const principalCtx = (o: Partial<PermissionContext> = {}) =>
  ctx({
    userId: ids.principal,
    role: principalRole,
    teamUserIds: new Set([ids.teacherA, ids.teacherB]),
    ...o,
  });

export const teacherCtx = (o: Partial<PermissionContext> = {}) =>
  ctx({ userId: ids.teacherA, role: teacherRole, ...o });
