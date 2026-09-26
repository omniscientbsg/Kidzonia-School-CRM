import { ACTION_TEXT, REACHES } from '../registry/index.js';
import type { ModuleDef, Reach, Registry } from '../registry/index.js';
import type { RoleGrants, SchoolScope } from './types.js';

/**
 * "No more powerful than your own." Nobody but an Owner may give a role, or
 * edit a role into something, that can do more than their own role can.
 * Without this, anyone who can hand out roles could hand out more power than
 * they hold (e.g. a franchise owner making a teacher a Department head).
 */

export interface PowerViolation {
  /** Stable key, so "new" violations can be told apart from existing ones. */
  key: string;
  /** Plain English, shown to the person, e.g. "Users: Delete". */
  message: string;
}

type Grants = Pick<RoleGrants, 'isOwner' | 'modules' | 'fields'>;

interface FieldPower {
  /** 0 hidden, 1 view, 2 edit. */
  level: number;
  /** The level on the person's own records. */
  own: number;
  needsApproval: boolean;
}

const hasView = (g: Grants | null, key: string) =>
  g?.modules[key]?.actions.includes('view') === true;
const reachRank = (r: Reach | null | undefined) => (r ? REACHES.indexOf(r) : -1);

function fieldPower(g: Grants | null, mod: ModuleDef, fieldKey: string): FieldPower {
  if (g?.isOwner) return { level: 2, own: 2, needsApproval: false };
  if (!g || !hasView(g, mod.key)) return { level: 0, own: 0, needsApproval: false };
  const moduleEdit = g.modules[mod.key]?.actions.includes('edit') === true;
  const rule = g.fields[mod.key]?.[fieldKey];
  if (!rule) {
    const level = moduleEdit ? 2 : 1;
    return { level, own: level, needsApproval: false };
  }
  if (rule.access === 'hidden') return { level: 0, own: 0, needsApproval: false };
  const level = rule.access === 'edit' && moduleEdit ? 2 : 1;
  const own = rule.ownRecord === 'edit' ? 2 : level;
  return { level, own, needsApproval: rule.needsApproval };
}

/** Everything `candidate` can do that `holder` can't. Empty means "within". */
export function powerBeyond(
  registry: Registry,
  candidate: Grants,
  holder: Grants | null,
): PowerViolation[] {
  if (holder?.isOwner) return [];
  if (candidate.isOwner) return [{ key: 'owner', message: 'the Owner role' }];
  const out: PowerViolation[] = [];
  for (const mod of registry.modules) {
    if (!hasView(candidate, mod.key)) continue;
    const cand = candidate.modules[mod.key];
    const held = holder?.modules[mod.key];
    const heldActions: readonly string[] = hasView(holder, mod.key) ? (held?.actions ?? []) : [];
    for (const a of cand?.actions ?? []) {
      if (!heldActions.includes(a)) {
        out.push({ key: `${mod.key}:${a}`, message: `${mod.name}: ${ACTION_TEXT[a].label}` });
      }
    }
    if (
      mod.hasReach &&
      reachRank(cand?.reach ?? 'own') >
        reachRank(hasView(holder, mod.key) ? (held?.reach ?? 'own') : null)
    ) {
      out.push({ key: `${mod.key}:reach`, message: `${mod.name}: whose records` });
    }
    for (const f of mod.fields ?? []) {
      const c = fieldPower(candidate, mod, f.key);
      const h = fieldPower(holder, mod, f.key);
      if (c.level > h.level || c.own > h.own) {
        out.push({ key: `${mod.key}.${f.key}`, message: `${mod.name}: ${f.label}` });
      } else if (!c.needsApproval && h.needsApproval && Math.max(c.level, c.own) === 2) {
        out.push({
          key: `${mod.key}.${f.key}:approval`,
          message: `${mod.name}: ${f.label} without approval`,
        });
      }
    }
  }
  return out;
}

/**
 * For editing a role: only what the edit ADDS beyond the editor's own power
 * counts. A role that was already stronger (e.g. set up by an Owner) can still
 * be renamed or reduced by someone weaker.
 */
export function powerAdded(
  registry: Registry,
  before: Grants,
  after: Grants,
  editor: Grants | null,
): PowerViolation[] {
  const existing = new Set(powerBeyond(registry, before, editor).map((v) => v.key));
  return powerBeyond(registry, after, editor).filter((v) => !existing.has(v.key));
}

/** A school scope given to someone must sit inside the giver's own scope. */
export function scopeWithin(
  child: SchoolScope,
  parent: SchoolScope,
  parentIsOwner: boolean,
): boolean {
  if (parentIsOwner || parent.allSchools) return true;
  if (child.allSchools) return false;
  return child.schoolIds.every((s) => parent.schoolIds.includes(s));
}

/** Turns violations into one sentence for an error message. */
export function describePower(violations: readonly PowerViolation[]): string {
  const list = violations.slice(0, 4).map((v) => v.message);
  const more = violations.length > 4 ? `, and ${violations.length - 4} more` : '';
  return `That gives more access than your own role has (${list.join(', ')}${more}).`;
}
