import { ACTION_TEXT, REACH_TEXT, meSchema, registry } from '@kidzonia/shared';
import type { Me, RoleGrants } from '@kidzonia/shared';
import type { AuthInfo } from '../http/types.js';
import type { RouteDef } from '../http/routes.js';
import { notLoggedIn } from '../lib/errors.js';

const definedOnly = <T>(r: Readonly<Partial<Record<string, T>>>): Record<string, T> =>
  Object.fromEntries(Object.entries(r).filter((e): e is [string, T] => e[1] !== undefined));

function toJsonGrants(role: RoleGrants): NonNullable<Me['role']> {
  return {
    roleId: role.roleId,
    roleName: role.roleName,
    isOwner: role.isOwner,
    modules: Object.fromEntries(
      Object.entries(definedOnly(role.modules)).map(([k, g]) => [
        k,
        { actions: [...g.actions], reach: g.reach },
      ]),
    ),
    fields: Object.fromEntries(
      Object.entries(definedOnly(role.fields)).map(([k, f]) => [k, definedOnly(f)]),
    ),
  };
}

/** Who to ask for access: their reporting manager if they have one, else an Owner. */
async function askForAccess(auth: AuthInfo, reportsToUserId: string | null) {
  const person = { id: true, fullName: true, jobTitle: true } as const;
  if (reportsToUserId) {
    const manager = await auth.db.user.findFirst({
      where: { id: reportsToUserId, deletedAt: null, status: { not: 'inactive' } },
      select: person,
    });
    if (manager) return manager;
  }
  const owner = await auth.db.roleAssignment.findFirst({
    where: {
      role: { isOwner: true, deletedAt: null },
      user: { deletedAt: null, status: { not: 'inactive' }, id: { not: auth.userId } },
    },
    orderBy: { createdAt: 'asc' },
    select: { user: { select: person } },
  });
  return owner?.user ?? null;
}

export async function buildMe(auth: AuthInfo): Promise<Me> {
  const [user, organisation, loaded] = await Promise.all([
    auth.db.user.findFirst({
      where: { id: auth.userId },
      select: {
        id: true,
        fullName: true,
        jobTitle: true,
        reportsToUserId: true,
        homeSchoolId: true,
        homeSchool: { select: { name: true } },
      },
    }),
    auth.db.organisation.findFirst({
      select: { id: true, name: true, setupType: true, timezone: true },
    }),
    auth.permissions(),
  ]);
  if (!user || !organisation) throw notLoggedIn();
  const ctx = loaded.ctx;

  // Parsing through the shared schema strips anything not whitelisted there.
  return meSchema.parse({
    user: {
      id: user.id,
      fullName: user.fullName,
      jobTitle: user.jobTitle,
      photoUrl: null,
      homeSchoolId: user.homeSchoolId,
      homeSchoolName: user.homeSchool?.name ?? null,
    },
    organisation: { ...organisation, logoUrl: null },
    role: ctx.role ? toJsonGrants(ctx.role) : null,
    scope: { allSchools: ctx.scope.allSchools, schoolIds: [...ctx.scope.schoolIds] },
    teamUserIds: loaded.teamUserIds,
    managerSwitches: definedOnly(ctx.managerSwitches),
    askForAccess: ctx.role ? null : await askForAccess(auth, user.reportsToUserId),
  } satisfies Me);
}

export function meRoutes(): RouteDef[] {
  return [
    {
      method: 'get',
      path: '/me',
      access: 'authenticated',
      handler: async (req, res) => {
        if (!req.auth) throw notLoggedIn();
        res.json(await buildMe(req.auth));
      },
    },
    {
      method: 'get',
      path: '/registry',
      access: 'authenticated',
      handler: (_req, res) => {
        // Plain data only; the client rebuilds the same registry from @kidzonia/shared.
        res.json({
          apps: registry.apps,
          modules: registry.modules,
          actions: ACTION_TEXT,
          reaches: REACH_TEXT,
        });
      },
    },
  ];
}
