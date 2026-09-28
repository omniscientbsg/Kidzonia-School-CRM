import { ACTION_TEXT, REACH_TEXT, auditAreaOf, normalizeMobile, registry } from '@kidzonia/shared';
import type { AuditChange, AuditEntry, Reach } from '@kidzonia/shared';

/**
 * Turns stored audit rows into what the Owner reads: a sentence and a list of
 * changed fields with their registry labels. Pure, so the wording and the
 * phone masking are unit-tested without a database.
 */

// ---------- phone numbers ----------

const PHONE_KEY = /mobile|phone/i;
const PHONE_CHARS = /^\+?[\d\s().-]+$/;
const PHONE_IN_TEXT = /\+?\d[\d\s().-]{8,}\d/g;
const digitCount = (s: string) => s.replace(/\D/g, '').length;

/** 10 to 15 digits and nothing but phone punctuation: an Indian mobile or E.164 number. */
export function looksLikePhone(value: string): boolean {
  const v = value.trim();
  const n = digitCount(v);
  return PHONE_CHARS.test(v) && n >= 10 && n <= 15;
}

/**
 * "+91 ••••• ••108". Only the last three digits survive: enough for an Owner
 * to tell two numbers apart, not enough to call anyone. Parent numbers must
 * never be readable in a log (Phase 6 answer 1).
 */
export function maskPhone(value: string): string {
  const e164 = normalizeMobile(value);
  const digits = (e164 ?? value).replace(/\D/g, '');
  if (digits.length < 6) return '•••••';
  const last = digits.slice(-3);
  if (e164?.startsWith('+91') && e164.length === 13) return `+91 ••••• ••${last}`;
  return `${value.trim().startsWith('+') ? '+' : ''}${'•'.repeat(digits.length - 3)}${last}`;
}

/** Masks every phone number inside free text (a note, a name someone typed a number into). */
export function maskPhonesIn(text: string): string {
  return text.replace(PHONE_IN_TEXT, (m) => {
    const n = digitCount(m);
    return n >= 10 && n <= 15 ? maskPhone(m) : m;
  });
}

// ---------- labels ----------

/** Names for the ids an entry mentions, loaded in one batch per table by the route. */
export interface Names {
  organisation: string;
  roles: ReadonlyMap<string, string>;
  users: ReadonlyMap<string, string>;
  schools: ReadonlyMap<string, string>;
  holidays: ReadonlyMap<string, string>;
  forms: ReadonlyMap<string, string>;
  tasks: ReadonlyMap<string, string>;
  /** Task copies, as "“Title” for Person". */
  copies: ReadonlyMap<string, string>;
}

/**
 * Tables whose names may be shown. Parent contacts (guardians, students) are
 * left out on purpose: they're personal data and the log only needs "a parent".
 */
const NAMED: readonly (keyof Omit<Names, 'organisation'>)[] = [
  'roles',
  'users',
  'schools',
  'holidays',
  'forms',
  'tasks',
  'copies',
];

const nameOf = (names: Names, id: string): string | null => {
  for (const k of NAMED) {
    const hit = names[k].get(id);
    if (hit !== undefined) return hit;
  }
  return null;
};

/** Record types stored in `entity_type` that have registry fields. */
const MODULE_OF_ENTITY: Readonly<Record<string, string>> = {
  user: 'users',
  school: 'schools',
  role: 'roles',
  organisation: 'organisation',
  task: 'tasks',
};

