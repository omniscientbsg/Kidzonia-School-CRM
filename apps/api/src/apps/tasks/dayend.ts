import type { Request } from 'express';
import { z } from 'zod';
import {
  blocksLogoutNow,
  dayEndFormInputSchema,
  dayEndFormUpdateSchema,
  idSchema,
  isoDateSchema,
  localDate,
  questionSchema,
} from '@kidzonia/shared';
import type { Access, DayEndForm, DayEndToday } from '@kidzonia/shared';
import { mapDbError, withUnitOfWork } from '../../db/index.js';
import type { Prisma, ScopedTx } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import type { AuthInfo } from '../../http/types.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { conflict, notFound } from '../../lib/errors.js';
import { requireModule, requireWritable } from '../../core/guards.js';
import { authOf } from '../../core/users/routes.js';
import { fromIsoDate, toIsoDate } from './calendars.js';
import { copyScopeWhere } from './facts.js';
import { canRelease } from './logout.js';
import { personRefOf } from './records.js';
import { UNTOUCHED } from './schedule.js';

/**
 * Day-end reports (brief 9.11). Each form has one generated daily task
 * (kind day_end) for everyone holding its roles; the schedule makes each
 * day's copy with the form's current questions. Editing a form writes a new
 * version; only untouched copies move to it.
 */

const DAYEND = 'dayend';
const questionList = z.array(questionSchema);
const idParam = (req: Request) => parse(z.object({ id: idSchema }), req.params).id;
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

const FORM_SELECT = {
  id: true,
  name: true,
  blocksLogout: true,
  currentVersion: true,
  updatedAt: true,
  roles: { select: { roleId: true } },
  versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true, questions: true } },
} as const satisfies Prisma.DayEndFormSelect;

function present(f: Prisma.DayEndFormGetPayload<{ select: typeof FORM_SELECT }>): DayEndForm {
  const v = f.versions[0];
  return {
    id: f.id,
    name: f.name,
    blocksLogout: f.blocksLogout,
    roleIds: f.roles.map((r) => r.roleId),
    version: v?.version ?? f.currentVersion,
    questions: questionList.parse(v?.questions ?? []),
    updatedAt: f.updatedAt.toISOString(),
  };
}

async function assertRoles(tx: ScopedTx, roleIds: readonly string[]) {
  const n = await tx.role.count({ where: { id: { in: [...roleIds] }, deletedAt: null } });
  if (n !== new Set(roleIds).size) throw notFound('One of those roles');
}

const clash = (err: unknown): never => {
  if (mapDbError(err)?.code === 'conflict') throw conflict('A form with that name already exists.');
  throw err;
};

/** The day-end rows someone may see, by the dayend module's reach. */
function reachWhere(access: Access): Prisma.TaskAssignmentWhereInput[] {
  return access
    .scopes(DAYEND)
    .map(copyScopeWhere)
    .filter((w) => Object.keys(w).length > 0);
}

