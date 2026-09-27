import { can, createAccess } from '@kidzonia/shared';
import type { Access } from '@kidzonia/shared';
import type { DataAccess, ScopedDb } from '../db/index.js';
import { notAllowed, notFound } from '../lib/errors.js';
import { loadPermissions } from './permission-context.js';
import type { LoadedPermissions } from './permission-context.js';
import { userFacts } from './users/facts.js';

export const PREVIEW_HEADER = 'x-kidzonia-preview';

export interface PreviewTarget {
  userId: string;
  permissions: LoadedPermissions;
}

/**
 * Checks that `previewer` may preview `targetUserId`: they can edit roles,
 * and the target is someone they can see in Users. Returns the target's
 * permissions. Throws 403/404 otherwise.
 */
export async function resolvePreview(
  data: DataAccess,
  db: ScopedDb,
  previewer: LoadedPermissions,
  targetUserId: string,
): Promise<PreviewTarget> {
  if (!can(previewer.ctx, 'roles', 'edit')) {
    throw notAllowed('Only people who can edit roles can preview them.');
  }
  if (targetUserId === previewer.ctx.userId) throw notAllowed('You can’t preview yourself.');
  const target = await db.user.findFirst({
    where: { id: targetUserId, deletedAt: null, status: { not: 'inactive' } },
    select: { id: true, homeSchoolId: true, organisationId: true },
  });
  if (!target || !can(previewer.ctx, 'users', 'view', userFacts(target)))
    throw notFound('That person');
  const permissions = await loadPermissions(data, db, {
    id: target.id,
    organisationId: target.organisationId,
  });
  return { userId: target.id, permissions };
}

/**
 * The Access for a request. During a preview everything must be allowed to
 * both the previewed person and the previewer (brief addition a), and the
 * request is read-only.
 */
export function accessFor(self: LoadedPermissions, preview: PreviewTarget | null): Access {
  // The school switcher narrows lists on the server, not just on screen (brief 7.6).
  const options = { schoolFilter: self.selectedSchoolId };
  if (!preview) return createAccess(self.ctx, [], false, options);
  return createAccess(preview.permissions.ctx, [self.ctx], true, options);
}
