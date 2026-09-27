import type { Request } from 'express';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import {
  createSchoolSchema,
  idSchema,
  pageQuerySchema,
  toPage,
  updateSchoolSchema,
} from '@kidzonia/shared';
import type { Access, RecordFacts } from '@kidzonia/shared';
import { mapDbError, withUnitOfWork } from '../../db/index.js';
import type { Prisma, ScopedTx } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import type { AuthInfo } from '../../http/types.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { defined } from '../../lib/objects.js';
import { AppError, businessRule, conflict, notFound } from '../../lib/errors.js';
import { checkWritableFields, requireModule, requireWritable } from '../guards.js';
import { assertCanGiveRole, setAssignment } from '../roles/rules.js';
import { userFacts } from '../users/facts.js';
import { authOf } from '../users/routes.js';

const SCHOOLS = 'schools';
const idParam = (req: Request) => parse(z.object({ id: idSchema }), req.params).id;

const SELECT = {
  id: true,
  name: true,
  city: true,
  state: true,
  type: true,
  franchiseOwnerUserId: true,
  franchiseOwner: { select: { fullName: true } },
  principalUserId: true,
  principal: { select: { fullName: true } },
  workingDays: true,
  opensAt: true,
  closesAt: true,
  _count: { select: { homeOf: { where: { deletedAt: null } } } },
} as const satisfies Prisma.SchoolSelect;

type Row = Prisma.SchoolGetPayload<{ select: typeof SELECT }>;

/**
 * Schools someone can see: every school with an all-schools scope, otherwise
 * the schools in their scope. In a preview, both people must see it.
 */
function schoolWhere(access: Access): Prisma.SchoolWhereInput[] {
  return access.contexts.map((c) =>
    c.role?.isOwner || c.scope.allSchools ? {} : { id: { in: [...c.scope.schoolIds] } },
  );
}

const facts = (r: { id: string; franchiseOwnerUserId: string | null }): RecordFacts => ({
  subjectUserIds: r.franchiseOwnerUserId ? [r.franchiseOwnerUserId] : [],
  schoolIds: [r.id],
});

function present(access: Access, r: Row) {
  return access.serialize(
    SCHOOLS,
    {
      id: r.id,
      name: r.name,
      city: r.city,
      state: r.state,
      type: r.type,
      franchiseOwnerUserId: r.franchiseOwnerUserId,
      franchiseOwnerName: r.franchiseOwner?.fullName ?? null,
      principalUserId: r.principalUserId,
      principalName: r.principal?.fullName ?? null,
      workingDays: r.workingDays,
      opensAt: r.opensAt,
      closesAt: r.closesAt,
      peopleCount: r._count.homeOf,
    },
    facts(r),
  );
}

async function visibleSchool(auth: AuthInfo, id: string): Promise<Row> {
  const access = await auth.access();
  requireModule(access, SCHOOLS, 'view');
  const row = await auth.db.school.findFirst({
    where: { AND: [{ id, deletedAt: null }, ...schoolWhere(access)] },
    select: SELECT,
  });
  if (!row) throw notFound('That school');
  return row;
}

/** A franchise owner or principal must be someone the editor can see in Users. */
async function assertPersonVisible(tx: ScopedTx, access: Access, userId: string, field: string) {
  const u = await tx.user.findFirst({
    where: { id: userId, deletedAt: null, status: { not: 'inactive' } },
    select: { id: true, homeSchoolId: true },
  });
  if (!u || !access.can('users', 'view', userFacts(u))) {
    throw businessRule('Choose someone you can see in Users.', {
      [field]: 'Choose someone you can see in Users.',
    });
  }
}

function assertTypeRules(merged: {
  type: 'coco' | 'franchise';
  franchiseOwnerUserId: string | null;
}) {
  if (merged.type === 'coco' && merged.franchiseOwnerUserId) {
    throw businessRule('Only franchise schools have a franchise owner.', {
      franchiseOwnerUserId: 'Only franchise schools have a franchise owner.',
    });
  }
}

