import { orgRegistry, registry as defaultRegistry } from '@kidzonia/shared';
import type {
  Action,
  FieldRule,
  ModuleGrant,
  PermissionContext,
  Registry,
  RoleGrants,
} from '@kidzonia/shared';
import type { DataAccess, ScopedTx } from '../db/index.js';

export interface LoadedPermissions {
  ctx: PermissionContext;
  teamUserIds: string[];
}

/** Reads one role's grants in the shape the permission engine wants. */
export async function loadRoleGrants(db: ScopedTx, roleId: string): Promise<RoleGrants | null> {
  const role = await db.role.findFirst({
    where: { id: roleId, deletedAt: null },
    select: {
      id: true,
      name: true,
      isOwner: true,
      permissions: { select: { moduleKey: true, actions: true, reach: true } },
      fieldPermissions: {
        select: {
          moduleKey: true,
          fieldKey: true,
          access: true,
          ownRecord: true,
          needsApproval: true,
        },
      },
    },
  });
  if (!role) return null;

  const modules: Record<string, ModuleGrant> = {};
  for (const p of role.permissions) {
    // Rows for modules that no longer exist in the registry are ignored, not fatal.
    if (!defaultRegistry.hasModule(p.moduleKey)) continue;
    modules[p.moduleKey] = { actions: p.actions as Action[], reach: p.reach };
  }
  const fields: Record<string, Record<string, FieldRule>> = {};
  for (const f of role.fieldPermissions) {
    const forModule = (fields[f.moduleKey] ??= {});
    forModule[f.fieldKey] = {
      access: f.access,
      ownRecord: f.ownRecord,
      needsApproval: f.needsApproval,
    };
  }
  return { roleId: role.id, roleName: role.name, isOwner: role.isOwner, modules, fields };
}

/** The organisation's live custom lists; each is also a field of `tasks`. */
export async function liveCustomLists(db: ScopedTx): Promise<{ id: string; name: string }[]> {
  return db.taskList.findMany({
    where: { archivedAt: null },
    select: { id: true, name: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

/** The registry for one organisation: the shared one plus its custom lists. */
export async function loadOrgRegistry(db: ScopedTx): Promise<Registry> {
  return orgRegistry(defaultRegistry, await liveCustomLists(db));
}

/**
 * Builds the permission context for one signed-in person: their role, school
 * scope, whole reporting tree and the automatic-role switches.
 */
export async function loadPermissions(
  data: DataAccess,
  db: ScopedTx,
  user: { id: string; organisationId: string },
): Promise<LoadedPermissions> {
  const [assignment, switches, team, registry] = await Promise.all([
    db.roleAssignment.findFirst({
      where: { userId: user.id },
      select: {
        roleId: true,
        scopeAllSchools: true,
        schools: { select: { schoolId: true }, where: { school: { deletedAt: null } } },
      },
    }),
    db.automaticRoleSetting.findMany({ select: { switchKey: true, enabled: true } }),
    data.teamUserIds(user.organisationId, user.id),
    loadOrgRegistry(db),
  ]);

  const role = assignment ? await loadRoleGrants(db, assignment.roleId) : null;
  const ctx: PermissionContext = {
    registry,
    userId: user.id,
    role,
    scope: {
      allSchools: assignment?.scopeAllSchools ?? false,
      schoolIds: assignment?.schools.map((s) => s.schoolId) ?? [],
    },
    teamUserIds: new Set(team),
    managerSwitches: Object.fromEntries(switches.map((s) => [s.switchKey, s.enabled])),
  };
  return { ctx, teamUserIds: team };
}
