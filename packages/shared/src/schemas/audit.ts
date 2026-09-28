import { z } from 'zod';
import { idSchema } from '../ids.js';
import { pageQuerySchema } from '../pagination.js';
import { dateOnlySchema } from './settings.js';

/**
 * The audit log screen (brief 10.4). Rows store machine action keys
 * (`role.permissions_changed`); the API turns them into sentences and the
 * screen only ever shows those.
 */

export const AUDIT_AREAS = {
  roles: 'Roles and permissions',
  users: 'Users',
  schools: 'Schools',
  organisation: 'Organisation',
  holidays: 'Holidays',
  tasks: 'Tasks',
  releases: 'Logout releases',
  changes: 'Pending changes',
  previews: 'Previews',
  reports: 'Reports',
  parents: 'Parent contacts',
  other: 'Other',
} as const;
export type AuditArea = keyof typeof AUDIT_AREAS;
export const AUDIT_AREA_KEYS = Object.keys(AUDIT_AREAS) as [AuditArea, ...AuditArea[]];

/**
 * Areas follow the first part of the action key rather than the record type:
 * "role given" is stored against the person but belongs with roles, and a
 * pending change is stored against whatever record it changed.
 */
const AREA_OF_PREFIX: Readonly<Record<string, AuditArea>> = {
  role: 'roles',
  automatic_roles: 'roles',
  user: 'users',
  school: 'schools',
  organisation: 'organisation',
  holiday: 'holidays',
  task: 'tasks',
  task_copy: 'tasks',
  day_end_form: 'tasks',
  logout: 'releases',
  field_change: 'changes',
  preview: 'previews',
  report: 'reports',
  parent_contact: 'parents',
  parent_contacts: 'parents',
  parent_message: 'parents',
};

export function auditAreaOf(action: string): AuditArea {
  return AREA_OF_PREFIX[action.split('.')[0] ?? ''] ?? 'other';
}

/** Action-key prefixes that make up an area (for filtering in SQL). */
export function auditPrefixesOf(area: AuditArea): string[] {
  return Object.entries(AREA_OF_PREFIX)
    .filter(([, a]) => a === area)
    .map(([p]) => `${p}.`);
}

/** Every action the app records, with a short label for the filter. */
export const AUDIT_ACTIONS: Readonly<Record<string, string>> = {
  'role.created': 'Role created',
  'role.renamed': 'Role renamed',
  'role.permissions_changed': 'Role permissions changed',
  'role.fields_changed': 'Role field permissions changed',
  'role.deleted': 'Role deleted',
  'role.given': 'Role given',
  'role.removed': 'Role taken away',
  'automatic_roles.changed': 'Automatic roles changed',
  'user.created': 'Person added',
  'user.updated': 'Person’s details changed',
  'user.role_changed': 'Person’s role changed',
  'user.deactivated': 'Person deactivated',
  'user.reactivated': 'Person reactivated',
  'user.deleted': 'Person deleted',
  'user.password_changed': 'Password changed',
  'school.created': 'School added',
  'school.updated': 'School changed',
  'school.deleted': 'School deleted',
  'organisation.registered': 'Organisation registered',
  'organisation.updated': 'Organisation settings changed',
  'organisation.logo_changed': 'Logo changed',
  'organisation.logo_removed': 'Logo removed',
  'holiday.created': 'Holiday added',
  'holiday.updated': 'Holiday changed',
  'holiday.deleted': 'Holiday deleted',
  'task_copy.approved': 'Work approved',
  'task_copy.sent_back': 'Work sent back',
  'task_copy.deferred': 'Task moved to another day',
  'task_copy.completed_without_approver': 'Work done with no approver',
  'task_copy.approvals_moved': 'Approvals moved on',
  'task_copy.cancelled_on_leaving': 'Tasks cancelled when someone left',
  'task_copy.cancelled_on_role_removed': 'Tasks cancelled when a role was removed',
  'day_end_form.created': 'Day-end form created',
  'day_end_form.updated': 'Day-end form changed',
  'day_end_form.deleted': 'Day-end form deleted',
  'logout.release_requested': 'Release asked for',
  'logout.released': 'Released from the logout block',
  'field_change.approved': 'Change approved',
  'field_change.rejected': 'Change turned down',
  'preview.started': 'Preview started',
  'report.exported': 'Report downloaded',
  'parent_contacts.imported': 'Parent contacts uploaded',
  'parent_contact.consent_changed': 'Parent’s agreement changed',
  'parent_contact.opted_out': 'Parent opted out',
  'parent_contact.deleted': 'Parent contact deleted',
  'parent_contact.child_removed': 'Child removed',
};

export const auditLogQuerySchema = pageQuerySchema
  .extend({
    limit: z.coerce
      .number()
      .int()
      .min(1, 'Limit must be at least 1')
      .max(100, 'Limit can be at most 100')
      .default(50),
    actorUserId: idSchema.optional(),
    area: z.enum(AUDIT_AREA_KEYS).optional(),
    action: z
      .string()
      .max(80)
      .regex(/^[a-z_]+\.[a-z_]+$/, 'Unknown action')
      .optional(),
    /** Days in the organisation's time zone, both included. */
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'The end date can’t be before the start date',
    path: ['to'],
  });
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditChangeSchema = z.object({
  /** A field label ("Mobile number"), never a raw key. */
  field: z.string(),
  /** Display text; null means "not set". Phone numbers are always masked. */
  before: z.string().nullable(),
  after: z.string().nullable(),
});
export type AuditChange = z.infer<typeof auditChangeSchema>;

export const auditEntrySchema = z.object({
  id: idSchema,
  createdAt: z.string(),
  /** Null for changes the app made on its own (the task schedule). */
  actor: z.object({ id: idSchema, fullName: z.string() }).nullable(),
  action: z.string(),
  area: z.enum(AUDIT_AREA_KEYS),
  entityLabel: z.string().nullable(),
  /** "changed permissions for Principal": read after the actor's name. */
  summary: z.string(),
  changes: z.array(auditChangeSchema),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditLogPageSchema = z.object({
  items: z.array(auditEntrySchema),
  nextCursor: z.string().nullable(),
});