function nameClash(err: unknown): unknown {
  // School names are the only unique field these writes touch.
  return mapDbError(err)?.code === 'conflict'
    ? new AppError('conflict', 'A school with that name already exists.', { name: 'Already used' })
    : err;
}

export function schoolRoutes(deps: AppDeps): RouteDef[] {
  return [
    {
      method: 'get',
      path: '/schools',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        const access = await auth.access();
        requireModule(access, SCHOOLS, 'view');
        const q = parse(pageQuerySchema, req.query);
        const rows = await auth.db.school.findMany({
          where: { AND: [{ deletedAt: null }, ...schoolWhere(access)] },
          select: SELECT,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: q.limit + 1,
          ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        });
        const page = toPage(rows, q.limit);
        res.json({ items: page.items.map((r) => present(access, r)), nextCursor: page.nextCursor });
      },
    },
    {
      method: 'get',
      path: '/schools/:id',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        res.json(present(await auth.access(), await visibleSchool(auth, idParam(req))));
      },
    },
    {
      method: 'post',
      path: '/schools',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        const access = await auth.access();
        const self = await auth.permissions();
        requireWritable(access);
        requireModule(access, SCHOOLS, 'create');
        const input = parse(createSchoolSchema, req.body);
        const { inviteOwner, ...school } = input;
        const fields = defined(school);
        checkWritableFields(access, SCHOOLS, Object.keys(fields), {
          subjectUserIds: [],
          schoolIds: [],
        });
        assertTypeRules({
          type: school.type,
          franchiseOwnerUserId: school.franchiseOwnerUserId ?? null,
        });
        if (inviteOwner) {
          if (school.type !== 'franchise')
            throw businessRule('Only franchise schools have an owner.');
          if (school.franchiseOwnerUserId)
            throw businessRule('Choose an existing owner or invite a new one, not both.');
          requireModule(access, 'users', 'create');
        }
        const id = uuidv7();
        // Filled in inside the transaction; a holder object keeps TypeScript's narrowing honest.
        const invited: { ownerId: string | null } = { ownerId: null };
        await withUnitOfWork(auth.db, auth.actor, async (uow) => {
          if (school.franchiseOwnerUserId)
            await assertPersonVisible(
              uow.tx,
              access,
              school.franchiseOwnerUserId,
              'franchiseOwnerUserId',
            );
          if (school.principalUserId)
            await assertPersonVisible(uow.tx, access, school.principalUserId, 'principalUserId');
          await uow.tx.school.create({
            data: {
              id,
              organisationId: auth.organisationId,
              name: school.name,
              city: school.city,
              state: school.state ?? null,
              type: school.type,
              franchiseOwnerUserId: school.franchiseOwnerUserId ?? null,
              principalUserId: school.principalUserId ?? null,
              workingDays: school.workingDays ?? [],
              opensAt: school.opensAt ?? null,
              closesAt: school.closesAt ?? null,
              createdBy: auth.userId,
            },
            select: { id: true, franchiseOwnerUserId: true },
          });
          if (inviteOwner) {
            const clash = await uow.tx.user.findFirst({
              where: { mobile: inviteOwner.mobile, deletedAt: null },
              select: { id: true },
            });
            if (clash) {
              throw new AppError(
                'conflict',
                'Someone in your organisation already uses that mobile number.',
                {
                  'inviteOwner.mobile': 'Already used by someone in your organisation.',
                },
              );
            }
            const scope = { allSchools: false, schoolIds: [id] };
            // The new school isn't in anyone's scope yet, so only people who
            // look after all schools can give access to it.
            await assertCanGiveRole(uow.tx, self, inviteOwner.roleId, scope);
            const ownerId = uuidv7();
            invited.ownerId = ownerId;
            await uow.tx.user.create({
              data: {
                id: ownerId,
                organisationId: auth.organisationId,
                fullName: inviteOwner.fullName,
                mobile: inviteOwner.mobile,
                jobTitle: 'Franchise owner',
                homeSchoolId: id,
                status: 'invited',
                invitedAt: deps.now(),
              },
              select: { id: true, homeSchoolId: true },
            });
            await setAssignment(uow.tx, auth.organisationId, ownerId, {
              roleId: inviteOwner.roleId,
              scope,
            });
            await uow.tx.school.update({
              where: { id },
              data: { franchiseOwnerUserId: ownerId },
              select: { id: true, franchiseOwnerUserId: true },
            });
          }
          uow.audit({ action: 'school.created', entityType: 'school', entityId: id, after: input });
        }).catch((err: unknown) => {
          throw nameClash(err);
        });
        if (invited.ownerId && inviteOwner) {
          const org = await auth.db.organisation.findFirst({ select: { name: true } });
          await deps.rateLimits.consumeInvite(invited.ownerId);
          await deps.messages.sendInvite(inviteOwner.mobile, {
            organisationName: org?.name ?? 'Kidzonia 360',
            inviterName: null,
            appUrl: deps.config.APP_URL,
          });
        }
        res.status(201).json(present(access, await visibleSchool(auth, id)));
      },
    },
    {
      method: 'put',
      path: '/schools/:id',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        const access = await auth.access();
        requireWritable(access);
        requireModule(access, SCHOOLS, 'edit');
        const id = idParam(req);
        const row = await visibleSchool(auth, id);
        const patch = defined(parse(updateSchoolSchema, req.body));
        checkWritableFields(access, SCHOOLS, Object.keys(patch), facts(row));
        const merged = {
          type: patch.type ?? row.type,
          franchiseOwnerUserId:
            patch.franchiseOwnerUserId === undefined
              ? row.franchiseOwnerUserId
              : patch.franchiseOwnerUserId,
        };
        assertTypeRules(merged);
        const opens = patch.opensAt === undefined ? row.opensAt : patch.opensAt;
        const closes = patch.closesAt === undefined ? row.closesAt : patch.closesAt;
        if (opens && closes && opens >= closes) {
          throw businessRule('Closing time must be after opening time.', {
            closesAt: 'Closing time must be after opening time',
          });
        }
        await withUnitOfWork(auth.db, auth.actor, async (uow) => {
          if (patch.franchiseOwnerUserId)
            await assertPersonVisible(
              uow.tx,
              access,
              patch.franchiseOwnerUserId,
              'franchiseOwnerUserId',
            );
          if (patch.principalUserId)
            await assertPersonVisible(uow.tx, access, patch.principalUserId, 'principalUserId');
          await uow.tx.school.update({
            where: { id },
            data: { ...patch, updatedBy: auth.userId },
            select: { id: true, franchiseOwnerUserId: true },
          });
          uow.audit({
            action: 'school.updated',
            entityType: 'school',
            entityId: id,
            before: present(access, row),
            after: patch,
          });
        }).catch((err: unknown) => {
          throw nameClash(err);
        });
        // School hours and working days move untouched task copies (Phase 4).
        deps.schedule.request(auth.organisationId);
        res.json(present(access, await visibleSchool(auth, id)));
      },
    },
    {
      method: 'delete',
      path: '/schools/:id',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        const access = await auth.access();
        requireWritable(access);
        requireModule(access, SCHOOLS, 'delete');
        const id = idParam(req);
        const row = await visibleSchool(auth, id);
        if (row._count.homeOf > 0) {
          throw conflict(
            `${row._count.homeOf} people work at ${row.name}. Move them to another school first.`,
          );
        }
        const scoped = await auth.db.roleAssignmentSchool.count({ where: { schoolId: id } });
        if (scoped > 0) {
          throw conflict(
            `${scoped} people’s access includes ${row.name}. Change their access first.`,
          );
        }
        await withUnitOfWork(auth.db, auth.actor, async (uow) => {
          await uow.tx.holidaySchool.deleteMany({ where: { schoolId: id } });
          await uow.tx.school.update({
            where: { id },
            data: { deletedAt: deps.now(), updatedBy: auth.userId },
            select: { id: true, franchiseOwnerUserId: true },
          });
          uow.audit({
            action: 'school.deleted',
            entityType: 'school',
            entityId: id,
            before: { name: row.name },
          });
        });
        res.status(204).end();
      },
    },
  ];
}
