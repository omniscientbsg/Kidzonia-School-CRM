import { REACHES } from '../registry/index.js';
import type { FieldAccess, ModuleDef, Reach } from '../registry/index.js';
import type { FieldRule, PermissionContext, RecordFacts } from './types.js';

export function reachAtLeast(reach: Reach, min: Reach): boolean {
  return REACHES.indexOf(reach) >= REACHES.indexOf(min);
}

function checkableActions(mod: ModuleDef): Set<string> {
  return new Set<string>([...mod.actions, ...Object.keys(mod.derivedActions ?? {})]);
}

function assertKnownAction(mod: ModuleDef, action: string): void {
  if (!checkableActions(mod).has(action)) {
    throw new Error(`Module "${mod.key}" has no action "${action}"`);
  }
}

function isOwnRecord(ctx: PermissionContext, facts: RecordFacts): boolean {
  return facts.subjectUserIds.includes(ctx.userId);
}

function touchesTeam(ctx: PermissionContext, facts: RecordFacts): boolean {
  return facts.subjectUserIds.some((id) => ctx.teamUserIds.has(id));
}

/** Whether a record falls inside a reach. Everyone's own records are always inside. */
export function withinReach(ctx: PermissionContext, reach: Reach, facts: RecordFacts): boolean {
  if (isOwnRecord(ctx, facts)) return true;
  switch (reach) {
    case 'own':
      return false;
    case 'team':
      return touchesTeam(ctx, facts);
    case 'school':
      // Head-office records have no school, so school reach never covers them.
      return ctx.scope.allSchools
        ? facts.schoolIds.length > 0
        : facts.schoolIds.some((s) => ctx.scope.schoolIds.includes(s));
    case 'all':
      return true;
  }
}

/** Whether the role itself (not automatic roles) holds an action on a module. */
function roleHolds(ctx: PermissionContext, mod: ModuleDef, action: string): boolean {
  const grant = ctx.role?.modules[mod.key];
  // A grant without view is treated as off: rule 3 says unticking view clears
  // the module, and we don't trust stored data to have been normalised.
  if (!grant?.actions.includes('view')) return false;
  const derived = mod.derivedActions?.[action];
  if (derived) return derived.some((a) => grant.actions.includes(a));
  return (grant.actions as readonly string[]).includes(action);
}

function switchOn(ctx: PermissionContext, key: string, defaultOn: boolean): boolean {
  return ctx.managerSwitches[key] ?? defaultOn;
}

/** Reporting-manager grants (brief 6.3): only over records about their team. */
function managerAllows(
  ctx: PermissionContext,
  mod: ModuleDef,
  action: string,
  facts: RecordFacts | undefined,
): boolean {
  if (ctx.teamUserIds.size === 0) return false;
  const granted = (mod.managerSwitches ?? []).some(
    (s) => s.grants.includes(action) && switchOn(ctx, s.key, s.defaultOn),
  );
  if (!granted) return false;
  return facts ? touchesTeam(ctx, facts) : true;
}

/** Watchers see a record, and edit it if given edit. Never anything more. */
function watcherAllows(
  mod: ModuleDef,
  ctx: PermissionContext,
  action: string,
  facts: RecordFacts | undefined,
): boolean {
  if (!mod.supportsWatchers || !facts?.watchers) return false;
  const w = facts.watchers.find((x) => x.userId === ctx.userId);
  if (!w) return false;
  return action === 'view' || (action === 'edit' && w.access === 'edit');
}

/** Access to one record given to a named person (approver, creator, sub-task assignee). */
function participantAllows(ctx: PermissionContext, action: string, facts: RecordFacts | undefined) {
  return (facts?.participants ?? []).some(
    (p) => p.userId === ctx.userId && p.actions.includes(action),
  );
}

/**
 * The single permission check. Without `facts` it answers "can this person do
 * this anywhere in the module" (menus, buttons); with `facts` it answers for
 * one record, applying reach, automatic roles and watchers.
 */
export function can(
  ctx: PermissionContext,
  moduleKey: string,
  action: string,
  facts?: RecordFacts,
): boolean {
  const mod = ctx.registry.module(moduleKey);
  assertKnownAction(mod, action);
  // Rule 1: nothing is allowed without a role, not even watching.
  if (!ctx.role) return false;
  // Rule 2: the Owner always has everything.
  if (ctx.role.isOwner) return true;

  if (roleHolds(ctx, mod, action)) {
    if (!facts || !mod.hasReach) return true;
    const reach = ctx.role.modules[mod.key]?.reach ?? 'own';
    if (withinReach(ctx, reach, facts)) return true;
  }
  return (
    managerAllows(ctx, mod, action, facts) ||
    watcherAllows(mod, ctx, action, facts) ||
    participantAllows(ctx, action, facts)
  );
}