/** Labels for stored keys that aren't registry fields. */
const KEY_LABELS: Readonly<Record<string, string>> = {
  name: 'Name',
  description: 'Description',
  fullName: 'Full name',
  jobTitle: 'Job title',
  department: 'Department',
  startDate: 'Start date',
  endDate: 'Last day',
  schoolIds: 'Schools',
  role: 'Role',
  roleId: 'Role',
  scope: 'Schools',
  allSchools: 'All schools',
  state: 'State',
  setupType: 'Set-up',
  schoolModel: 'School model',
  timezone: 'Time zone',
  workingDays: 'Working days',
  opensAt: 'Opens at',
  closesAt: 'Closes at',
  logoutBlockLeadMinutes: 'Logout block starts (minutes before the deadline)',
  copiedFrom: 'Copied from',
  movedReportsTo: 'Reports moved to',
  moved: 'Moved',
  cancelled: 'Tasks cancelled',
  askedOf: 'Asked',
  note: 'Note',
  dates: 'Dates',
  date: 'Date',
  reason: 'Reason',
  remarks: 'Remarks',
  serviceDate: 'Date',
  report: 'Report',
  filters: 'Filters',
  from: 'From',
  to: 'To',
  rows: 'Rows',
  schools: 'Schools',
  field: 'Field',
  consent: 'Agreed to messages',
  imported: 'Added',
  skipped: 'Skipped',
  newChildren: 'New children',
  childrenRemoved: 'Children removed',
  parentsRemoved: 'Parents removed',
  status: 'Status',
};

/** Stored for the app's own use; meaningless to a reader. */
const HIDDEN_KEYS = new Set(['releaseId', 'sendInvite', 'id', 'organisationId']);

/** "reportsToUserId" → "Reports to user id". */
export function humanise(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function fieldLabel(moduleKey: string | null, key: string): string {
  if (moduleKey && registry.hasModule(moduleKey)) {
    for (const f of registry.module(moduleKey).fields ?? []) {
      if (f.key === key || (f.props ?? []).includes(key)) return f.label;
    }
  }
  return KEY_LABELS[key] ?? humanise(key);
}

// ---------- values ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dateText = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function scopeText(scope: unknown, names: Names): string | null {
  if (!isObject(scope)) return null;
  if (scope.allSchools === true) return 'All schools';
  const ids = Array.isArray(scope.schoolIds) ? scope.schoolIds : [];
  return ids.length === 0
    ? 'No schools'
    : ids.map((id) => (typeof id === 'string' ? nameOf(names, id) : null) ?? 'A school').join(', ');
}

/** Display text for one stored value; null means "not set". Never JSON. */
export function valueText(key: string, value: unknown, names: Names): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (PHONE_KEY.test(key) && (typeof value === 'string' || typeof value === 'number')) {
    return maskPhone(String(value));
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return maskPhonesIn(String(value));
  if (typeof value === 'string') {
    if (UUID.test(value)) return nameOf(names, value) ?? 'No longer available';
    if (DATE_ONLY.test(value)) return dateText.format(new Date(`${value}T00:00:00Z`));
    return maskPhonesIn(value);
  }
  if (Array.isArray(value)) {
    if (key === 'workingDays') {
      return value.map((d) => (typeof d === 'number' ? WEEKDAYS[d] : null) ?? '').join(', ');
    }
    if (value.length === 0) return key === 'schoolIds' ? 'All schools' : null;
    return value
      .map((v) => valueText(key, v, names))
      .filter((v) => v !== null)
      .join(', ');
  }
  if (isObject(value)) {
    if ('allSchools' in value && 'schoolIds' in value) return scopeText(value, names);
    if ('roleId' in value) {
      const role = valueText('roleId', value.roleId, names);
      const where = scopeText(value.scope, names);
      return [role, where].filter((v) => v !== null).join(', ');
    }
    const parts = Object.entries(value)
      .filter(([k]) => !HIDDEN_KEYS.has(k))
      .map(([k, v]) => {
        const text = valueText(k, v, names);
        return text === null ? null : `${fieldLabel(null, k)}: ${text}`;
      })
      .filter((v) => v !== null);
    return parts.length > 0 ? parts.join('; ') : null;
  }
  return null;
}

// ---------- changes ----------

