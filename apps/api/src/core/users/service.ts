import { isDeepStrictEqual } from 'node:util';
import { uuidv7 } from 'uuidv7';
import { createUserSchema, reachOf, registry, toPage } from '@kidzonia/shared';
import type { Access, SchoolScope } from '@kidzonia/shared';
import type { z } from 'zod';
import type { userListQuerySchema, updateUserSchema } from '@kidzonia/shared';
import { withUnitOfWork } from '../../db/index.js';
import type { Prisma, ScopedTx } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import type { AuthInfo } from '../../http/types.js';
import { AppError, businessRule, conflict, invalidInput, notFound } from '../../lib/errors.js';
import { requestFieldChanges } from '../field-changes/service.js';
import type { RequestedChange } from '../field-changes/service.js';
import { checkWritableFields, requireModule, requireRecord, requireWritable } from '../guards.js';
import type { LoadedPermissions } from '../permission-context.js';
import {
  assertCanGiveRole,
  assertCanManagePerson,
  assertKeepsAnOwner,
  setAssignment,
} from '../roles/rules.js';
import { newUserFacts, userFacts, userScopeWhere } from './facts.js';
import { USER_SELECT, editableValues, findLiveUser, toUserData, toUserRecord } from './records.js';
import type { EditableUser, UserRow } from './records.js';

type ListQuery = z.output<typeof userListQuerySchema>;
type UserPatch = z.output<typeof updateUserSchema>;
type NewUser = z.output<typeof createUserSchema>;

const fullUserSchema = createUserSchema.omit({ role: true, sendInvite: true });
const USERS = 'users';
const usersModule = registry.module(USERS);

/** The registry field a stored prop belongs to (e.g. homeSchoolId → school). */
function fieldOf(prop: string): string | null {
  return (usersModule.fields ?? []).find((f) => (f.props ?? [f.key]).includes(prop))?.key ?? null;
}

/** Hidden fields can't be searched, filtered or sorted on (addition d). */
function visible(access: Access, fieldKey: string): boolean {
  return access.fieldAccess(USERS, fieldKey) !== 'hidden';
}

export class UsersService {
  constructor(private readonly deps: AppDeps) {}

  private scopeWhere(access: Access): Prisma.UserWhereInput[] {
    return access.scopes(USERS).map(userScopeWhere);
  }

  present(access: Access, row: UserRow) {
    return access.serialize(USERS, toUserRecord(row), userFacts(row));
  }

