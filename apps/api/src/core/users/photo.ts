import express from 'express';
import type { Request } from 'express';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { idSchema } from '@kidzonia/shared';
import type { PhotoResult } from '@kidzonia/shared';
import { withUnitOfWork } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import type { AuthInfo } from '../../http/types.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { invalidInput, notFound } from '../../lib/errors.js';
import { requireRecord, requireWritable } from '../guards.js';
import { IMAGE_TYPES, cleanImage } from '../images.js';
import { assertCanManagePerson } from '../roles/rules.js';
import { userFacts } from './facts.js';
import { userPhotoUrl } from './records.js';
import { authOf } from './routes.js';

/**
 * Brief audit D2: a photo per person, through the same checks as the logo
 * (type from the bytes, never SVG, re-encoded so no metadata survives).
 * Phone camera photos are often 3–5 MB, so the limit is higher than the
 * logo's; the stored file is always a 256 px square, whatever came in.
 */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_SIDE = 256;

const idParam = (req: Request) => parse(z.object({ id: idSchema }), req.params).id;

/**
 * Your own photo is always yours to change. Anyone else's needs Users → Edit
 * over that person (reach), and the power rule: nobody changes someone whose
 * role can do more than their own. Out of reach answers 404, like every record.
 */
async function assertCanChangePhoto(auth: AuthInfo, userId: string): Promise<void> {
  const access = await auth.access();
  requireWritable(access);
  const row = await auth.db.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, homeSchoolId: true },
  });
  if (!row) throw notFound('That person');
  if (userId === auth.userId) return;
  requireRecord(access, 'users', 'edit', userFacts(row), 'That person');
  await assertCanManagePerson(auth.db, await auth.permissions(), userId);
}

async function setPhoto(
  deps: AppDeps,
  auth: AuthInfo,
  userId: string,
  body: unknown,
): Promise<PhotoResult> {
  await assertCanChangePhoto(auth, userId);
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw invalidInput('Choose a photo to upload.', { file: 'Choose a photo to upload.' });
  }
  const image = await cleanImage(body, PHOTO_SIDE, { square: true });
  const key = `org/${auth.organisationId}/users/${userId}/photo-${uuidv7()}.${image.kind === 'jpeg' ? 'jpg' : image.kind}`;
  await deps.storage.put(key, image.data, IMAGE_TYPES[image.kind]);
  let oldKey: string | null;
  try {
    oldKey = await withUnitOfWork(auth.db, auth.actor, async (uow) => {
      const before = await uow.tx.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { photoKey: true },
      });
      if (!before) throw notFound('That person');
      await uow.tx.user.update({
        where: { id: userId },
        data: { photoKey: key, updatedBy: auth.userId },
        select: { id: true, homeSchoolId: true },
      });
      uow.audit({
        action: 'user.photo_changed',
        entityType: 'user',
        entityId: userId,
        before: { photo: before.photoKey ? 'set' : 'none' },
        after: { photo: 'set' },
      });
      return before.photoKey;
    });
  } catch (err) {
    // Nothing points at the new file; don't leave it behind.
    await deps.storage.delete(key);
    throw err;
  }
  if (oldKey) await deps.storage.delete(oldKey);
  return { photoUrl: userPhotoUrl(userId, key) };
}

async function removePhoto(deps: AppDeps, auth: AuthInfo, userId: string): Promise<void> {
  await assertCanChangePhoto(auth, userId);
  const oldKey = await withUnitOfWork(auth.db, auth.actor, async (uow) => {
    const before = await uow.tx.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { photoKey: true },
    });
    if (!before?.photoKey) return null;
    await uow.tx.user.update({
      where: { id: userId },
      data: { photoKey: null, updatedBy: auth.userId },
      select: { id: true, homeSchoolId: true },
    });
    uow.audit({
      action: 'user.photo_changed',
      entityType: 'user',
      entityId: userId,
      before: { photo: 'set' },
      after: { photo: 'none' },
    });
    return before.photoKey;
  });
  if (oldKey) await deps.storage.delete(oldKey);
}

export function photoRoutes(deps: AppDeps): RouteDef[] {
  const raw = express.raw({ type: () => true, limit: PHOTO_MAX_BYTES });
  return [
    {
      method: 'put',
      path: '/me/photo',
      access: 'authenticated',
      before: [raw],
      handler: async (req, res) => {
        const auth = authOf(req);
        res.json(await setPhoto(deps, auth, auth.userId, req.body));
      },
    },
    {
      method: 'delete',
      path: '/me/photo',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        await removePhoto(deps, auth, auth.userId);
        res.status(204).end();
      },
    },
    {
      // Anyone signed in to the same organisation may see a colleague's photo:
      // it appears next to their name across the app. Other organisations get
      // 404 because the query is scoped to the caller's organisation.
      method: 'get',
      path: '/users/:id/photo',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        const id = idParam(req);
        const user = await auth.db.user.findFirst({
          where: { id, deletedAt: null },
          select: { photoKey: true },
        });
        const file = user?.photoKey ? await deps.storage.get(user.photoKey) : null;
        if (!file) throw notFound('That photo');
        // Only ever an image type we produced ourselves; nosniff comes from helmet.
        res.setHeader('Content-Type', file.contentType);
        res.setHeader('Content-Disposition', 'inline; filename="photo"');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.send(file.data);
      },
    },
    {
      method: 'put',
      path: '/users/:id/photo',
      access: 'authenticated',
      before: [raw],
      handler: async (req, res) => {
        res.json(await setPhoto(deps, authOf(req), idParam(req), req.body));
      },
    },
    {
      method: 'delete',
      path: '/users/:id/photo',
      access: 'authenticated',
      handler: async (req, res) => {
        await removePhoto(deps, authOf(req), idParam(req));
        res.status(204).end();
      },
    },
  ];
}
