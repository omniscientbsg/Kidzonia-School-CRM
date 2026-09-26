import type { Request } from 'express';
import { z } from 'zod';
import {
  categoryInputSchema,
  idSchema,
  listInputSchema,
  listValueInputSchema,
  messageTemplateInputSchema,
  pageQuerySchema,
  priorityInputSchema,
  priorityOrderSchema,
  templateInputSchema,
  templatePayloadSchema,
  templateUpdateSchema,
  toPage,
} from '@kidzonia/shared';
import type { Access, TaskSetup, TemplatePayload } from '@kidzonia/shared';
import { mapDbError, withUnitOfWork } from '../../db/index.js';
import type { Prisma, ScopedTx } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import type { AuthInfo } from '../../http/types.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { AppError, conflict, notAllowed, notFound } from '../../lib/errors.js';
import { requireModule, requireWritable } from '../../core/guards.js';
import { authOf } from '../../core/users/routes.js';

/**
 * Task setup (brief 9.9, 9.10, 9.12): the masters the task form picks from.
 * Anyone who can see Tasks can read them (the form needs them); changing them
 * needs `task_setup`. Things in use are archived, never deleted, so old tasks
 * still show their category, priority or list value.
 */

const SETUP = 'task_setup';
const idParam = (req: Request, key = 'id') =>
  parse(z.object({ [key]: idSchema }), req.params)[key] ?? '';

async function setupAccess(auth: AuthInfo, action: 'view' | 'create' | 'edit' | 'delete') {
  const access = await auth.access();
  if (action !== 'view') requireWritable(access);
  requireModule(access, SETUP, action);
  return access;
}

/** Reading the masters: the task form needs them, so Tasks viewers may too. */
async function readerAccess(auth: AuthInfo): Promise<Access> {
  const access = await auth.access();
  if (!access.can('tasks', 'view') && !access.can(SETUP, 'view')) throw notAllowed();
  return access;
}

/** Live-name clashes become a clear 409 instead of the generic message. */
function clash(what: string) {
  return (err: unknown): never => {
    const mapped = mapDbError(err);
    if (mapped?.code === 'conflict') throw conflict(`${what} with that name already exists.`);
    throw err;
  };
}

