import type { Access } from './access.js';
import type { RecordFacts } from './types.js';

/**
 * The one field check for composed screens (brief audit D1, approved).
 *
 * Records of a module (a user, a school, a task) leave the server through
 * `serialize()`. Screens that compose several records into their own shape
 * (reports, search, Home, the feed, notifications, day-end, the logout
 * screens, Manage people, the parent message log) can't, so they ask this
 * helper instead of calling `fieldAccess` themselves. That keeps one rule for
 * "may this reader see this field here", and the leak test checks every one of
 * those screens against it.
 */
export interface FieldView {
  /** Whether the field may be shown to this reader. */
  sees: (field: string) => boolean;
  /** Whether the reader may change it. */
  edits: (field: string) => boolean;
  /** `value` when the field may be shown, otherwise `fallback`. */
  show: <T, F>(field: string, value: T, fallback: F) => T | F;
}

export function fieldView(access: Access, moduleKey: string, facts?: RecordFacts): FieldView {
  const level = (field: string) => access.fieldAccess(moduleKey, field, facts);
  return {
    sees: (field) => level(field) !== 'hidden',
    edits: (field) => level(field) === 'edit',
    show: (field, value, fallback) => (level(field) !== 'hidden' ? value : fallback),
  };
}

/** How a person's name reads when it can't be shown. */
export const HIDDEN_NAME = 'Someone';

/**
 * People's names on composed screens. Names appear on tasks anyway, so they
 * are shown unless a role explicitly hides Users → Full name; not having the
 * Users module at all doesn't hide them (Phase 5).
 */
export function peopleNames(access: Access): {
  sees: boolean;
  show: (name: string | null | undefined) => string;
} {
  const hidden = access.contexts.some(
    (c) => c.role !== null && !c.role.isOwner && c.role.fields.users?.fullName?.access === 'hidden',
  );
  return {
    sees: !hidden,
    show: (name) => (!hidden && name ? name : HIDDEN_NAME),
  };
}
