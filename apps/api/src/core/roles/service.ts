import {
  canConfigureFields,
  checkRoleDelete,
  checkRoleEdit,
  describePower,
  fieldView,
  normalizeActions,
  powerAdded,
  powerBeyond,
  registry,
  toPage,
} from '@kidzonia/shared';
import type {
  Action,
  Assignment,
  FieldRule,
  ModuleGrant,
  Page,
  RoleDetail,
  Registry,
  RoleGrants,
  RoleSummary,
  SchoolScope,
} from '@kidzonia/shared';
import { mapDbError, withUnitOfWork } from '../../db/index.js';
import type { ScopedTx } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import type { AuthInfo } from '../../http/types.js';
import { businessRule, conflict, invalidInput, notAllowed, notFound } from '../../lib/errors.js';
import { requireModule, requireWritable } from '../guards.js';
import { loadRoleGrants } from '../permission-context.js';
import { userFacts } from '../users/facts.js';
import {
  assertCanGiveRole,
  assertCanManagePerson,
  assertKeepsAnOwner,
  setAssignment,
} from './rules.js';

type ModulesInput = Record<string, { actions: Action[]; reach: ModuleGrant['reach'] }>;
type FieldsInput = Record<string, Record<string, FieldRule>>;

const ROLES = 'roles';

/** Validates and canonicalises a whole permissions table (rule 3, unknown keys refused). */
function normaliseModules(registry: Registry, input: ModulesInput): Record<string, ModuleGrant> {
  const out: Record<string, ModuleGrant> = {};
  for (const [key, grant] of Object.entries(input)) {
    if (!registry.hasModule(key)) throw invalidInput(`Unknown section "${key}".`);
    const mod = registry.module(key);
    const actions = normalizeActions(mod, grant.actions);
    if (actions.length === 0) continue;
    out[key] = { actions, reach: mod.hasReach ? (grant.reach ?? 'own') : null };
  }
  return out;
}

function normaliseFields(
  registry: Registry,
  input: FieldsInput,
  modules: RoleGrants['modules'],
): Record<string, Record<string, FieldRule>> {
  const out: Record<string, Record<string, FieldRule>> = {};
  for (const [moduleKey, fields] of Object.entries(input)) {
    if (!registry.hasModule(moduleKey)) throw invalidInput(`Unknown section "${moduleKey}".`);
    const mod = registry.module(moduleKey);
    // Rule 6: field permissions only apply once the role can view the section.
    if (!canConfigureFields(modules[moduleKey])) {
      throw businessRule(`Turn on View for ${mod.name} first.`);
    }
    for (const [fieldKey, rule] of Object.entries(fields)) {
      if (!(mod.fields ?? []).some((f) => f.key === fieldKey)) {
        throw invalidInput(`Unknown field "${fieldKey}" in ${mod.name}.`);
      }
      (out[moduleKey] ??= {})[fieldKey] = {
        access: rule.access,
        // "On their own records" only matters when the field isn't already editable.
        ownRecord: rule.access === 'edit' ? 'same' : rule.ownRecord,
        needsApproval: rule.needsApproval,
      };
    }
  }
  return out;
}

const grantsJson = (g: RoleGrants) => ({ modules: g.modules, fields: g.fields });

export class RolesService {
  constructor(private readonly deps: AppDeps) {}