export async function readSetup(tx: ScopedTx): Promise<TaskSetup> {
  const live = { archivedAt: null };
  const [categories, priorities, lists, messageTemplates] = await Promise.all([
    tx.taskCategory.findMany({
      where: live,
      select: { id: true, name: true, color: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
    tx.taskPriority.findMany({
      where: live,
      select: { id: true, name: true, color: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    }),
    tx.taskList.findMany({
      where: live,
      select: {
        id: true,
        name: true,
        values: {
          where: live,
          select: { id: true, value: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    tx.parentMessageTemplate.findMany({
      where: live,
      select: { id: true, name: true, body: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  return { categories, priorities, lists, messageTemplates };
}

const templateSelect = {
  id: true,
  name: true,
  payload: true,
  updatedAt: true,
} as const satisfies Prisma.TaskTemplateSelect;

type TemplateRow = Prisma.TaskTemplateGetPayload<{ select: typeof templateSelect }>;

function presentTemplate(t: TemplateRow) {
  // Stored payloads went through the same schema; parsing again drops anything stale.
  return {
    id: t.id,
    name: t.name,
    payload: templatePayloadSchema.parse(t.payload),
    updatedAt: t.updatedAt.toISOString(),
  };
}

const toJson = (p: TemplatePayload) => JSON.parse(JSON.stringify(p)) as Prisma.InputJsonValue;

export function setupRoutes(_deps: AppDeps): RouteDef[] {
  const route = (
    method: RouteDef['method'],
    path: string,
    handler: RouteDef['handler'],
  ): RouteDef => ({
    method,
    path,
    access: 'authenticated',
    // Tasks areas stay usable during a logout-block walkout (brief 9.7).
    guardWrites: false,
    handler,
  });

  return [
    route('get', '/task-setup', async (req, res) => {
      const auth = authOf(req);
      await readerAccess(auth);
      res.json(await readSetup(auth.db));
    }),

    // ---------- categories ----------
    route('post', '/task-setup/categories', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'create');
      const input = parse(categoryInputSchema, req.body);
      const last = await auth.db.taskCategory.aggregate({ _max: { sortOrder: true } });
      const row = await auth.db.taskCategory
        .create({
          data: {
            organisationId: auth.organisationId,
            ...input,
            sortOrder: (last._max.sortOrder ?? -1) + 1,
            createdBy: auth.userId,
          },
          select: { id: true, name: true, color: true },
        })
        .catch(clash('A category'));
      res.status(201).json(row);
    }),
    route('put', '/task-setup/categories/:id', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'edit');
      const id = idParam(req);
      const current = await auth.db.taskCategory.findFirst({
        where: { id, archivedAt: null },
        select: { name: true, color: true },
      });
      if (!current) throw notFound('That category');
      const merged = parse(categoryInputSchema, { ...current, ...(req.body as object) });
      const row = await auth.db.taskCategory
        .update({
          where: { id },
          data: { ...merged, updatedBy: auth.userId },
          select: { id: true, name: true, color: true },
        })
        .catch(clash('A category'));
      res.json(row);
    }),
    route('delete', '/task-setup/categories/:id', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'delete');
      const done = await auth.db.taskCategory.updateMany({
        where: { id: idParam(req), archivedAt: null },
        data: { archivedAt: new Date(), updatedBy: auth.userId },
      });
      if (done.count === 0) throw notFound('That category');
      res.status(204).end();
    }),

    // ---------- priorities ----------
    route('post', '/task-setup/priorities', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'create');
      const input = parse(priorityInputSchema, req.body);
      const last = await auth.db.taskPriority.aggregate({
        where: { archivedAt: null },
        _max: { sortOrder: true },
      });
      const row = await auth.db.taskPriority
        .create({
          data: {
            organisationId: auth.organisationId,
            ...input,
            // New priorities go last (least urgent); reorder to move them.
            sortOrder: (last._max.sortOrder ?? -1) + 1,
            createdBy: auth.userId,
          },
          select: { id: true, name: true, color: true, sortOrder: true },
        })
        .catch(clash('A priority'));
      res.status(201).json(row);
    }),
    // Fixed path before /:id (brief 11).
    route('put', '/task-setup/priorities/order', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'edit');
      const { ids } = parse(priorityOrderSchema, req.body);
      const live = await auth.db.taskPriority.findMany({
        where: { archivedAt: null },
        select: { id: true },
      });
      const liveIds = new Set(live.map((p) => p.id));
      if (ids.length !== liveIds.size || !ids.every((id) => liveIds.has(id))) {
        throw new AppError('invalid_input', 'Send every priority exactly once, in the new order.');
      }
      await withUnitOfWork(auth.db, auth.actor, async (uow) => {
        for (const [i, id] of ids.entries()) {
          await uow.tx.taskPriority.update({
            where: { id },
            data: { sortOrder: i, updatedBy: auth.userId },
            select: { id: true },
          });
        }
      });
      res.json(await readSetup(auth.db));
    }),
    route('put', '/task-setup/priorities/:id', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'edit');
      const id = idParam(req);
      const current = await auth.db.taskPriority.findFirst({
        where: { id, archivedAt: null },
        select: { name: true, color: true },
      });
      if (!current) throw notFound('That priority');
      const merged = parse(priorityInputSchema, { ...current, ...(req.body as object) });
      const row = await auth.db.taskPriority
        .update({
          where: { id },
          data: { ...merged, updatedBy: auth.userId },
          select: { id: true, name: true, color: true, sortOrder: true },
        })
        .catch(clash('A priority'));
      res.json(row);
    }),
    route('delete', '/task-setup/priorities/:id', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'delete');
      const done = await auth.db.taskPriority.updateMany({
        where: { id: idParam(req), archivedAt: null },
        data: { archivedAt: new Date(), updatedBy: auth.userId },
      });
      if (done.count === 0) throw notFound('That priority');
      res.status(204).end();
    }),

    // ---------- custom lists ----------
    route('post', '/task-setup/lists', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'create');
      const input = parse(listInputSchema, req.body);
      const row = await auth.db.taskList
        .create({
          data: { organisationId: auth.organisationId, ...input, createdBy: auth.userId },
          select: { id: true, name: true },
        })
        .catch(clash('A list'));
      res.status(201).json({ ...row, values: [] });
    }),
    route('put', '/task-setup/lists/:id', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'edit');
      const id = idParam(req);
      const input = parse(listInputSchema, req.body);
      const found = await auth.db.taskList.findFirst({
        where: { id, archivedAt: null },
        select: { id: true },
      });
      if (!found) throw notFound('That list');
      await auth.db.taskList
        .update({ where: { id }, data: { ...input, updatedBy: auth.userId }, select: { id: true } })
        .catch(clash('A list'));
      res.json(await readSetup(auth.db));
    }),
    route('delete', '/task-setup/lists/:id', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'delete');
      const done = await auth.db.taskList.updateMany({
        where: { id: idParam(req), archivedAt: null },
        data: { archivedAt: new Date(), updatedBy: auth.userId },
      });
      if (done.count === 0) throw notFound('That list');
      res.status(204).end();
    }),
    route('post', '/task-setup/lists/:id/values', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'create');
      const listId = idParam(req);
      const input = parse(listValueInputSchema, req.body);
      const list = await auth.db.taskList.findFirst({
        where: { id: listId, archivedAt: null },
        select: { id: true },
      });
      if (!list) throw notFound('That list');
      const last = await auth.db.taskListValue.aggregate({
        where: { listId },
        _max: { sortOrder: true },
      });
      const row = await auth.db.taskListValue
        .create({
          data: {
            organisationId: auth.organisationId,
            listId,
            value: input.value,
            sortOrder: (last._max.sortOrder ?? -1) + 1,
            createdBy: auth.userId,
          },
          select: { id: true, value: true },
        })
        .catch(clash('A value'));
      res.status(201).json(row);
    }),
    route('delete', '/task-setup/lists/:id/values/:valueId', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'delete');
      const done = await auth.db.taskListValue.updateMany({
        where: { id: idParam(req, 'valueId'), listId: idParam(req), archivedAt: null },
        data: { archivedAt: new Date(), updatedBy: auth.userId },
      });
      if (done.count === 0) throw notFound('That value');
      res.status(204).end();
    }),

    // ---------- parent message templates ----------
    route('post', '/task-setup/message-templates', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'create');
      const input = parse(messageTemplateInputSchema, req.body);
      const row = await auth.db.parentMessageTemplate
        .create({
          data: { organisationId: auth.organisationId, ...input, createdBy: auth.userId },
          select: { id: true, name: true, body: true },
        })
        .catch(clash('A message'));
      res.status(201).json(row);
    }),
    route('put', '/task-setup/message-templates/:id', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'edit');
      const id = idParam(req);
      const current = await auth.db.parentMessageTemplate.findFirst({
        where: { id, archivedAt: null },
        select: { name: true, body: true },
      });
      if (!current) throw notFound('That message');
      const merged = parse(messageTemplateInputSchema, { ...current, ...(req.body as object) });
      const row = await auth.db.parentMessageTemplate
        .update({
          where: { id },
          data: { ...merged, updatedBy: auth.userId },
          select: { id: true, name: true, body: true },
        })
        .catch(clash('A message'));
      res.json(row);
    }),
    route('delete', '/task-setup/message-templates/:id', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'delete');
      const done = await auth.db.parentMessageTemplate.updateMany({
        where: { id: idParam(req), archivedAt: null },
        data: { archivedAt: new Date(), updatedBy: auth.userId },
      });
      if (done.count === 0) throw notFound('That message');
      res.status(204).end();
    }),

    // ---------- task templates (brief 9.10) ----------
    route('get', '/task-setup/templates', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      // Managed in Task setup; used by anyone who can create tasks.
      if (!access.can('tasks', 'create') && !access.can(SETUP, 'view')) throw notAllowed();
      const page = parse(pageQuerySchema, req.query);
      const rows = await auth.db.taskTemplate.findMany({
        select: templateSelect,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: page.limit + 1,
        ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
      });
      const p = toPage(rows, page.limit);
      res.json({ items: p.items.map(presentTemplate), nextCursor: p.nextCursor });
    }),
    route('post', '/task-setup/templates', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'create');
      // Parsing strips people and fixed dates, whatever the app sent (brief 9.10).
      const input = parse(templateInputSchema, req.body);
      const row = await auth.db.taskTemplate
        .create({
          data: {
            organisationId: auth.organisationId,
            name: input.name,
            payload: toJson(input.payload),
            createdBy: auth.userId,
          },
          select: templateSelect,
        })
        .catch(clash('A template'));
      res.status(201).json(presentTemplate(row));
    }),
    route('put', '/task-setup/templates/:id', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'edit');
      const id = idParam(req);
      const current = await auth.db.taskTemplate.findFirst({
        where: { id },
        select: templateSelect,
      });
      if (!current) throw notFound('That template');
      const patch = parse(templateUpdateSchema, req.body);
      // Validate the merged template, never the fragment (lesson from the old build).
      const merged = parse(templateInputSchema, {
        name: patch.name ?? current.name,
        payload: patch.payload ?? current.payload,
      });
      const row = await auth.db.taskTemplate
        .update({
          where: { id },
          data: { name: merged.name, payload: toJson(merged.payload), updatedBy: auth.userId },
          select: templateSelect,
        })
        .catch(clash('A template'));
      res.json(presentTemplate(row));
    }),
    route('delete', '/task-setup/templates/:id', async (req, res) => {
      const auth = authOf(req);
      await setupAccess(auth, 'delete');
      const found = await auth.db.taskTemplate.findFirst({
        where: { id: idParam(req) },
        select: { id: true },
      });
      if (!found) throw notFound('That template');
      // Tasks made from it keep their own copy; nothing points back.
      await auth.db.taskTemplate.delete({ where: { id: found.id }, select: { id: true } });
      res.status(204).end();
    }),
  ];
}