  async list(auth: AuthInfo, q: ListQuery) {
    const access = await auth.access();
    requireModule(access, USERS, 'view');
    const and: Prisma.UserWhereInput[] = [{ deletedAt: null }, ...this.scopeWhere(access)];

    if (q.search) {
      const term = q.search;
      const digits = term.replace(/\D/g, '');
      const or: Prisma.UserWhereInput[] = [];
      if (visible(access, 'fullName'))
        or.push({ fullName: { contains: term, mode: 'insensitive' } });
      if (visible(access, 'email')) or.push({ email: { contains: term, mode: 'insensitive' } });
      if (visible(access, 'employeeId')) {
        or.push({ employeeId: { contains: term, mode: 'insensitive' } });
      }
      if (visible(access, 'mobile') && digits.length >= 3)
        or.push({ mobile: { contains: digits } });
      // Nothing searchable is visible: match nobody rather than leak through search.
      and.push(or.length > 0 ? { OR: or } : { id: { in: [] } });
    }
    if (q.schoolId) {
      if (!visible(access, 'school')) throw invalidInput('You can’t filter by school.');
      and.push({ homeSchoolId: q.schoolId === 'head_office' ? null : q.schoolId });
    }
    if (q.roleId)
      and.push(
        q.roleId === 'none' ? { roleAssignment: null } : { roleAssignment: { roleId: q.roleId } },
      );
    if (q.status) and.push({ status: q.status });

    const sortField = {
      name: 'fullName',
      mobile: 'mobile',
      employeeId: 'employeeId',
      school: 'school',
      createdAt: null,
    }[q.sort];
    if (sortField && !visible(access, sortField)) throw invalidInput('You can’t sort by that.');
    const orderBy: Prisma.UserOrderByWithRelationInput[] = [
      q.sort === 'name'
        ? { fullName: 'asc' }
        : q.sort === 'mobile'
          ? { mobile: 'asc' }
          : q.sort === 'employeeId'
            ? { employeeId: { sort: 'asc', nulls: 'last' } }
            : q.sort === 'school'
              ? { homeSchool: { name: 'asc' } }
              : { createdAt: 'desc' },
      { id: 'asc' },
    ];

    const rows = await auth.db.user.findMany({
      where: { AND: and },
      select: USER_SELECT,
      orderBy,
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, q.limit);
    return { items: page.items.map((r) => this.present(access, r)), nextCursor: page.nextCursor };
  }

  async summary(auth: AuthInfo) {
    const access = await auth.access();
    requireModule(access, USERS, 'view');
    const base: Prisma.UserWhereInput = { AND: [{ deletedAt: null }, ...this.scopeWhere(access)] };
    const [total, waitingForRole] = await Promise.all([
      auth.db.user.count({ where: base }),
      auth.db.user.count({
        where: { AND: [base, { roleAssignment: null }, { status: { not: 'inactive' } }] },
      }),
    ]);
    return { total, waitingForRole };
  }

  /** A record the person can see, or 404. */
  async visibleRow(auth: AuthInfo, id: string, action = 'view'): Promise<UserRow> {
    const access = await auth.access();
    const row = await findLiveUser(auth.db, id);
    if (!row) throw notFound('That person');
    requireRecord(access, USERS, action, userFacts(row), 'That person');
    return row;
  }

  async get(auth: AuthInfo, id: string) {
    const row = await this.visibleRow(auth, id);
    return this.present(await auth.access(), row);
  }

  // ---------- rules shared by create and update ----------

  /** Addition c: people can only be placed in schools the editor looks after. */
  private assertSchoolInReach(self: LoadedPermissions, schoolId: string | null): void {
    const ctx = self.ctx;
    if (ctx.role?.isOwner || reachOf(ctx, USERS) === 'all') return;
    const ok =
      schoolId !== null && (ctx.scope.allSchools || ctx.scope.schoolIds.includes(schoolId));
    if (!ok) {
      throw new AppError('not_allowed', 'You can only place people in schools you look after.', {
        homeSchoolId: 'Choose a school you look after.',
      });
    }
  }

  /** Addition c: the new manager must be someone the editor can see. */
  private async assertManagerInReach(
    tx: ScopedTx,
    access: Access,
    managerId: string,
  ): Promise<void> {
    const m = await tx.user.findFirst({
      where: { id: managerId, deletedAt: null, status: { not: 'inactive' } },
      select: { id: true, homeSchoolId: true },
    });
    if (!m || !access.can(USERS, 'view', userFacts(m))) {
      throw businessRule('Choose someone you can see in Users.', {
        reportsToUserId: 'Choose someone you can see in Users.',
      });
    }
  }

  private async assertMobileFree(tx: ScopedTx, mobile: string, exceptId?: string): Promise<void> {
    const clash = await tx.user.findFirst({
      where: { mobile, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw new AppError(
        'conflict',
        'Someone in your organisation already uses that mobile number.',
        {
          mobile: 'Already used by someone in your organisation.',
        },
      );
    }
  }

  private async sendInvite(auth: AuthInfo, userId: string, mobile: string) {
    await this.deps.rateLimits.consumeInvite(userId);
    const [org, inviter] = await Promise.all([
      auth.db.organisation.findFirst({ select: { name: true } }),
      auth.db.user.findFirst({ where: { id: auth.userId }, select: { fullName: true } }),
    ]);
    await this.deps.messages.sendInvite(mobile, {
      organisationName: org?.name ?? 'Kidzonia 360',
      inviterName: inviter?.fullName ?? null,
      appUrl: this.deps.config.APP_URL,
    });
  }

  // ---------- writes ----------

  async create(auth: AuthInfo, input: NewUser) {
    const access = await auth.access();
    const self = await auth.permissions();
    requireWritable(access);
    const facts = newUserFacts(input.homeSchoolId);
    requireModule(access, USERS, 'create');
    this.assertSchoolInReach(self, input.homeSchoolId);
    const { role, sendInvite, ...person } = input;
    const provided = Object.entries(person)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k]) => k);
    checkWritableFields(access, USERS, provided, facts);

    const id = uuidv7();
    const now = this.deps.now();
    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      await this.assertMobileFree(uow.tx, person.mobile);
      if (person.reportsToUserId)
        await this.assertManagerInReach(uow.tx, access, person.reportsToUserId);
      if (role) await assertCanGiveRole(uow.tx, self, role.roleId, role.scope);
      await uow.tx.user.create({
        data: {
          id,
          organisationId: auth.organisationId,
          fullName: person.fullName,
          mobile: person.mobile,
          email: person.email ?? null,
          employeeId: person.employeeId ?? null,
          jobTitle: person.jobTitle ?? null,
          homeSchoolId: person.homeSchoolId,
          reportsToUserId: person.reportsToUserId ?? null,
          department: person.department ?? null,
          startDate: person.startDate ? new Date(`${person.startDate}T00:00:00Z`) : null,
          status: 'invited',
          invitedAt: sendInvite ? now : null,
        },
        select: { id: true, homeSchoolId: true },
      });
      if (role) await setAssignment(uow.tx, auth.organisationId, id, role);
      uow.audit({
        action: 'user.created',
        entityType: 'user',
        entityId: id,
        after: { ...person, role },
      });
    });
    if (sendInvite) await this.sendInvite(auth, id, person.mobile);
    return this.get(auth, id);
  }

  /**
   * Edits someone's details. Fields whose role says "changes need approval"
   * become pending changes; the rest are saved straight away.
   */
  async update(auth: AuthInfo, id: string, patch: UserPatch) {
    const access = await auth.access();
    const self = await auth.permissions();
    requireWritable(access);
    const row = await findLiveUser(auth.db, id);
    if (!row) throw notFound('That person');
    const facts = userFacts(row);
    requireRecord(access, USERS, 'view', facts, 'That person');

    const current = editableValues(row);
    // Only props that actually change count; re-sending a value is not an edit.
    const changes = Object.fromEntries(
      Object.entries(patch).filter(
        ([k, v]) => v !== undefined && !isDeepStrictEqual(v, current[k as keyof EditableUser]),
      ),
    ) as Partial<EditableUser>;
    const props = Object.keys(changes);
    if (props.length === 0) return { user: this.present(access, row), pending: [] as string[] };

    const pendingProps = checkWritableFields(access, USERS, props, facts);
    const merged = fullUserSchema.safeParse({ ...current, ...changes });
    if (!merged.success) {
      throw invalidInput(merged.error.issues[0]?.message ?? 'Please check the details.');
    }

    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      await assertCanManagePerson(uow.tx, self, id);
      if (changes.homeSchoolId !== undefined) this.assertSchoolInReach(self, changes.homeSchoolId);
      if (changes.mobile) await this.assertMobileFree(uow.tx, changes.mobile, id);
      if (changes.reportsToUserId) {
        await this.assertManagerInReach(uow.tx, access, changes.reportsToUserId);
        const team = await this.deps.data.teamUserIds(auth.organisationId, id);
        if (changes.reportsToUserId === id || team.includes(changes.reportsToUserId)) {
          throw businessRule('That would make someone report to themselves through their team.', {
            reportsToUserId: 'Choose someone who is not in this person’s team.',
          });
        }
      }

      const direct = Object.fromEntries(
        Object.entries(changes).filter(([k]) => !pendingProps.includes(k)),
      ) as Partial<EditableUser>;
      if (Object.keys(direct).length > 0) {
        await uow.tx.user.update({
          where: { id },
          data: toUserData(direct),
          select: { id: true, homeSchoolId: true },
        });
        uow.audit({
          action: 'user.updated',
          entityType: 'user',
          entityId: id,
          before: Object.fromEntries(
            Object.keys(direct).map((k) => [k, current[k as keyof EditableUser]]),
          ),
          after: direct,
        });
      }
      if (pendingProps.length > 0) {
        const byField = new Map<string, RequestedChange>();
        for (const prop of pendingProps) {
          const fieldKey = fieldOf(prop) ?? prop;
          const entry = byField.get(fieldKey) ?? { fieldKey, oldValue: {}, newValue: {} };
          entry.oldValue[prop] = current[prop as keyof EditableUser];
          entry.newValue[prop] = changes[prop as keyof EditableUser];
          byField.set(fieldKey, entry);
        }
        await requestFieldChanges(uow, {
          organisationId: auth.organisationId,
          moduleKey: USERS,
          recordId: id,
          subjectUserId: id,
          requestedBy: auth.userId,
          changes: [...byField.values()],
        });
      }
    });

    const pendingFields = [...new Set(pendingProps.map((p) => fieldOf(p) ?? p))];
    return { user: await this.get(auth, id), pending: pendingFields };
  }

  async setRole(auth: AuthInfo, id: string, role: { roleId: string; scope: SchoolScope } | null) {
    const access = await auth.access();
    const self = await auth.permissions();
    requireWritable(access);
    const row = await this.visibleRow(auth, id, 'edit');
    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      await assertCanManagePerson(uow.tx, self, id);
      if (role) {
        const given = await assertCanGiveRole(uow.tx, self, role.roleId, role.scope);
        if (!given.isOwner) await assertKeepsAnOwner(uow.tx, id);
      } else {
        await assertKeepsAnOwner(uow.tx, id);
      }
      await setAssignment(uow.tx, auth.organisationId, id, role);
      uow.audit({
        action: 'user.role_changed',
        entityType: 'user',
        entityId: id,
        before: row.roleAssignment
          ? { roleId: row.roleAssignment.roleId, allSchools: row.roleAssignment.scopeAllSchools }
          : null,
        after: role,
      });
    });
    return this.get(auth, id);
  }

  /**
   * Deactivates someone: they're signed out everywhere at once. Their direct
   * reports can move to a new manager in the same step (addition e); if not,
   * approvals for them go up the chain until someone is reassigned.
   */
  async deactivate(auth: AuthInfo, id: string, moveReportsTo: string | null | undefined) {
    const access = await auth.access();
    const self = await auth.permissions();
    requireWritable(access);
    if (id === auth.userId) throw businessRule('You can’t deactivate yourself.');
    const row = await this.visibleRow(auth, id, 'edit');
    if (row.status === 'inactive') throw conflict('This person is already inactive.');
    const now = this.deps.now();

    let moved = 0;
    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      await assertCanManagePerson(uow.tx, self, id);
      await assertKeepsAnOwner(uow.tx, id);
      if (moveReportsTo) {
        if (moveReportsTo === id) throw businessRule('Choose someone else as the new manager.');
        await this.assertManagerInReach(uow.tx, access, moveReportsTo);
        const movedRows = await uow.tx.user.updateManyAndReturn({
          where: { reportsToUserId: id, deletedAt: null },
          data: { reportsToUserId: moveReportsTo },
          select: { id: true, homeSchoolId: true },
        });
        moved = movedRows.length;
      }
      await uow.tx.user.update({
        where: { id },
        data: { status: 'inactive' },
        select: { id: true, homeSchoolId: true },
      });
      uow.audit({
        action: 'user.deactivated',
        entityType: 'user',
        entityId: id,
        after: { movedReportsTo: moveReportsTo ?? null, moved },
      });
    });
    await this.deps.data.auth.revokeAllForUser(id, 'deactivated', now);
    return { user: await this.get(auth, id), movedReports: moved };
  }

  async reactivate(auth: AuthInfo, id: string) {
    const access = await auth.access();
    const self = await auth.permissions();
    requireWritable(access);
    const row = await this.visibleRow(auth, id, 'edit');
    if (row.status !== 'inactive') throw conflict('This person is already active.');
    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      await assertCanManagePerson(uow.tx, self, id);
      await uow.tx.user.update({
        where: { id },
        data: { status: row.lastLoginAt ? 'active' : 'invited' },
        select: { id: true, homeSchoolId: true },
      });
      uow.audit({ action: 'user.reactivated', entityType: 'user', entityId: id });
    });
    return this.get(auth, id);
  }

  async remove(auth: AuthInfo, id: string) {
    const access = await auth.access();
    const self = await auth.permissions();
    requireWritable(access);
    if (id === auth.userId) throw businessRule('You can’t delete yourself.');
    const row = await this.visibleRow(auth, id, 'delete');
    if (row._count.directReports > 0) {
      const n = row._count.directReports;
      throw businessRule(
        `${n} ${n === 1 ? 'person reports' : 'people report'} to ${row.fullName}. Move them to another manager first.`,
      );
    }
    const now = this.deps.now();
    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      await assertCanManagePerson(uow.tx, self, id);
      await assertKeepsAnOwner(uow.tx, id);
      await setAssignment(uow.tx, auth.organisationId, id, null);
      await uow.tx.user.update({
        where: { id },
        data: { deletedAt: now, status: 'inactive' },
        select: { id: true, homeSchoolId: true },
      });
      uow.audit({
        action: 'user.deleted',
        entityType: 'user',
        entityId: id,
        before: editableValues(row),
      });
    });
    await this.deps.data.auth.revokeAllForUser(id, 'deleted', now);
  }

  async invite(auth: AuthInfo, id: string) {
    const access = await auth.access();
    requireWritable(access);
    const row = await this.visibleRow(auth, id, 'edit');
    if (row.status === 'inactive')
      throw businessRule('Reactivate this person before inviting them.');
    await this.sendInvite(auth, id, row.mobile);
    await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      await uow.tx.user.update({
        where: { id },
        data: { invitedAt: this.deps.now() },
        select: { id: true, homeSchoolId: true },
      });
    });
    return this.get(auth, id);
  }
}