/** Field by field: every key either side mentions, skipping ones that didn't change. */
function fieldChanges(moduleKey: string | null, before: unknown, after: unknown, names: Names) {
  const b = isObject(before) ? before : {};
  const a = isObject(after) ? after : {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (k) => !HIDDEN_KEYS.has(k),
  );
  const out: AuditChange[] = [];
  for (const key of keys) {
    const was = valueText(key, b[key], names);
    const now = valueText(key, a[key], names);
    if (was === now) continue;
    out.push({ field: fieldLabel(moduleKey, key), before: was, after: now });
  }
  return out;
}

const moduleName = (key: string) =>
  registry.hasModule(key) ? registry.module(key).name : humanise(key);

function grantText(g: unknown): string {
  if (!isObject(g)) return 'No access';
  const actions = Array.isArray(g.actions) ? (g.actions as string[]) : [];
  if (actions.length === 0) return 'No access';
  const text: Readonly<Partial<Record<string, { label: string }>>> = ACTION_TEXT;
  const labels = actions.map((a) => text[a]?.label ?? humanise(a));
  const reach = typeof g.reach === 'string' ? REACH_TEXT[g.reach as Reach] : undefined;
  return [labels.join(', '), reach].filter(Boolean).join(' · ');
}

const ACCESS_TEXT: Readonly<Record<string, string>> = {
  hidden: 'Hidden',
  view: 'View',
  edit: 'Edit',
};

function ruleText(r: unknown): string {
  if (!isObject(r)) return 'Not set';
  return [
    ACCESS_TEXT[String(r.access)] ?? humanise(String(r.access)),
    r.ownRecord === 'edit' ? 'can edit their own' : null,
    r.needsApproval === true ? 'changes need approval' : null,
  ]
    .filter(Boolean)
    .join(', ');
}

const sub = (v: unknown, key: string): Json => (isObject(v) && isObject(v[key]) ? v[key] : {});

/** A role's permissions, one line per section ("Tasks: View → View, Approve work"). */
function permissionChanges(before: unknown, after: unknown): AuditChange[] {
  const b = sub(before, 'modules');
  const a = sub(after, 'modules');
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .map((k) => ({ field: moduleName(k), before: grantText(b[k]), after: grantText(a[k]) }))
    .filter((c) => c.before !== c.after);
}

/** A role's field permissions, one line per field ("Users: Mobile number"). */
function fieldRuleChanges(before: unknown, after: unknown): AuditChange[] {
  const b = sub(before, 'fields');
  const a = sub(after, 'fields');
  const out: AuditChange[] = [];
  for (const m of new Set([...Object.keys(b), ...Object.keys(a)])) {
    const bm = sub(b, m);
    const am = sub(a, m);
    for (const f of new Set([...Object.keys(bm), ...Object.keys(am)])) {
      const was = ruleText(bm[f]);
      const now = ruleText(am[f]);
      if (was !== now) {
        out.push({ field: `${moduleName(m)}: ${fieldLabel(m, f)}`, before: was, after: now });
      }
    }
  }
  return out;
}

function switchChanges(before: unknown, after: unknown): AuditChange[] {
  const b = isObject(before) ? before : {};
  const a = isObject(after) ? after : {};
  const label = (k: string) =>
    registry.managerSwitches().find((s) => s.key === k)?.label ?? humanise(k);
  const onOff = (v: unknown) => (v === true ? 'On' : v === false ? 'Off' : null);
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .map((k) => ({ field: label(k), before: onOff(b[k]), after: onOff(a[k]) }))
    .filter((c) => c.before !== c.after);
}

/** Role and schools, whichever shape the action stored them in. */
function roleChanges(before: unknown, after: unknown, names: Names): AuditChange[] {
  const side = (v: unknown) => {
    if (!isObject(v)) return { role: null, schools: null };
    // user.role_changed stores only "all schools or not" for the old scope.
    const schools = isObject(v.scope)
      ? scopeText(v.scope, names)
      : v.allSchools === true
        ? 'All schools'
        : v.allSchools === false
          ? 'Some schools'
          : null;
    return { role: valueText('roleId', v.roleId, names), schools };
  };
  const b = side(before);
  const a = side(after);
  return [
    { field: 'Role', before: b.role, after: a.role },
    { field: 'Schools', before: b.schools, after: a.schools },
  ].filter((c) => c.before !== c.after);
}

