import { ACTION_TEXT, REACH_TEXT, meSchema, registry } from '@kidzonia/shared';
import type { Me, RoleGrants } from '@kidzonia/shared';
import { previewStartSchema } from '@kidzonia/shared';
import { withUnitOfWork } from '../db/index.js';
import type { DataAccess } from '../db/index.js';
import type { AppDeps } from '../deps.js';
import type { AuthInfo } from '../http/types.js';
import { parse } from '../http/validate.js';
import { resolvePreview } from './access.js';
import { countToApprove } from './field-changes/service.js';
import { logoUrl } from './organisation/routes.js';
import type { LoadedPermissions } from './permission-context.js';
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

function grantsPayload(loaded: LoadedPermissions) {
  const ctx = loaded.ctx;
  return {
    role: ctx.role ? toJsonGrants(ctx.role) : null,
    scope: { allSchools: ctx.scope.allSchools, schoolIds: [...ctx.scope.schoolIds] },
    teamUserIds: loaded.teamUserIds,
    managerSwitches: definedOnly(ctx.managerSwitches),
  };
}

export async function buildMe(auth: AuthInfo, data: DataAccess): Promise<Me> {
  // During a preview "me" is the previewed person; the previewer rides along.
  const subjectId = auth.preview?.userId ?? auth.userId;
  const [user, organisation, self] = await Promise.all([
    auth.db.user.findFirst({
      where: { id: subjectId },
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
      select: { id: true, name: true, setupType: true, timezone: true, logoKey: true },
    }),
    auth.permissions(),
  ]);
  if (!user || !organisation) throw notLoggedIn();
  const loaded = auth.preview?.permissions ?? self;
  const ctx = loaded.ctx;
  const previewer = auth.preview
    ? await auth.db.user.findFirst({
        where: { id: auth.userId },
        select: { id: true, fullName: true, jobTitle: true },
      })
    : null;
  const { logoKey, ...org } = organisation;

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
    organisation: { ...org, logoUrl: logoUrl(logoKey) },
    ...grantsPayload(loaded),
    askForAccess: ctx.role ? null : await askForAccess(auth, user.reportsToUserId),
    changesToApprove: auth.preview ? 0 : await countToApprove(auth, data),
    preview: auth.preview && previewer ? { previewer, ...grantsPayload(self) } : null,
  } satisfies Me);
}

export function meRoutes(deps: AppDeps): RouteDef[] {
  return [
    {
      method: 'get',
      path: '/me',
      access: 'authenticated',
      handler: async (req, res) => {
        if (!req.auth) throw notLoggedIn();
        res.json(await buildMe(req.auth, deps.data));
      },
    },
    {
      // Starting a preview is checked and written to the audit log; the app
      // then sends the preview header on its (read-only) requests.
      method: 'post',
      path: '/preview',
      access: 'authenticated',
      guardWrites: false,
      handler: async (req, res) => {
        if (!req.auth) throw notLoggedIn();
        const auth = req.auth;
        const { userId } = parse(previewStartSchema, req.body);
        const target = await resolvePreview(deps.data, auth.db, await auth.permissions(), userId);
        await withUnitOfWork(auth.db, auth.actor, (uow) => {
          uow.audit({
            action: 'preview.started',
            entityType: 'user',
            entityId: target.userId,
            after: { roleId: target.permissions.ctx.role?.roleId ?? null },
          });
          return Promise.resolve();
        });
        res.status(204).end();
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
