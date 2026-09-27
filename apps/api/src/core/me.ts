import { ACTION_TEXT, REACH_TEXT, meSchema } from '@kidzonia/shared';
import type { Me, RoleGrants } from '@kidzonia/shared';
import { previewStartSchema, selectSchoolSchema } from '@kidzonia/shared';
import { withUnitOfWork } from '../db/index.js';
import type { DataAccess } from '../db/index.js';
import type { AppDeps } from '../deps.js';
import type { AuthInfo } from '../http/types.js';
import { parse } from '../http/validate.js';
import { resolvePreview } from './access.js';
import { countToApprove } from './field-changes/service.js';
import { liveCustomLists } from './permission-context.js';
import { logoUrl } from './organisation/routes.js';
import type { LoadedPermissions } from './permission-context.js';
import type { RouteDef } from '../http/routes.js';
import { businessRule, notLoggedIn } from '../lib/errors.js';

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

/** The school switcher: shown when the scope covers more than one school (brief 7.6). */
async function schoolSwitcher(auth: AuthInfo, self: LoadedPermissions) {
  const ctx = self.ctx;
  const all = ctx.role?.isOwner === true || ctx.scope.allSchools;
  const schools = await auth.db.school.findMany({
    where: { deletedAt: null, ...(all ? {} : { id: { in: [...ctx.scope.schoolIds] } }) },
    select: { id: true, name: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return {
    switchableSchools: schools.length > 1 ? schools : [],
    selectedSchool: schools.find((s) => s.id === self.selectedSchoolId) ?? null,
  };
}

export async function buildMe(auth: AuthInfo, data: DataAccess, now: Date): Promise<Me> {
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
    customLists: await liveCustomLists(auth.db),
    serverTime: now.toISOString(),
    ...(await schoolSwitcher(auth, self)),
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
        res.json(await buildMe(req.auth, deps.data, deps.now()));
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
      // School switcher: remembered per person; only schools in their scope (brief 7.6).
      method: 'put',
      path: '/me/school',
      access: 'authenticated',
      guardWrites: false,
      handler: async (req, res) => {
        if (!req.auth) throw notLoggedIn();
        const auth = req.auth;
        const { schoolId } = parse(selectSchoolSchema, req.body);
        const self = await auth.permissions();
        if (schoolId) {
          const { switchableSchools } = await schoolSwitcher(auth, self);
          if (!switchableSchools.some((s) => s.id === schoolId)) {
            throw businessRule('Choose one of your schools.', {
              schoolId: 'Not one of your schools.',
            });
          }
        }
        await withUnitOfWork(auth.db, auth.actor, async (uow) => {
          await uow.tx.user.update({
            where: { id: auth.userId },
            data: { selectedSchoolId: schoolId },
            select: { id: true, homeSchoolId: true },
          });
        });
        res.status(204).end();
      },
    },
    {
      method: 'get',
      path: '/registry',
      access: 'authenticated',
      handler: async (req, res) => {
        if (!req.auth) throw notLoggedIn();
        // This organisation's registry (custom lists included), as plain data.
        const { registry } = (await req.auth.permissions()).ctx;
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