// ---------- sentences ----------

export interface StoredEntry {
  id: string;
  createdAt: Date;
  actor: { id: string; fullName: string } | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
}

/** What to call a record whose name can't be found (deleted, or personal data). */
const FALLBACK: Readonly<Record<string, string>> = {
  role: 'a role',
  user: 'someone',
  users: 'someone',
  school: 'a school',
  schools: 'a school',
  holiday: 'a holiday',
  task_copy: 'a task',
  task: 'a task',
  tasks: 'a task',
  day_end_form: 'a day-end form',
  organisation: 'the organisation',
  guardian: 'a parent contact',
  student: 'a child',
};

function entityLabel(e: StoredEntry, names: Names): string | null {
  if (e.entityType === 'guardian' || e.entityType === 'student') return null;
  if (e.entityType === 'organisation') return names.organisation;
  const known = nameOf(names, e.entityId);
  if (known !== null) return known;
  // Deleted records carry their name in the "before" snapshot.
  const snap = isObject(e.before) ? e.before : isObject(e.after) ? e.after : {};
  const n = snap.name ?? snap.fullName;
  return typeof n === 'string' ? n : null;
}

type Template = (label: string, e: StoredEntry, names: Names) => string;

const roleNamed = (v: unknown, names: Names) =>
  (isObject(v) ? valueText('roleId', v.roleId, names) : null) ?? 'a role';

const SENTENCES: Readonly<Record<string, Template>> = {
  'role.created': (l) => `created the role ${l}`,
  'role.renamed': (l) => `renamed the role ${l}`,
  'role.permissions_changed': (l) => `changed permissions for ${l}`,
  'role.fields_changed': (l) => `changed field permissions for ${l}`,
  'role.deleted': (l) => `deleted the role ${l}`,
  'role.given': (l, e, n) => `gave ${roleNamed(e.after, n)} to ${l}`,
  'role.removed': (l, e, n) => `took ${roleNamed(e.before, n)} away from ${l}`,
  'automatic_roles.changed': () => 'changed the automatic roles',
  'user.created': (l) => `added ${l}`,
  'user.updated': (l) => `changed details for ${l}`,
  'user.role_changed': (l) => `changed the role of ${l}`,
  'user.deactivated': (l) => `deactivated ${l}`,
  'user.reactivated': (l) => `reactivated ${l}`,
  'user.deleted': (l) => `deleted ${l}`,
  'user.password_changed': () => 'changed their password',
  'school.created': (l) => `added the school ${l}`,
  'school.updated': (l) => `changed details for ${l}`,
  'school.deleted': (l) => `deleted the school ${l}`,
  'organisation.registered': (l) => `registered ${l}`,
  'organisation.updated': () => 'changed the organisation settings',
  'organisation.logo_changed': () => 'changed the logo',
  'organisation.logo_removed': () => 'removed the logo',
  'holiday.created': (l) => `added the holiday ${l}`,
  'holiday.updated': (l) => `changed the holiday ${l}`,
  'holiday.deleted': (l) => `deleted the holiday ${l}`,
  'task_copy.approved': (l) => `approved ${l}`,
  'task_copy.sent_back': (l) => `sent back ${l}`,
  'task_copy.deferred': (l) => `moved ${l} to another day`,
  'task_copy.completed_without_approver': (l) => `marked ${l} done (no approver was left)`,
  'task_copy.approvals_moved': (l) => `moved ${l}’s waiting approvals to the next approver`,
  'task_copy.cancelled_on_leaving': (l) => `cancelled ${l}’s open tasks when they left`,
  'task_copy.cancelled_on_role_removed': (l) =>
    `cancelled ${l}’s open tasks when their role was taken away`,
  'day_end_form.created': (l) => `created the day-end form ${l}`,
  'day_end_form.updated': (l) => `changed the day-end form ${l}`,
  'day_end_form.deleted': (l) => `deleted the day-end form ${l}`,
  'logout.release_requested': () => 'asked to be released from the logout block',
  'logout.released': (l) => `released ${l} from the logout block`,
  'field_change.approved': (l) => `approved a change to ${l}`,
  'field_change.rejected': (l) => `turned down a change to ${l}`,
  'preview.started': (l) => `previewed the app as ${l}`,
  'report.exported': () => 'downloaded the tasks report',
  'parent_contacts.imported': (l) => `uploaded parent contacts for ${l}`,
  'parent_contact.consent_changed': () => 'changed a parent’s agreement to messages',
  'parent_contact.opted_out': () => 'marked a parent as not wanting messages',
  'parent_contact.deleted': () => 'deleted a parent contact',
  'parent_contact.child_removed': () => 'removed a child from the parent contacts',
};

