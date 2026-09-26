import { checkWrite } from '@kidzonia/shared';
import type { Access, RecordFacts } from '@kidzonia/shared';
import { AppError, notAllowed, notFound } from '../lib/errors.js';

/** Module-level check: may this person use this part of the app at all? */
export function requireModule(access: Access, moduleKey: string, action: string): void {
  if (!access.can(moduleKey, action)) throw notAllowed();
}

/**
 * Record-level check. Records the person can't see answer 404, exactly like
 * records that don't exist, so ids can't be probed. Records they can see but
 * not change answer 403.
 */
export function requireRecord(
  access: Access,
  moduleKey: string,
  action: string,
  facts: RecordFacts,
  what: string,
): void {
  if (!access.can(moduleKey, 'view', facts)) throw notFound(what);
  if (action !== 'view' && !access.can(moduleKey, action, facts)) throw notAllowed();
}

/** Previews are read-only; the router also refuses non-GET requests during one. */
export function requireWritable(access: Access): void {
  if (access.readOnly) throw notAllowed('Preview is read-only. Exit the preview to make changes.');
}

/**
 * Field-level check for a write (rule 5). Hidden or view-only fields are
 * refused outright; fields whose changes need approval are returned so the
 * caller can save them as pending changes instead.
 */
export function checkWritableFields(
  access: Access,
  moduleKey: string,
  props: readonly string[],
  facts?: RecordFacts,
): string[] {
  requireWritable(access);
  const result = checkWrite(access.primary, moduleKey, props, facts);
  if (result.denied.length > 0) {
    throw new AppError(
      'not_allowed',
      'Your role doesn’t let you change some of these details.',
      Object.fromEntries(result.denied.map((p) => [p, 'You can’t change this.'])),
    );
  }
  return result.pendingApproval;
}
