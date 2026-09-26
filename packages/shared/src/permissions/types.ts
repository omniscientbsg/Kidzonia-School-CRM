import type { Action, FieldAccess, Reach, Registry } from '../registry/index.js';

export interface ModuleGrant {
  actions: readonly Action[];
  /** Null for modules without reach. */
  reach: Reach | null;
}

export const OWN_RECORD_RULES = ['same', 'edit'] as const;
export type OwnRecordRule = (typeof OWN_RECORD_RULES)[number];

export interface FieldRule {
  access: FieldAccess;
  ownRecord: OwnRecordRule;
  needsApproval: boolean;
}

/** Everything a role allows, as loaded from role_permissions and role_field_permissions. */
export interface RoleGrants {
  roleId: string;
  roleName: string;
  isOwner: boolean;
  modules: Readonly<Partial<Record<string, ModuleGrant>>>;
  fields: Readonly<Partial<Record<string, Readonly<Partial<Record<string, FieldRule>>>>>>;
}

export interface SchoolScope {
  allSchools: boolean;
  schoolIds: readonly string[];
}

/**
 * The inputs every permission decision needs. Built once per request on the
 * server (and from GET /me on the client) so the rules themselves stay pure.
 */
export interface PermissionContext {
  registry: Registry;
  userId: string;
  /** Null when the person has no role: they can log in but do nothing (rule 1). */
  role: RoleGrants | null;
  scope: SchoolScope;
  /** Everyone reporting to this person directly or indirectly. Never includes them. */
  teamUserIds: ReadonlySet<string>;
  /** Automatic-role switch values; a missing key falls back to the switch default. */
  managerSwitches: Readonly<Partial<Record<string, boolean>>>;
}

export type WatcherAccess = 'view' | 'edit';

/**
 * What the engine needs to know about one record. The caller derives it from
 * the record; the engine never looks inside records itself.
 */
export interface RecordFacts {
  /** People the record is about: assignee, creator, or the user record itself. */
  subjectUserIds: readonly string[];
  /** Schools the record belongs to. Empty for head-office records. */
  schoolIds: readonly string[];
  watchers?: readonly { userId: string; access: WatcherAccess }[];
}
