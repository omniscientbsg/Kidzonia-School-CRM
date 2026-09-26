import type { Action, ModuleDef } from '../registry/index.js';
import type { ModuleGrant } from './types.js';

/**
 * Rule 3: any action implies view, and no view means nothing. Also drops
 * actions the module doesn't have and keeps the module's own order, so stored
 * grants are always canonical.
 */
export function normalizeActions(mod: ModuleDef, selected: readonly string[]): Action[] {
  const chosen = mod.actions.filter((a) => selected.includes(a));
  if (chosen.length === 0) return [];
  if (!selected.includes('view')) {
    // Something other than view was ticked: tick view as well.
    return mod.actions.filter((a) => a === 'view' || chosen.includes(a));
  }
  return chosen;
}

/** Applies one checkbox click in the role editor. */
export function toggleAction(
  mod: ModuleDef,
  current: readonly Action[],
  action: Action,
  on: boolean,
): Action[] {
  if (!on && action === 'view') return [];
  const next = on ? [...current, action] : current.filter((a) => a !== action);
  return normalizeActions(mod, next);
}

/** Rule 6: field permissions only make sense once the role can view the module. */
export function canConfigureFields(grant: ModuleGrant | undefined): boolean {
  return grant?.actions.includes('view') === true;
}

export type GuardResult = { ok: true } | { ok: false; message: string };

const OK: GuardResult = { ok: true };

/** Rule 2: the Owner role can't be edited. */
export function checkRoleEdit(role: { isOwner: boolean }): GuardResult {
  return role.isOwner ? { ok: false, message: "The Owner role can't be changed." } : OK;
}

/** Rule 2: the Owner role can't be deleted. */
export function checkRoleDelete(role: { isOwner: boolean }): GuardResult {
  return role.isOwner ? { ok: false, message: "The Owner role can't be deleted." } : OK;
}

/**
 * Rule 2: the last Owner can't lose the role (by removal, deactivation or
 * deletion), or the organisation would be locked out of its own settings.
 */
export function checkOwnerHolderRemoval(ownerHolderCount: number): GuardResult {
  return ownerHolderCount <= 1
    ? {
        ok: false,
        message: 'This person is the only Owner. Give someone else the Owner role first.',
      }
    : OK;
}