  private async roleRow(tx: ScopedTx, id: string) {
    const role = await tx.role.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        isOwner: true,
        _count: { select: { assignments: { where: { user: { deletedAt: null } } } } },
      },
    });
    if (!role) throw notFound('That role');
    return role;
  }

  private summary(
    row: {
      id: string;
      name: string;
      description: string | null;
      isOwner: boolean;
      _count: { assignments: number };
    },
    grants: RoleGrants | null,
  ): RoleSummary {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isOwner: row.isOwner,
      peopleCount: row._count.assignments,
      modulesOn: row.isOwner ? registry.modules.length : Object.keys(grants?.modules ?? {}).length,
    };
  }

  async list(
    auth: AuthInfo,
    page: { cursor?: string | undefined; limit: number },
  ): Promise<Page<RoleSummary>> {
    const access = await auth.access();
    requireModule(access, ROLES, 'view');
    const rows = await auth.db.role.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        isOwner: true,
        _count: { select: { assignments: { where: { user: { deletedAt: null } } } } },
      },
      orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: page.limit + 1,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    });
    const windowed = toPage(rows, page.limit);
    const items = await Promise.all(
      windowed.items.map(async (r) => this.summary(r, await loadRoleGrants(auth.db, r.id))),
    );
    return { items, nextCursor: windowed.nextCursor };
  }

  /**
   * Roles this person may give (addition b's rule applied to giving): used by
   * the Add user drawer, including for franchise owners who can't see Roles.
   */
  async assignable(
    auth: AuthInfo,
    page: { cursor?: string | undefined; limit: number },
  ): Promise<Page<{ id: string; name: string; seedKey: string | null }>> {
    const access = await auth.access();
    if (
      !access.can('users', 'create') &&
      !access.can('users', 'edit') &&
      !access.can(ROLES, 'edit')
    ) {
      throw notAllowed();
    }
    const self = await auth.permissions();
    const rows = await auth.db.role.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, isOwner: true, seedKey: true },
      orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: page.limit + 1,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    });
    const windowed = toPage(rows, page.limit);
    // seedKey lets the app pre-select a starter role without matching on its editable name.
    const items: { id: string; name: string; seedKey: string | null }[] = [];
    for (const r of windowed.items) {
      const g = await loadRoleGrants(auth.db, r.id);
      if (g && powerBeyond(self.ctx.registry, g, self.ctx.role).length === 0)
        items.push({ id: r.id, name: r.name, seedKey: r.seedKey });
    }
    return { items, nextCursor: windowed.nextCursor };
  }

  async detail(auth: AuthInfo, id: string): Promise<RoleDetail> {
    const access = await auth.access();
    requireModule(access, ROLES, 'view');
    const row = await this.roleRow(auth.db, id);
    const grants = await loadRoleGrants(auth.db, id);
    if (!grants) throw notFound('That role');
    return {
      ...this.summary(row, grants),
      modules: row.isOwner ? {} : (grantsJson(grants).modules as RoleDetail['modules']),
      fields: row.isOwner ? {} : (grantsJson(grants).fields as RoleDetail['fields']),
      canEdit: !row.isOwner && !access.readOnly && access.can(ROLES, 'edit'),
    };
  }

  async create(
    auth: AuthInfo,
    input: { name: string; description: string | null; copyFromRoleId?: string | null | undefined },
  ) {
    const access = await auth.access();
    const self = await auth.permissions();
    requireWritable(access);
    requireModule(access, ROLES, 'create');
    const source = input.copyFromRoleId
      ? await loadRoleGrants(auth.db, input.copyFromRoleId)
      : null;
    if (input.copyFromRoleId && !source) throw notFound('The role to copy from');
    if (source?.isOwner)
      throw businessRule('The Owner role can’t be copied. Start from another role.');
    if (source) {
      const beyond = powerBeyond(self.ctx.registry, source, self.ctx.role);
      if (beyond.length > 0) throw notAllowed(describePower(beyond));
    }
    const id = await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      const role = await uow.tx.role.create({
        data: {
          organisationId: auth.organisationId,
          name: input.name,
          description: input.description,
          createdFromRoleId: input.copyFromRoleId ?? null,
        },
        select: { id: true },
      });
      if (source)
        await this.writeGrants(uow.tx, auth.organisationId, role.id, source.modules, source.fields);
      uow.audit({
        action: 'role.created',
        entityType: 'role',
        entityId: role.id,
        after: { name: input.name, copiedFrom: input.copyFromRoleId ?? null },
      });
      return role.id;
    }).catch((err: unknown) => {
      throw this.nameClash(err);
    });
    return this.detail(auth, id);
  }

  private nameClash(err: unknown): unknown {
    // Role names are the only unique field these writes touch.
    if (mapDbError(err)?.code === 'conflict')
      return conflict('A role with that name already exists.');
    return err;
  }

  private async writeGrants(
    tx: ScopedTx,
    organisationId: string,
    roleId: string,
    modules: RoleGrants['modules'],
    fields: RoleGrants['fields'],
  ): Promise<void> {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    await tx.roleFieldPermission.deleteMany({ where: { roleId } });
    const perms = Object.entries(modules).flatMap(([moduleKey, g]) =>
      g ? [{ organisationId, roleId, moduleKey, actions: [...g.actions], reach: g.reach }] : [],
    );
    if (perms.length > 0) await tx.rolePermission.createMany({ data: perms });
    const fieldRows = Object.entries(fields).flatMap(([moduleKey, fs]) =>
      Object.entries(fs ?? {}).flatMap(([fieldKey, r]) =>
        r ? [{ organisationId, roleId, moduleKey, fieldKey, ...r }] : [],
      ),
    );
    if (fieldRows.length > 0) await tx.roleFieldPermission.createMany({ data: fieldRows });
  }

  private async editable(auth: AuthInfo, id: string) {
    const access = await auth.access();
    requireWritable(access);
    requireModule(access, ROLES, 'edit');
    const row = await this.roleRow(auth.db, id);
    const guard = checkRoleEdit(row);
    if (!guard.ok) throw businessRule(guard.message);
    const before = await loadRoleGrants(auth.db, id);
    if (!before) throw notFound('That role');
    return { row, before };
  }

  async rename(
    auth: AuthInfo,
    id: string,
    patch: { name?: string | undefined; description?: string | null | undefined },
  ) {
    await this.editable(auth, id);
    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      const before = await uow.tx.role.findFirst({
        where: { id },
        select: { name: true, description: true },
      });
      await uow.tx.role.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          updatedBy: auth.userId,
        },
        select: { id: true },
      });
      uow.audit({ action: 'role.renamed', entityType: 'role', entityId: id, before, after: patch });
    }).catch((err: unknown) => {
      throw this.nameClash(err);
    });
    return this.detail(auth, id);
  }

  /** Addition b: an edit may not add power beyond the editor's own role. */
  private assertNoAddedPower(
    registry: Registry,
    self: RoleGrants | null,
    before: RoleGrants,
    after: RoleGrants,
  ) {
    const added = powerAdded(registry, before, after, self);
    if (added.length > 0) throw notAllowed(describePower(added));
  }

  async setPermissions(auth: AuthInfo, id: string, input: ModulesInput) {
    const { before } = await this.editable(auth, id);
    const self = await auth.permissions();
    const modules = normaliseModules(self.ctx.registry, input);
    // Turning a section off also clears its field rules (rule 6).
    const fields = Object.fromEntries(
      Object.entries(before.fields).filter(([k]) => modules[k]?.actions.includes('view')),
    );
    const after: RoleGrants = { ...before, modules, fields };
    this.assertNoAddedPower(self.ctx.registry, self.ctx.role, before, after);
    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      await this.writeGrants(uow.tx, auth.organisationId, id, modules, fields);
      await uow.tx.role.update({
        where: { id },
        data: { updatedBy: auth.userId },
        select: { id: true },
      });
      uow.audit({
        action: 'role.permissions_changed',
        entityType: 'role',
        entityId: id,
        before: grantsJson(before),
        after: grantsJson(after),
      });
    });
    return this.detail(auth, id);
  }

  async setFields(auth: AuthInfo, id: string, input: FieldsInput) {
    const { before } = await this.editable(auth, id);
    const self = await auth.permissions();
    // The organisation's registry: custom task lists are fields too.
    const fields = normaliseFields(self.ctx.registry, input, before.modules);
    const after: RoleGrants = { ...before, fields };
    this.assertNoAddedPower(self.ctx.registry, self.ctx.role, before, after);
    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      await this.writeGrants(uow.tx, auth.organisationId, id, before.modules, fields);
      await uow.tx.role.update({
        where: { id },
        data: { updatedBy: auth.userId },
        select: { id: true },
      });
      uow.audit({
        action: 'role.fields_changed',
        entityType: 'role',
        entityId: id,
        before: grantsJson(before),
        after: grantsJson(after),
      });
    });
    return this.detail(auth, id);
  }

  async remove(auth: AuthInfo, id: string) {
    const access = await auth.access();
    requireWritable(access);
    requireModule(access, ROLES, 'delete');
    const row = await this.roleRow(auth.db, id);
    const guard = checkRoleDelete(row);
    if (!guard.ok) throw businessRule(guard.message);
    const holders = row._count.assignments;
    if (holders > 0) {
      throw conflict(
        `${holders} ${holders === 1 ? 'person has' : 'people have'} this role. Move them to another role first.`,
      );
    }
    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      await uow.tx.role.update({
        where: { id },
        data: { deletedAt: this.deps.now(), updatedBy: auth.userId },
        select: { id: true },
      });
      uow.audit({
        action: 'role.deleted',
        entityType: 'role',
        entityId: id,
        before: { name: row.name },
      });
    });
  }

  // ---------- people with the role ("Manage people") ----------

  async holders(
    auth: AuthInfo,
    id: string,
    page: { cursor?: string | undefined; limit: number },
  ): Promise<Page<Assignment>> {
    const access = await auth.access();
    requireModule(access, ROLES, 'view');
    await this.roleRow(auth.db, id);
    const rows = await auth.db.roleAssignment.findMany({
      where: { roleId: id, user: { deletedAt: null } },
      select: {
        id: true,
        userId: true,
        scopeAllSchools: true,
        schools: { select: { schoolId: true } },
        user: {
          select: {
            id: true,
            fullName: true,
            jobTitle: true,
            homeSchoolId: true,
            homeSchool: { select: { name: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: page.limit + 1,
      ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    });
    const windowed = toPage(rows, page.limit);
    // People outside the viewer's reach in Users aren't listed by name.
    const items = windowed.items
      .filter((r) => access.can('users', 'view', userFacts(r.user)))
      .map((r) => {
        // Names and schools follow the viewer's Users field permissions, as everywhere else.
        const seen = fieldView(access, 'users', userFacts(r.user)).sees;
        return { r, name: seen('fullName'), school: seen('school') };
      })
      .map(({ r, name, school }) => ({
        userId: r.userId,
        fullName: name ? r.user.fullName : 'Name hidden',
        jobTitle: r.user.jobTitle,
        homeSchoolName: school ? (r.user.homeSchool?.name ?? null) : null,
        scope: { allSchools: r.scopeAllSchools, schoolIds: r.schools.map((s) => s.schoolId) },
      }));
    return { items, nextCursor: windowed.nextCursor };
  }

  async addHolder(auth: AuthInfo, roleId: string, userId: string, scope: SchoolScope) {
    const access = await auth.access();
    const self = await auth.permissions();
    requireWritable(access);
    requireModule(access, ROLES, 'edit');
    const user = await auth.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, homeSchoolId: true },
    });
    if (!user || !access.can('users', 'view', userFacts(user))) throw notFound('That person');
    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      await assertCanManagePerson(uow.tx, self, userId);
      const role = await assertCanGiveRole(uow.tx, self, roleId, scope);
      if (!role.isOwner) await assertKeepsAnOwner(uow.tx, userId);
      await setAssignment(uow.tx, auth.organisationId, userId, { roleId, scope });
      uow.audit({
        action: 'role.given',
        entityType: 'user',
        entityId: userId,
        after: { roleId, scope },
      });
    });
    this.deps.schedule.request(auth.organisationId);
  }

  async removeHolder(auth: AuthInfo, roleId: string, userId: string) {
    const access = await auth.access();
    const self = await auth.permissions();
    requireWritable(access);
    requireModule(access, ROLES, 'edit');
    const a = await auth.db.roleAssignment.findFirst({
      where: { roleId, userId, user: { deletedAt: null } },
      select: { user: { select: { id: true, homeSchoolId: true } } },
    });
    if (!a || !access.can('users', 'view', userFacts(a.user))) throw notFound('That person');
    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      await assertCanManagePerson(uow.tx, self, userId);
      await assertKeepsAnOwner(uow.tx, userId);
      await setAssignment(uow.tx, auth.organisationId, userId, null);
      for (const hook of this.deps.hooks.roleRemoved) await hook(uow, userId, this.deps.now());
      uow.audit({
        action: 'role.removed',
        entityType: 'user',
        entityId: userId,
        before: { roleId },
      });
    });
    this.deps.schedule.request(auth.organisationId);
  }

  // ---------- automatic roles ----------

  async automatic(auth: AuthInfo) {
    const access = await auth.access();
    requireModule(access, ROLES, 'view');
    const rows = await auth.db.automaticRoleSetting.findMany({
      select: { switchKey: true, enabled: true },
    });
    const stored = new Map(rows.map((r) => [r.switchKey, r.enabled]));
    return {
      switches: registry.managerSwitches().map((s) => ({
        key: s.key,
        label: s.label,
        description: s.description,
        enabled: stored.get(s.key) ?? s.defaultOn,
      })),
    };
  }

  async setAutomatic(auth: AuthInfo, switches: Record<string, boolean>) {
    const access = await auth.access();
    requireWritable(access);
    requireModule(access, ROLES, 'edit');
    // These switches change every reporting manager's powers at once, so only
    // an Owner may change them (decided after Phase 2).
    const self = await auth.permissions();
    if (!self.ctx.role?.isOwner) throw notAllowed('Only an Owner can change automatic roles.');
    const known = new Set(registry.managerSwitches().map((s) => s.key));
    for (const key of Object.keys(switches)) {
      if (!known.has(key)) throw invalidInput(`Unknown setting "${key}".`);
    }
    const before = await this.automatic(auth);
    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      for (const [switchKey, enabled] of Object.entries(switches)) {
        await uow.tx.automaticRoleSetting.upsert({
          where: { organisationId_switchKey: { organisationId: auth.organisationId, switchKey } },
          create: {
            organisationId: auth.organisationId,
            switchKey,
            enabled,
            updatedBy: auth.userId,
          },
          update: { enabled, updatedBy: auth.userId },
        });
      }
      uow.audit({
        action: 'automatic_roles.changed',
        entityType: 'organisation',
        entityId: auth.organisationId,
        before: Object.fromEntries(before.switches.map((s) => [s.key, s.enabled])),
        after: switches,
      });
    });
    return this.automatic(auth);
  }
}
