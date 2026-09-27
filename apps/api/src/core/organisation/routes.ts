import express from 'express';
import type { Request } from 'express';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import {
  createHolidaySchema,
  holidayEndAfterStart,
  holidayImpactInputSchema,
  holidayListQuerySchema,
  idSchema,
  toPage,
  updateHolidaySchema,
  updateOrganisationSchema,
} from '@kidzonia/shared';
import type { Checklist, Holiday, Organisation } from '@kidzonia/shared';
import { withUnitOfWork } from '../../db/index.js';
import type { ScopedTx } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import type { AuthInfo } from '../../http/types.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { invalidInput, notFound } from '../../lib/errors.js';
import { requireModule, requireWritable } from '../guards.js';
import { IMAGE_TYPES, cleanImage } from '../images.js';
import { authOf } from '../users/routes.js';
import { defined } from '../../lib/objects.js';

const ORG = 'organisation';
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const idParam = (req: Request) => parse(z.object({ id: idSchema }), req.params).id;
const day = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);

export const logoUrl = (logoKey: string | null) =>
  logoKey ? `/api/organisation/logo?v=${encodeURIComponent(logoKey.split('/').pop() ?? '')}` : null;

async function readOrganisation(db: ScopedTx): Promise<Organisation> {
  const o = await db.organisation.findFirst({
    select: {
      id: true,
      name: true,
      logoKey: true,
      setupType: true,
      schoolModel: true,
      timezone: true,
      workingDays: true,
      opensAt: true,
      closesAt: true,
      logoutBlockLeadMinutes: true,
    },
  });
  if (!o) throw notFound('Your organisation');
  const { logoKey, ...rest } = o;
  return { ...rest, logoUrl: logoUrl(logoKey) };
}

async function checklist(auth: AuthInfo): Promise<Checklist> {
  const db = auth.db;
  const [org, schools, customRoles, roleEdits, people, noRole, tasks] = await Promise.all([
    db.organisation.findFirst({ select: { checklistDismissedAt: true } }),
    db.school.count({ where: { deletedAt: null } }),
    db.role.count({ where: { deletedAt: null, seedKey: null } }),
    db.activity.count({ where: { entityType: 'role', action: 'updated' } }),
    db.user.count({ where: { deletedAt: null } }),
    db.user.count({
      where: { deletedAt: null, status: { not: 'inactive' }, roleAssignment: null },
    }),
    db.task.count({ where: { kind: 'task' } }),
  ]);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return {
    dismissed: org?.checklistDismissedAt != null,
    items: [
      {
        key: 'schools',
        label: 'Add your schools',
        detail: `${plural(schools, 'school', 'schools')} added`,
        done: schools > 0,
        path: '/settings/schools',
      },
      {
        key: 'roles',
        label: 'Create your roles',
        detail:
          customRoles + roleEdits > 0 ? 'Roles are set up' : 'Starter roles are ready to adjust',
        done: customRoles + roleEdits > 0,
        path: '/settings/roles',
      },
      {
        key: 'users',
        label: 'Add users',
        detail: `${plural(people, 'person', 'people')} added`,
        done: people > 1,
        path: '/settings/users',
      },
      {
        key: 'give_roles',
        label: 'Give users a role',
        detail: noRole > 0 ? `${noRole} still waiting` : 'Everyone has a role',
        done: people > 1 && noRole === 0,
        path: '/settings/users',
      },
      {
        key: 'first_task',
        label: 'Create your first task',
        detail:
          tasks > 0 ? `${plural(tasks, 'task', 'tasks')} created` : 'Give someone their first task',
        done: tasks > 0,
        path: '/tasks',
      },
    ],
  };
}

async function holidayOut(db: ScopedTx, id: string): Promise<Holiday> {
  const h = await db.holiday.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      schools: { select: { schoolId: true } },
    },
  });
  if (!h) throw notFound('That holiday');
  return {
    id: h.id,
    name: h.name,
    startDate: day(h.startDate),
    endDate: day(h.endDate),
    schoolIds: h.schools.map((s) => s.schoolId),
  };
}

async function writeHolidaySchools(
  tx: ScopedTx,
  organisationId: string,
  holidayId: string,
  schoolIds: string[],
) {
  await tx.holidaySchool.deleteMany({ where: { holidayId } });
  const unique = [...new Set(schoolIds)];
  if (unique.length === 0) return;
  const found = await tx.school.count({ where: { id: { in: unique }, deletedAt: null } });
  if (found !== unique.length) throw notFound('One of those schools');
  await tx.holidaySchool.createMany({
    data: unique.map((schoolId) => ({ organisationId, holidayId, schoolId })),
  });
}

