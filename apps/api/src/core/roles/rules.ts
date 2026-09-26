import {
  checkOwnerHolderRemoval,
  describePower,
  powerBeyond,
  registry,
  scopeWithin,
} from '@kidzonia/shared';
import type { RoleGrants, SchoolScope } from '@kidzonia/shared';
import type { ScopedTx } from '../../db/index.js';
import { AppError, businessRule, notAllowed, notFound } from '../../lib/errors.js';
import { loadRoleGrants } from '../permission-context.js';
import type { LoadedPermissions } from '../permission-context.js';

/** The person's current role grants, or null for "No access yet". */
export async function currentRoleOf(tx: ScopedTx, userId: string): Promise<RoleGrants | null> {
  const a = await tx.roleAssignment.findFirst({ where: { userId }, select: { roleId: true } });
  return a ? loadRoleGrants(tx, a.roleId) : null;
}

/**
 * Brief addition (c): nobody may change, deactivate or delete someone whose
 * role can do more than their own. Owners can manage anyone.
 */
export async function assertCanManagePerson(
  tx: ScopedTx,
  self: LoadedPermissions,
  targetUserId: string,
): Promise<void> {
  if (self.ctx.role?.isOwner || targetUserId === self.ctx.userId) return;
  const targetRole = await currentRoleOf(tx, targetUserId);
  if (targetRole && powerBeyond(registry, targetRole, self.ctx.role).length > 0) {
    throw notAllowed('This person’s role has more access than yours, so you can’t change them.');
  }
}

/**
 * Giving a role: no more powerful than your own, only to schools you look
 * after, and only an Owner gives the Owner role.
 */
export async function assertCanGiveRole(
  tx: ScopedTx,
  self: LoadedPermissions,
  roleId: string,
  scope: SchoolScope,
): Promise<RoleGrants> {
  const role = await loadRoleGrants(tx, roleId);
  if (!role) throw notFound('That role');
  const selfOwner = self.ctx.role?.isOwner === true;
  if (role.isOwner && !selfOwner) throw notAllowed('Only an Owner can give the Owner role.');
  const beyond = powerBeyond(registry, role, self.ctx.role);
  if (beyond.length > 0) throw notAllowed(describePower(beyond));
  if (!scopeWithin(scope, self.ctx.scope, selfOwner)) {
    throw new AppError('not_allowed', 'You can only give access to schools you look after.', {
      scope: 'Choose schools you look after.',
    });
  }
  if (!scope.allSchools && scope.schoolIds.length > 0) {
    const found = await tx.school.count({
      where: { id: { in: [...scope.schoolIds] }, deletedAt: null },
    });
    if (found !== new Set(scope.schoolIds).size) throw notFound('One of those schools');
  }
  return role;
}

/** Rule 2: the organisation must always keep at least one active Owner. */
export async function assertKeepsAnOwner(tx: ScopedTx, userId: string): Promise<void> {
  const owners = await tx.roleAssignment.findMany({
    where: {
      role: { isOwner: true, deletedAt: null },
      user: { deletedAt: null, status: { not: 'inactive' } },
    },
    select: { userId: true },
  });
  if (!owners.some((o) => o.userId === userId)) return;
  const guard = checkOwnerHolderRemoval(owners.length);
  if (!guard.ok) throw businessRule(guard.message);
}

/**
 * Gives (or takes away, with null) someone's role. One role per user in v1
 * (brief 5.5, open decision 13.5), so this replaces any existing assignment.
 */
export async function setAssignment(
  tx: ScopedTx,
  organisationId: string,
  userId: string,
  give: { roleId: string; scope: SchoolScope } | null,
): Promise<void> {
  const existing = await tx.roleAssignment.findFirst({ where: { userId }, select: { id: true } });
  if (existing)
    await tx.roleAssignment.delete({ where: { id: existing.id }, select: { id: true } });
  if (!give) return;
  const created = await tx.roleAssignment.create({
    data: {
      organisationId,
      userId,
      roleId: give.roleId,
      scopeAllSchools: give.scope.allSchools,
    },
    select: { id: true },
  });
  if (!give.scope.allSchools && give.scope.schoolIds.length > 0) {
    await tx.roleAssignmentSchool.createMany({
      data: [...new Set(give.scope.schoolIds)].map((schoolId) => ({
        organisationId,
        assignmentId: created.id,
        schoolId,
      })),
    });
  }
}
