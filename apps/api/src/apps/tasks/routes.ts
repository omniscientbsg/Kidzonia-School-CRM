import express from 'express';
import type { Request } from 'express';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import {
  answersInputSchema,
  cancelCopySchema,
  copyListQuerySchema,
  deferInputSchema,
  createTaskSchema,
  decideCopySchema,
  idSchema,
  isOpen,
  peopleQuerySchema,
  targetPreviewSchema,
  taskListQuerySchema,
  tickSubtaskSchema,
  updateTaskSchema,
} from '@kidzonia/shared';
import { withUnitOfWork } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import type { AuthInfo } from '../../http/types.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { AppError, notAllowed, notFound } from '../../lib/errors.js';
import { requireWritable } from '../../core/guards.js';
import { authOf } from '../../core/users/routes.js';
import { copyPowers, factsOfCopy } from './copies-core.js';
import { CopiesService } from './copies.js';
import { checkUpload, FILE_TYPES, safeFileName } from './files.js';
import { registerTaskHooks } from './hooks.js';
import { setupRoutes } from './setup.js';
import { dayEndRoutes } from './dayend.js';
import { logoutRoutes } from './logout.js';
import { describeTasks } from './entities.js';
import { homeRoutes } from './home.js';
import { reportRoutes } from './reports.js';
import { searchRoutes } from './search.js';
import { TasksService } from './service.js';

const params = (req: Request, ...keys: string[]) =>
  parse(z.object(Object.fromEntries(keys.map((k) => [k, idSchema]))), req.params) as Record<
    string,
    string
  >;
const id = (req: Request) => params(req, 'id').id ?? '';

const MB = 1024 * 1024;

/**
 * Every Tasks route. Tasks, files and notifications stay usable while
 * someone has blocking work open (brief 9.7), so none of these take the
 * write guard.
 */