/** The reach a role gives on a module, or null if it can't view it at all. */
export function reachOf(ctx: PermissionContext, moduleKey: string): Reach | null {
  const mod = ctx.registry.module(moduleKey);
  if (!ctx.role) return null;
  if (ctx.role.isOwner) return 'all';
  if (!roleHolds(ctx, mod, 'view')) return null;
  return mod.hasReach ? (ctx.role.modules[mod.key]?.reach ?? 'own') : 'all';
}

export interface FieldDecision {
  access: FieldAccess;
  /** Edits are saved as a pending change for the manager to approve (rule 5). */
  needsApproval: boolean;
}

function fieldRule(ctx: PermissionContext, moduleKey: string, fieldKey: string) {
  const mod = ctx.registry.module(moduleKey);
  if (!(mod.fields ?? []).some((f) => f.key === fieldKey)) {
    throw new Error(`Module "${moduleKey}" has no field "${fieldKey}"`);
  }
  return ctx.role?.fields[moduleKey]?.[fieldKey];
}

function decideField(
  ctx: PermissionContext,
  moduleKey: string,
  rule: FieldRule | undefined,
  facts: RecordFacts | undefined,
): FieldAccess {
  if (!can(ctx, moduleKey, 'view', facts)) return 'hidden';
  if (ctx.role?.isOwner) return 'edit';
  const canEdit = can(ctx, moduleKey, 'edit', facts);
  if (!rule) return canEdit ? 'edit' : 'view';
  if (rule.access === 'hidden') return 'hidden';
  const own = facts !== undefined && isOwnRecord(ctx, facts);
  if (rule.ownRecord === 'edit' && own) return 'edit';
  // A field set to edit can't exceed the module: otherwise ticking one field
  // would quietly grant editing on a module the admin switched off. The own-
  // record rule above is the one deliberate way past that.
  if (rule.access === 'edit') return canEdit ? 'edit' : 'view';
  return 'view';
}

/** Field-level access (rule 5). Always checked after module access. */
export function fieldDecision(
  ctx: PermissionContext,
  moduleKey: string,
  fieldKey: string,
  facts?: RecordFacts,
): FieldDecision {
  const rule = fieldRule(ctx, moduleKey, fieldKey);
  const access = decideField(ctx, moduleKey, rule, facts);
  const needsApproval = access === 'edit' && !ctx.role?.isOwner && rule?.needsApproval === true;
  return { access, needsApproval };
}

export function fieldAccess(
  ctx: PermissionContext,
  moduleKey: string,
  fieldKey: string,
  facts?: RecordFacts,
): FieldAccess {
  return fieldDecision(ctx, moduleKey, fieldKey, facts).access;
}

/**
 * The output whitelist. Only public props and non-hidden field props survive;
 * anything the registry doesn't list is dropped, so a new column can never
 * leak by accident. Calling it for a record the user can't view is a bug.
 */
export function serialize<T extends object>(
  ctx: PermissionContext,
  moduleKey: string,
  record: T,
  facts: RecordFacts,
): Partial<T> {
  if (!can(ctx, moduleKey, 'view', facts)) {
    throw new Error(`serialize() called for a ${moduleKey} record outside the user's reach`);
  }
  const mod = ctx.registry.module(moduleKey);
  const src = record as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const copy = (prop: string) => {
    if (Object.hasOwn(src, prop)) out[prop] = src[prop];
  };
  (mod.publicProps ?? []).forEach(copy);
  for (const f of mod.fields ?? []) {
    if (fieldAccess(ctx, moduleKey, f.key, facts) !== 'hidden') (f.props ?? [f.key]).forEach(copy);
  }
  return out as Partial<T>;
}

export interface WriteCheck {
  /** Props the user may not write. A non-empty list means reject the request. */
  denied: string[];
  /** Props whose change must go through manager approval. */
  pendingApproval: string[];
}

/**
 * Checks a write against field permissions. Props that belong to no field are
 * governed by the module's edit action. Hidden and view-only fields are denied,
 * so hiding a field in the UI is never the only protection.
 */
export function checkWrite(
  ctx: PermissionContext,
  moduleKey: string,
  props: readonly string[],
  facts?: RecordFacts,
): WriteCheck {
  const mod = ctx.registry.module(moduleKey);
  const result: WriteCheck = { denied: [], pendingApproval: [] };
  const moduleEdit = can(ctx, moduleKey, 'edit', facts);
  for (const prop of props) {
    const field = (mod.fields ?? []).find((f) => (f.props ?? [f.key]).includes(prop));
    if (!field) {
      if (!moduleEdit) result.denied.push(prop);
      continue;
    }
    const d = fieldDecision(ctx, moduleKey, field.key, facts);
    if (d.access !== 'edit') result.denied.push(prop);
    else if (d.needsApproval) result.pendingApproval.push(prop);
  }
  return result;
}