export function organisationRoutes(deps: AppDeps): RouteDef[] {
  return [
    {
      method: 'get',
      path: '/organisation',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        requireModule(await auth.access(), ORG, 'view');
        res.json(await readOrganisation(auth.db));
      },
    },
    {
      method: 'put',
      path: '/organisation',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        const access = await auth.access();
        requireWritable(access);
        requireModule(access, ORG, 'edit');
        const patch = defined(parse(updateOrganisationSchema, req.body));
        const before = await readOrganisation(auth.db);
        // Validate the merged record, never just the fragment sent (brief 11).
        const merged = { ...before, ...patch };
        if (merged.opensAt >= merged.closesAt) {
          throw invalidInput('Closing time must be after opening time.', {
            closesAt: 'Closing time must be after opening time',
          });
        }
        await withUnitOfWork(auth.db, auth.actor, async (uow) => {
          await uow.tx.organisation.update({
            where: { id: auth.organisationId },
            data: { ...patch, updatedBy: auth.userId },
            select: { id: true },
          });
          uow.audit({
            action: 'organisation.updated',
            entityType: 'organisation',
            entityId: auth.organisationId,
            before: Object.fromEntries(
              Object.keys(patch).map((k) => [k, before[k as keyof Organisation]]),
            ),
            after: patch,
          });
        });
        // Working days and hours move untouched task copies (Phase 4).
        deps.schedule.request(auth.organisationId);
        res.json(await readOrganisation(auth.db));
      },
    },
    {
      method: 'get',
      path: '/organisation/checklist',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        requireModule(await auth.access(), ORG, 'edit');
        res.json(await checklist(auth));
      },
    },
    {
      method: 'post',
      path: '/organisation/checklist/dismiss',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        requireModule(await auth.access(), ORG, 'edit');
        await withUnitOfWork(auth.db, auth.actor, async (uow) => {
          await uow.tx.organisation.update({
            where: { id: auth.organisationId },
            data: { checklistDismissedAt: deps.now() },
            select: { id: true },
          });
        });
        res.status(204).end();
      },
    },
    {
      // Any signed-in person may see their organisation's logo (it's in the top bar).
      method: 'get',
      path: '/organisation/logo',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        const org = await auth.db.organisation.findFirst({ select: { logoKey: true } });
        const file = org?.logoKey ? await deps.storage.get(org.logoKey) : null;
        if (!file) throw notFound('The logo');
        // Only ever an image type we produced ourselves; nosniff comes from helmet.
        res.setHeader('Content-Type', file.contentType);
        res.setHeader('Content-Disposition', 'inline; filename="logo"');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.send(file.data);
      },
    },
    {
      method: 'post',
      path: '/organisation/logo',
      access: 'authenticated',
      before: [express.raw({ type: () => true, limit: LOGO_MAX_BYTES })],
      handler: async (req, res) => {
        const auth = authOf(req);
        const access = await auth.access();
        requireWritable(access);
        requireModule(access, ORG, 'edit');
        const body: unknown = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) {
          throw invalidInput('Choose an image to upload.', { file: 'Choose an image to upload.' });
        }
        const image = await cleanImage(body, 512);
        const key = `org/${auth.organisationId}/logo-${uuidv7()}.${image.kind === 'jpeg' ? 'jpg' : image.kind}`;
        await deps.storage.put(key, image.data, IMAGE_TYPES[image.kind]);
        const old = await auth.db.organisation.findFirst({ select: { logoKey: true } });
        await withUnitOfWork(auth.db, auth.actor, async (uow) => {
          await uow.tx.organisation.update({
            where: { id: auth.organisationId },
            data: { logoKey: key, updatedBy: auth.userId },
            select: { id: true },
          });
          uow.audit({
            action: 'organisation.logo_changed',
            entityType: 'organisation',
            entityId: auth.organisationId,
          });
        });
        if (old?.logoKey) await deps.storage.delete(old.logoKey);
        res.json(await readOrganisation(auth.db));
      },
    },
    {
      method: 'delete',
      path: '/organisation/logo',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        const access = await auth.access();
        requireWritable(access);
        requireModule(access, ORG, 'edit');
        const old = await auth.db.organisation.findFirst({ select: { logoKey: true } });
        await withUnitOfWork(auth.db, auth.actor, async (uow) => {
          await uow.tx.organisation.update({
            where: { id: auth.organisationId },
            data: { logoKey: null, updatedBy: auth.userId },
            select: { id: true },
          });
          uow.audit({
            action: 'organisation.logo_removed',
            entityType: 'organisation',
            entityId: auth.organisationId,
          });
        });
        if (old?.logoKey) await deps.storage.delete(old.logoKey);
        res.status(204).end();
      },
    },

    {
      // Phase 4: Owners see when the task schedule last ran.
      method: 'get',
      path: '/organisation/schedule',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        const access = await auth.access();
        requireModule(access, ORG, 'view');
        if (!access.primary.role?.isOwner) throw notFound('That page');
        res.json(await deps.data.jobs.status('task-schedule'));
      },
    },

    // ---------- holidays ----------
    {
      method: 'get',
      path: '/holidays',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        requireModule(await auth.access(), ORG, 'view');
        const q = parse(holidayListQuerySchema, req.query);
        const rows = await auth.db.holiday.findMany({
          where: {
            deletedAt: null,
            ...(q.year
              ? { startDate: { gte: toDate(`${q.year}-01-01`), lte: toDate(`${q.year}-12-31`) } }
              : {}),
          },
          select: { id: true },
          orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
          take: q.limit + 1,
          ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        });
        const page = toPage(rows, q.limit);
        res.json({
          items: await Promise.all(page.items.map((r) => holidayOut(auth.db, r.id))),
          nextCursor: page.nextCursor,
        });
      },
    },
    {
      // Phase 4 answer 1: one-time tasks keep their date, so warn before adding the holiday.
      method: 'post',
      path: '/holidays/impact',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        requireModule(await auth.access(), ORG, 'edit');
        const input = parse(holidayImpactInputSchema, req.body);
        const range = {
          start: input.startDate,
          end: input.endDate ?? input.startDate,
          schoolIds: input.schoolIds,
        };
        const out = { oneTimeTasks: 0, copies: 0, titles: [] as string[] };
        for (const hook of deps.hooks.holidayImpact) {
          const r = await hook(auth.db, range);
          out.oneTimeTasks += r.oneTimeTasks;
          out.copies += r.copies;
          out.titles.push(...r.titles);
        }
        res.json(out);
      },
    },
    {
      method: 'post',
      path: '/holidays',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        const access = await auth.access();
        requireWritable(access);
        requireModule(access, ORG, 'edit');
        const input = parse(createHolidaySchema, req.body);
        const id = await withUnitOfWork(auth.db, auth.actor, async (uow) => {
          const h = await uow.tx.holiday.create({
            data: {
              organisationId: auth.organisationId,
              name: input.name,
              startDate: toDate(input.startDate),
              endDate: toDate(input.endDate ?? input.startDate),
              createdBy: auth.userId,
            },
            select: { id: true },
          });
          await writeHolidaySchools(uow.tx, auth.organisationId, h.id, input.schoolIds);
          uow.audit({
            action: 'holiday.created',
            entityType: 'holiday',
            entityId: h.id,
            after: input,
          });
          return h.id;
        });
        deps.schedule.request(auth.organisationId);
        res.status(201).json(await holidayOut(auth.db, id));
      },
    },
    {
      method: 'put',
      path: '/holidays/:id',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        const access = await auth.access();
        requireWritable(access);
        requireModule(access, ORG, 'edit');
        const id = idParam(req);
        const patch = parse(updateHolidaySchema, req.body);
        const before = await holidayOut(auth.db, id);
        const merged = {
          startDate: patch.startDate ?? before.startDate,
          endDate:
            patch.endDate === undefined
              ? before.endDate
              : (patch.endDate ?? patch.startDate ?? before.startDate),
        };
        if (!holidayEndAfterStart(merged)) {
          throw invalidInput('The last day can’t be before the first day.', {
            endDate: 'The last day can’t be before the first day',
          });
        }
        await withUnitOfWork(auth.db, auth.actor, async (uow) => {
          await uow.tx.holiday.update({
            where: { id },
            data: {
              ...(patch.name ? { name: patch.name } : {}),
              startDate: toDate(merged.startDate),
              endDate: toDate(merged.endDate),
              updatedBy: auth.userId,
            },
            select: { id: true },
          });
          if (patch.schoolIds)
            await writeHolidaySchools(uow.tx, auth.organisationId, id, patch.schoolIds);
          uow.audit({
            action: 'holiday.updated',
            entityType: 'holiday',
            entityId: id,
            before,
            after: patch,
          });
        });
        deps.schedule.request(auth.organisationId);
        res.json(await holidayOut(auth.db, id));
      },
    },
    {
      method: 'delete',
      path: '/holidays/:id',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        const access = await auth.access();
        requireWritable(access);
        requireModule(access, ORG, 'edit');
        const id = idParam(req);
        const before = await holidayOut(auth.db, id);
        await withUnitOfWork(auth.db, auth.actor, async (uow) => {
          await uow.tx.holiday.update({
            where: { id },
            data: { deletedAt: deps.now(), updatedBy: auth.userId },
            select: { id: true },
          });
          uow.audit({ action: 'holiday.deleted', entityType: 'holiday', entityId: id, before });
        });
        deps.schedule.request(auth.organisationId);
        res.status(204).end();
      },
    },
  ];
}