export function taskRoutes(deps: AppDeps): RouteDef[] {
  registerTaskHooks(deps.hooks);
  // Tasks describe their own records in notifications and the feed.
  deps.hooks.describe.task = describeTasks;
  const tasks = new TasksService(deps);
  const copies = new CopiesService(deps);
  const limits = {
    imageMaxBytes: deps.config.TASK_IMAGE_MAX_MB * MB,
    documentMaxBytes: deps.config.TASK_FILE_MAX_MB * MB,
  };
  const route = (
    method: RouteDef['method'],
    path: string,
    handler: RouteDef['handler'],
    before?: RouteDef['before'],
  ): RouteDef => ({
    method,
    path,
    access: 'authenticated',
    guardWrites: false,
    ...(before ? { before } : {}),
    handler,
  });

  const uploadFile = async (auth: AuthInfo, assignmentId: string, name: unknown, body: unknown) => {
    const access = await auth.access();
    requireWritable(access);
    const c = await copies.visible(auth, assignmentId);
    if (!copyPowers(access, c).attach) {
      if (c.userId === access.userId && !isOpen(c.status)) {
        throw new AppError(
          'business_rule',
          'This task isn’t open any more, so files can’t be added.',
        );
      }
      throw notAllowed('Only the person doing this task can add photos and files.');
    }
    if (c._count.attachments >= deps.config.TASK_FILES_PER_COPY) {
      throw new AppError(
        'business_rule',
        `A task can have up to ${String(deps.config.TASK_FILES_PER_COPY)} photos and files.`,
      );
    }
    if (!Buffer.isBuffer(body)) throw new AppError('invalid_input', 'Choose a file to upload.');
    const file = await checkUpload(body, limits);
    const type = FILE_TYPES[file.kind];
    const key = `org/${auth.organisationId}/tasks/${assignmentId}/${uuidv7()}.${type.ext}`;
    await deps.storage.put(key, file.data, type.mime);
    try {
      await auth.db.taskAttachment.create({
        data: {
          organisationId: auth.organisationId,
          assignmentId,
          storageKey: key,
          fileName: safeFileName(typeof name === 'string' ? name : undefined, file.kind),
          contentType: type.mime,
          sizeBytes: file.data.length,
          width: file.width,
          height: file.height,
          uploadedBy: access.userId,
        },
        select: { id: true },
      });
    } catch (err) {
      await deps.storage.delete(key).catch(() => undefined);
      throw err;
    }
    await copies.started(auth, c);
    return copies.detail(auth, assignmentId);
  };

  return [
    ...setupRoutes(deps),
    ...logoutRoutes(deps),
    ...dayEndRoutes(deps),
    ...homeRoutes(deps),
    ...reportRoutes(deps),
    ...searchRoutes(deps),

    // ---------- tasks (fixed paths before /tasks/:id) ----------
    route('get', '/tasks', async (req, res) => {
      res.json(await tasks.list(authOf(req), parse(taskListQuerySchema, req.query)));
    }),
    route('post', '/tasks', async (req, res) => {
      res.status(201).json(await tasks.create(authOf(req), parse(createTaskSchema, req.body)));
    }),
    route('post', '/tasks/target-preview', async (req, res) => {
      const { target, dueDate } = parse(targetPreviewSchema, req.body);
      res.json(await tasks.previewTarget(authOf(req), target, dueDate ?? null));
    }),
    route('get', '/tasks/target-options', async (req, res) => {
      res.json(await tasks.targetOptions(authOf(req)));
    }),
    route('get', '/tasks/assignable-people', async (req, res) => {
      res.json(await tasks.assignablePeople(authOf(req), parse(peopleQuerySchema, req.query)));
    }),
    route('get', '/tasks/people', async (req, res) => {
      res.json(await tasks.anyone(authOf(req), parse(peopleQuerySchema, req.query)));
    }),
    route('get', '/tasks/:id', async (req, res) => {
      const copy = parse(z.object({ copy: idSchema.optional() }), req.query).copy ?? null;
      res.json(await tasks.detail(authOf(req), id(req), copy));
    }),
    route('put', '/tasks/:id', async (req, res) => {
      res.json(await tasks.update(authOf(req), id(req), parse(updateTaskSchema, req.body)));
    }),
    route('delete', '/tasks/:id', async (req, res) => {
      await tasks.cancel(authOf(req), id(req));
      res.status(204).end();
    }),

    // ---------- copies ----------
    route('get', '/assignments', async (req, res) => {
      res.json(await copies.list(authOf(req), parse(copyListQuerySchema, req.query)));
    }),
    route('get', '/assignments/:id', async (req, res) => {
      res.json(await copies.detail(authOf(req), id(req)));
    }),
    route('post', '/assignments/:id/submit', async (req, res) => {
      res.json(await copies.submit(authOf(req), id(req)));
    }),
    route('post', '/assignments/:id/approve', async (req, res) => {
      const { remarks } = parse(decideCopySchema, req.body ?? {});
      res.json(await copies.decide(authOf(req), id(req), true, remarks));
    }),
    route('post', '/assignments/:id/send-back', async (req, res) => {
      const { remarks } = parse(decideCopySchema, req.body ?? {});
      res.json(await copies.decide(authOf(req), id(req), false, remarks));
    }),
    route('post', '/assignments/:id/cancel', async (req, res) => {
      const { reason } = parse(cancelCopySchema, req.body);
      res.json(await copies.cancel(authOf(req), id(req), reason));
    }),
    route('post', '/assignments/:id/defer', async (req, res) => {
      const { toDate, reason } = parse(deferInputSchema, req.body);
      res.json(await copies.defer(authOf(req), id(req), toDate, reason));
    }),
    route('post', '/assignments/:id/answers', async (req, res) => {
      const { answers } = parse(answersInputSchema, req.body);
      res.json(await copies.answer(authOf(req), id(req), answers));
    }),
    route('put', '/assignments/:id/subtasks/:subtaskId', async (req, res) => {
      const p = params(req, 'id', 'subtaskId');
      const { done } = parse(tickSubtaskSchema, req.body);
      res.json(await copies.tick(authOf(req), p.id ?? '', p.subtaskId ?? '', done));
    }),

    // ---------- photos and files ----------
    route(
      'post',
      '/assignments/:id/attachments',
      async (req, res) => {
        const name = parse(z.object({ name: z.string().max(300).optional() }), req.query).name;
        res.status(201).json(await uploadFile(authOf(req), id(req), name, req.body));
      },
      [
        express.raw({
          type: () => true,
          limit: Math.max(deps.config.TASK_IMAGE_MAX_MB, deps.config.TASK_FILE_MAX_MB) * MB,
        }),
      ],
    ),
    route('delete', '/assignments/:id/attachments/:attachmentId', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      requireWritable(access);
      const p = params(req, 'id', 'attachmentId');
      const c = await copies.visible(auth, p.id ?? '');
      const file = await auth.db.taskAttachment.findFirst({
        where: { id: p.attachmentId ?? '', assignmentId: c.id },
        select: { id: true, storageKey: true, uploadedBy: true },
      });
      if (!file) throw notFound('That file');
      if (file.uploadedBy !== access.userId || !copyPowers(access, c).work) {
        throw notAllowed('Only the person who added a file can remove it, while the task is open.');
      }
      await withUnitOfWork(auth.db, auth.actor, async (uow) => {
        await uow.tx.taskAttachment.delete({ where: { id: file.id }, select: { id: true } });
      });
      await deps.storage.delete(file.storageKey);
      res.json(await copies.detail(auth, c.id));
    }),
    route('get', '/attachments/:id', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      const file = await auth.db.taskAttachment.findFirst({
        where: { id: id(req) },
        select: { assignmentId: true, storageKey: true, fileName: true, contentType: true },
      });
      if (!file) throw notFound('That file');
      // Only people who can see the task, and its photos and files, can open it.
      const c = await copies.visible(auth, file.assignmentId);
      if (access.fieldAccess('tasks', 'proof', factsOfCopy(c)) === 'hidden') {
        throw notFound('That file');
      }
      const stored = await deps.storage.get(file.storageKey);
      if (!stored) throw notFound('That file');
      const inline = file.contentType.startsWith('image/');
      res.setHeader('Content-Type', file.contentType);
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      );
      // Never runs as a page, whatever is inside; nosniff comes from helmet.
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(stored.data);
    }),
  ];
}