/** Actions this file can describe (tested against the shared filter list). */
export const DESCRIBED_ACTIONS: readonly string[] = Object.keys(SENTENCES);

function changesFor(e: StoredEntry, names: Names): AuditChange[] {
  switch (e.action) {
    case 'role.created': {
      // Starter roles store their whole definition; show it as sections, not nested values.
      const after = isObject(e.after) ? e.after : {};
      const basics = Object.fromEntries(
        ['name', 'description', 'copiedFrom'].filter((k) => k in after).map((k) => [k, after[k]]),
      );
      return [
        ...fieldChanges('roles', null, basics, names),
        ...permissionChanges(null, after),
        ...fieldRuleChanges(null, after),
      ];
    }
    case 'role.permissions_changed':
      return permissionChanges(e.before, e.after);
    case 'role.fields_changed':
      return fieldRuleChanges(e.before, e.after);
    case 'automatic_roles.changed':
      return switchChanges(e.before, e.after);
    case 'role.given':
    case 'role.removed':
    case 'user.role_changed':
      return roleChanges(e.before, e.after, names);
    case 'field_change.rejected': {
      // `field` holds a registry key; show its label, not the key.
      const after = isObject(e.after) ? e.after : {};
      const key = typeof after.field === 'string' ? after.field : '';
      return [
        { field: 'Field', before: null, after: key ? fieldLabel(e.entityType, key) : null },
        { field: 'Reason', before: null, after: valueText('reason', after.reason, names) },
      ].filter((c) => c.after !== null);
    }
    default:
      return fieldChanges(
        MODULE_OF_ENTITY[e.entityType] ?? (registry.hasModule(e.entityType) ? e.entityType : null),
        e.before,
        e.after,
        names,
      );
  }
}

export function present(e: StoredEntry, names: Names): AuditEntry {
  const known = entityLabel(e, names);
  const label = known ?? FALLBACK[e.entityType] ?? 'a record';
  const template = SENTENCES[e.action];
  const [, verb = e.action] = e.action.split('.');
  const summary = template
    ? template(label, e, names)
    : `${humanise(verb).toLowerCase()}: ${label}`;
  return {
    id: e.id,
    createdAt: e.createdAt.toISOString(),
    actor: e.actor,
    action: e.action,
    area: auditAreaOf(e.action),
    entityLabel: known === null ? null : maskPhonesIn(known),
    summary: maskPhonesIn(summary),
    changes: changesFor(e, names),
  };
}

/** Every id-looking string in an entry, so the route can load all names in one go. */
export function idsIn(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    if (UUID.test(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) idsIn(v, into);
  } else if (isObject(value)) {
    for (const v of Object.values(value)) idsIn(v, into);
  }
}