export function dayEndRoutes(deps: AppDeps): RouteDef[] {
  const route = (
    method: RouteDef['method'],
    path: string,
    handler: RouteDef['handler'],
  ): RouteDef => ({
    method,
    path,
    access: 'authenticated',
    guardWrites: false,
    handler,
  });
  const access = async (auth: AuthInfo, action: string) => {
    const a = await auth.access();
    if (action !== 'view') requireWritable(a);
    requireModule(a, DAYEND, action);
    return a;
  };

  return [
    route('get', '/day-end-forms', async (req, res) => {
      const auth = authOf(req);
      await access(auth, 'view');
      const rows = await auth.db.dayEndForm.findMany({
        where: { archivedAt: null },
        select: FORM_SELECT,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      res.json({ items: rows.map(present), nextCursor: null });
    }),

    route('post', '/day-end-forms', async (req, res) => {
      const auth = authOf(req);
      await access(auth, 'create');
      const input = parse(dayEndFormInputSchema, req.body);
      await assertRoles(auth.db, input.roleIds);
      const org = await auth.db.organisation.findFirstOrThrow({ select: { timezone: true } });
      const today = localDate(deps.now(), org.timezone);
      const id = await withUnitOfWork(auth.db, auth.actor, async (uow) => {
        const form = await uow.tx.dayEndForm
          .create({
            data: {
              organisationId: auth.organisationId,
              name: input.name,
              blocksLogout: input.blocksLogout,
              createdBy: auth.userId,
            },
            select: { id: true },
          })
          .catch(clash);
        await uow.tx.dayEndFormVersion.create({
          data: {
            organisationId: auth.organisationId,
            formId: form.id,
            version: 1,
            questions: json(input.questions),
            createdBy: auth.userId,
          },
          select: { id: true },
        });
        await uow.tx.dayEndFormRole.createMany({
          data: input.roleIds.map((roleId) => ({
            organisationId: auth.organisationId,
            formId: form.id,
            roleId,
          })),
        });
        // The form's daily task: the schedule makes each day's copy from it.
        await uow.tx.task.create({
          data: {
            organisationId: auth.organisationId,
            kind: 'day_end',
            title: input.name,
            description: 'Fill this in before you log out today.',
            dueType: 'end_of_day',
            repeat: 'daily',
            repeatStartDate: fromIsoDate(today),
            blocksLogout: input.blocksLogout,
            target: {
              userIds: [],
              roleIds: input.roleIds,
              schoolIds: [],
              excludeUserIds: [],
              includeNewJoiners: true,
            },
            dayEndFormId: form.id,
            createdBy: auth.userId,
          },
          select: { id: true, createdBy: true },
        });
        uow.audit({
          action: 'day_end_form.created',
          entityType: 'day_end_form',
          entityId: form.id,
          after: input,
        });
        return form.id;
      });
      deps.schedule.request(auth.organisationId);
      const row = await auth.db.dayEndForm.findFirstOrThrow({ where: { id }, select: FORM_SELECT });
      res.status(201).json(present(row));
    }),

    route('put', '/day-end-forms/:id', async (req, res) => {
      const auth = authOf(req);
      await access(auth, 'edit');
      const id = idParam(req);
      const current = await auth.db.dayEndForm.findFirst({
        where: { id, archivedAt: null },
        select: FORM_SELECT,
      });
      if (!current) throw notFound('That form');
      const before = present(current);
      const patch = parse(dayEndFormUpdateSchema, req.body);
      // Validate the merged form, never the fragment (brief 11).
      const merged = parse(dayEndFormInputSchema, {
        name: patch.name ?? before.name,
        roleIds: patch.roleIds ?? before.roleIds,
        blocksLogout: patch.blocksLogout ?? before.blocksLogout,
        questions: patch.questions ?? before.questions,
      });
      if (patch.roleIds) await assertRoles(auth.db, merged.roleIds);
      const newVersion = JSON.stringify(merged.questions) !== JSON.stringify(before.questions);
      await withUnitOfWork(auth.db, auth.actor, async (uow) => {
        await uow.tx.dayEndForm
          .update({
            where: { id },
            data: {
              name: merged.name,
              blocksLogout: merged.blocksLogout,
              ...(newVersion ? { currentVersion: before.version + 1 } : {}),
              updatedBy: auth.userId,
            },
            select: { id: true },
          })
          .catch(clash);
        if (newVersion) {
          // Old versions are never changed: filed reports keep their questions.
          await uow.tx.dayEndFormVersion.create({
            data: {
              organisationId: auth.organisationId,
              formId: id,
              version: before.version + 1,
              questions: json(merged.questions),
              createdBy: auth.userId,
            },
            select: { id: true },
          });
        }
        if (patch.roleIds) {
          await uow.tx.dayEndFormRole.deleteMany({ where: { formId: id } });
          await uow.tx.dayEndFormRole.createMany({
            data: merged.roleIds.map((roleId) => ({
              organisationId: auth.organisationId,
              formId: id,
              roleId,
            })),
          });
        }
        const task = await uow.tx.task.findFirst({
          where: { dayEndFormId: id, cancelledAt: null },
          select: { id: true },
        });
        if (task) {
          await uow.tx.task.update({
            where: { id: task.id },
            data: {
              title: merged.name,
              blocksLogout: merged.blocksLogout,
              target: {
                userIds: [],
                roleIds: merged.roleIds,
                schoolIds: [],
                excludeUserIds: [],
                includeNewJoiners: true,
              },
              updatedBy: auth.userId,
            },
            select: { id: true, createdBy: true },
          });
        }
        uow.audit({
          action: 'day_end_form.updated',
          entityType: 'day_end_form',
          entityId: id,
          before,
          after: merged,
        });
      });
      // Untouched copies move to the new version on the schedule's next look.
      deps.schedule.request(auth.organisationId);
      const row = await auth.db.dayEndForm.findFirstOrThrow({ where: { id }, select: FORM_SELECT });
      res.json(present(row));
    }),

    route('delete', '/day-end-forms/:id', async (req, res) => {
      const auth = authOf(req);
      await access(auth, 'delete');
      const id = idParam(req);
      const form = await auth.db.dayEndForm.findFirst({
        where: { id, archivedAt: null },
        select: { id: true },
      });
      if (!form) throw notFound('That form');
      const now = deps.now();
      await withUnitOfWork(auth.db, auth.actor, async (uow) => {
        await uow.tx.dayEndForm.update({
          where: { id },
          data: { archivedAt: now, updatedBy: auth.userId },
          select: { id: true },
        });
        const task = await uow.tx.task.findFirst({
          where: { dayEndFormId: id, cancelledAt: null },
          select: { id: true },
        });
        if (task) {
          await uow.tx.task.update({
            where: { id: task.id },
            data: { cancelledAt: now, updatedBy: auth.userId },
            select: { id: true, createdBy: true },
          });
          // Reports already started or filed stay; untouched ones go.
          await uow.tx.taskAssignment.updateManyAndReturn({
            where: { taskId: task.id, ...UNTOUCHED },
            data: {
              status: 'cancelled',
              cancelReason: 'This day-end form was removed.',
              decidedAt: now,
            },
            select: { id: true, taskId: true, userId: true, schoolId: true },
          });
        }
        uow.audit({ action: 'day_end_form.deleted', entityType: 'day_end_form', entityId: id });
      });
      res.status(204).end();
    }),

    // Day-end reports, Today tab: who has submitted, and release for today.
    route('get', '/day-end/today', async (req, res) => {
      const auth = authOf(req);
      const a = await access(auth, 'view');
      const now = deps.now();
      const org = await auth.db.organisation.findFirstOrThrow({
        select: { timezone: true, logoutBlockLeadMinutes: true },
      });
      const today = localDate(now, org.timezone);
      const date = parse(z.object({ date: isoDateSchema.optional() }), req.query).date ?? today;
      const rows = await auth.db.taskAssignment.findMany({
        where: {
          AND: [
            {
              task: { kind: 'day_end' },
              serviceDate: fromIsoDate(date),
              userId: { not: a.userId },
            },
            ...reachWhere(a),
          ],
        },
        select: {
          id: true,
          taskId: true,
          userId: true,
          status: true,
          submittedAt: true,
          serviceDate: true,
          dueAt: true,
          blocksLogout: true,
          user: {
            select: {
              id: true,
              fullName: true,
              jobTitle: true,
              homeSchoolId: true,
              homeSchool: { select: { name: true } },
            },
          },
          task: { select: { dayEndForm: { select: { name: true } } } },
        },
        orderBy: [{ user: { fullName: 'asc' } }, { id: 'asc' }],
      });
      const releases = await auth.db.logoutRelease.findMany({
        where: { userId: { in: rows.map((r) => r.userId) }, serviceDate: fromIsoDate(date) },
        select: { userId: true },
      });
      const released = new Set(releases.map((r) => r.userId));
      const out: DayEndToday = {
        date,
        rows: rows.map((r) => ({
          copyId: r.id,
          taskId: r.taskId,
          formName: r.task.dayEndForm?.name ?? 'Day-end report',
          person: personRefOf(r.user),
          status: r.status,
          submittedAt: r.submittedAt?.toISOString() ?? null,
          blocking: blocksLogoutNow(
            { ...r, serviceDate: toIsoDate(r.serviceDate) },
            today,
            now,
            org.logoutBlockLeadMinutes,
            released.has(r.userId) ? new Set([date]) : new Set(),
          ),
          canRelease: canRelease(a, r.user),
        })),
      };
      res.json(out);
    }),
  ];
}
