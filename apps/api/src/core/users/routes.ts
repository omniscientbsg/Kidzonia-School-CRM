import {
  changePasswordSchema,
  createUserSchema,
  deactivateUserSchema,
  idSchema,
  profileUpdateSchema,
  setUserRoleSchema,
  updateUserSchema,
  userListQuerySchema,
} from '@kidzonia/shared';
import type { Request } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import type { AuthInfo } from '../../http/types.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { AppError, notLoggedIn } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { registerFieldChangeHandler } from '../field-changes/handlers.js';
import { requireWritable } from '../guards.js';
import { withUnitOfWork } from '../../db/index.js';
import { userFacts } from './facts.js';
import { editableValues, findLiveUser, toUserData } from './records.js';
import type { EditableUser } from './records.js';
import { UsersService } from './service.js';

export const authOf = (req: Request): AuthInfo => {
  if (!req.auth) throw notLoggedIn();
  return req.auth;
};

const idParam = (req: Request) => parse(z.object({ id: idSchema }), req.params).id;

// Approved changes to Users fields are applied through this handler.
registerFieldChangeHandler('users', {
  async load(tx, recordId) {
    const row = await findLiveUser(tx, recordId);
    if (!row) return null;
    return { values: editableValues(row), facts: userFacts(row), subjectUserId: row.id };
  },
  async apply(tx, recordId, props) {
    await tx.user.update({
      where: { id: recordId },
      data: toUserData(props as Partial<EditableUser>),
      select: { id: true, homeSchoolId: true },
    });
  },
});

export function userRoutes(deps: AppDeps): RouteDef[] {
  const users = new UsersService(deps);
  return [
    {
      method: 'get',
      path: '/users',
      access: 'authenticated',
      handler: async (req, res) => {
        res.json(await users.list(authOf(req), parse(userListQuerySchema, req.query)));
      },
    },
    {
      method: 'get',
      path: '/users/summary',
      access: 'authenticated',
      handler: async (req, res) => {
        res.json(await users.summary(authOf(req)));
      },
    },
    {
      method: 'post',
      path: '/users',
      access: 'authenticated',
      handler: async (req, res) => {
        res.status(201).json(await users.create(authOf(req), parse(createUserSchema, req.body)));
      },
    },
    {
      method: 'get',
      path: '/users/:id',
      access: 'authenticated',
      handler: async (req, res) => {
        res.json(await users.get(authOf(req), idParam(req)));
      },
    },
    {
      method: 'put',
      path: '/users/:id',
      access: 'authenticated',
      handler: async (req, res) => {
        res.json(await users.update(authOf(req), idParam(req), parse(updateUserSchema, req.body)));
      },
    },
    {
      method: 'delete',
      path: '/users/:id',
      access: 'authenticated',
      handler: async (req, res) => {
        await users.remove(authOf(req), idParam(req));
        res.status(204).end();
      },
    },
    {
      method: 'put',
      path: '/users/:id/role',
      access: 'authenticated',
      handler: async (req, res) => {
        const { role } = parse(setUserRoleSchema, req.body);
        res.json(await users.setRole(authOf(req), idParam(req), role));
      },
    },
    {
      method: 'post',
      path: '/users/:id/deactivate',
      access: 'authenticated',
      handler: async (req, res) => {
        const { moveReportsTo } = parse(deactivateUserSchema, req.body ?? {});
        res.json(await users.deactivate(authOf(req), idParam(req), moveReportsTo));
      },
    },
    {
      method: 'post',
      path: '/users/:id/reactivate',
      access: 'authenticated',
      handler: async (req, res) => {
        res.json(await users.reactivate(authOf(req), idParam(req)));
      },
    },
    {
      method: 'post',
      path: '/users/:id/invite',
      access: 'authenticated',
      handler: async (req, res) => {
        res.json(await users.invite(authOf(req), idParam(req)));
      },
    },
    // "Your details": the same rules as editing anyone, with you as the person.
    {
      method: 'get',
      path: '/me/profile',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        const access = await auth.access();
        res.json(await users.get(auth, access.userId));
      },
    },
    {
      method: 'put',
      path: '/me/profile',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        res.json(await users.update(auth, auth.userId, parse(profileUpdateSchema, req.body)));
      },
    },
    {
      method: 'put',
      path: '/me/password',
      access: 'authenticated',
      guardWrites: false,
      handler: async (req, res) => {
        const auth = authOf(req);
        requireWritable(await auth.access());
        const input = parse(changePasswordSchema, req.body);
        const me = await auth.db.user.findFirst({
          where: { id: auth.userId },
          select: { passwordHash: true, mobile: true },
        });
        if (!me) throw notLoggedIn();
        await deps.rateLimits.consumeLoginAttempt(req.ip ?? 'unknown', me.mobile);
        if (me.passwordHash) {
          if (
            !input.currentPassword ||
            !(await verifyPassword(me.passwordHash, input.currentPassword))
          ) {
            throw new AppError('invalid_input', 'Your current password is wrong.', {
              currentPassword: 'This isn’t your current password.',
            });
          }
        }
        const hash = await hashPassword(input.newPassword);
        await withUnitOfWork(auth.db, auth.actor, async (uow) => {
          await uow.tx.user.update({
            where: { id: auth.userId },
            data: { passwordHash: hash },
            select: { id: true, homeSchoolId: true },
          });
          uow.audit({ action: 'user.password_changed', entityType: 'user', entityId: auth.userId });
        });
        // Other devices must sign in again with the new password.
        await deps.data.auth.revokeAllForUser(
          auth.userId,
          'password_changed',
          deps.now(),
          auth.sessionId,
        );
        res.status(204).end();
      },
    },
  ];
}
