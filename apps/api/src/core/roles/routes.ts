import {
  addAssignmentSchema,
  createRoleSchema,
  idSchema,
  pageQuerySchema,
  roleFieldsSchema,
  rolePermissionsSchema,
  updateAutomaticRolesSchema,
  updateRoleSchema,
} from '@kidzonia/shared';
import type { Request } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { authOf } from '../users/routes.js';
import { RolesService } from './service.js';

const idParam = (req: Request) => parse(z.object({ id: idSchema }), req.params).id;

export function roleRoutes(deps: AppDeps): RouteDef[] {
  const roles = new RolesService(deps);
  return [
    {
      method: 'get',
      path: '/roles',
      access: 'authenticated',
      handler: async (req, res) => {
        res.json(await roles.list(authOf(req), parse(pageQuerySchema, req.query)));
      },
    },
    {
      method: 'get',
      path: '/roles/assignable',
      access: 'authenticated',
      handler: async (req, res) => {
        res.json(await roles.assignable(authOf(req), parse(pageQuerySchema, req.query)));
      },
    },
    {
      method: 'post',
      path: '/roles',
      access: 'authenticated',
      handler: async (req, res) => {
        const input = parse(createRoleSchema, req.body);
        res.status(201).json(await roles.create(authOf(req), input));
      },
    },
    {
      method: 'get',
      path: '/roles/:id',
      access: 'authenticated',
      handler: async (req, res) => {
        res.json(await roles.detail(authOf(req), idParam(req)));
      },
    },
    {
      method: 'put',
      path: '/roles/:id',
      access: 'authenticated',
      handler: async (req, res) => {
        res.json(await roles.rename(authOf(req), idParam(req), parse(updateRoleSchema, req.body)));
      },
    },
    {
      method: 'delete',
      path: '/roles/:id',
      access: 'authenticated',
      handler: async (req, res) => {
        await roles.remove(authOf(req), idParam(req));
        res.status(204).end();
      },
    },
    {
      method: 'get',
      path: '/roles/:id/permissions',
      access: 'authenticated',
      handler: async (req, res) => {
        const d = await roles.detail(authOf(req), idParam(req));
        res.json({ modules: d.modules });
      },
    },
    {
      method: 'put',
      path: '/roles/:id/permissions',
      access: 'authenticated',
      handler: async (req, res) => {
        const { modules } = parse(rolePermissionsSchema, req.body);
        res.json(await roles.setPermissions(authOf(req), idParam(req), modules));
      },
    },
    {
      method: 'get',
      path: '/roles/:id/fields',
      access: 'authenticated',
      handler: async (req, res) => {
        const d = await roles.detail(authOf(req), idParam(req));
        res.json({ fields: d.fields });
      },
    },
    {
      method: 'put',
      path: '/roles/:id/fields',
      access: 'authenticated',
      handler: async (req, res) => {
        const { fields } = parse(roleFieldsSchema, req.body);
        res.json(await roles.setFields(authOf(req), idParam(req), fields));
      },
    },
    {
      method: 'get',
      path: '/roles/:id/assignments',
      access: 'authenticated',
      handler: async (req, res) => {
        res.json(await roles.holders(authOf(req), idParam(req), parse(pageQuerySchema, req.query)));
      },
    },
    {
      method: 'post',
      path: '/roles/:id/assignments',
      access: 'authenticated',
      handler: async (req, res) => {
        const input = parse(addAssignmentSchema, req.body);
        await roles.addHolder(authOf(req), idParam(req), input.userId, input.scope);
        res.status(204).end();
      },
    },
    {
      method: 'delete',
      path: '/roles/:id/assignments/:userId',
      access: 'authenticated',
      handler: async (req, res) => {
        const { id, userId } = parse(z.object({ id: idSchema, userId: idSchema }), req.params);
        await roles.removeHolder(authOf(req), id, userId);
        res.status(204).end();
      },
    },
    {
      method: 'get',
      path: '/automatic-roles',
      access: 'authenticated',
      handler: async (req, res) => {
        res.json(await roles.automatic(authOf(req)));
      },
    },
    {
      method: 'put',
      path: '/automatic-roles',
      access: 'authenticated',
      handler: async (req, res) => {
        const { switches } = parse(updateAutomaticRolesSchema, req.body);
        res.json(await roles.setAutomatic(authOf(req), switches));
      },
    },
  ];
}
