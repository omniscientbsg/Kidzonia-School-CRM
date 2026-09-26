import type { Request } from 'express';
import { z } from 'zod';
import { fieldChangeListQuerySchema, idSchema, rejectFieldChangeSchema } from '@kidzonia/shared';
import type { AppDeps } from '../../deps.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { requireWritable } from '../guards.js';
import { authOf } from '../users/routes.js';
import {
  approveFieldChange,
  countToApprove,
  listFieldChanges,
  rejectFieldChange,
} from './service.js';

const idParam = (req: Request) => parse(z.object({ id: idSchema }), req.params).id;

export function fieldChangeRoutes(deps: AppDeps): RouteDef[] {
  return [
    {
      method: 'get',
      path: '/field-changes',
      access: 'authenticated',
      handler: async (req, res) => {
        const q = parse(fieldChangeListQuerySchema, req.query);
        res.json(await listFieldChanges(authOf(req), deps.data, q.view, q));
      },
    },
    {
      method: 'get',
      path: '/field-changes/count',
      access: 'authenticated',
      handler: async (req, res) => {
        res.json({ toApprove: await countToApprove(authOf(req), deps.data) });
      },
    },
    {
      method: 'post',
      path: '/field-changes/:id/approve',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        requireWritable(await auth.access());
        res.json(await approveFieldChange(auth, deps.data, idParam(req), deps.now()));
      },
    },
    {
      method: 'post',
      path: '/field-changes/:id/reject',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        requireWritable(await auth.access());
        const { reason } = parse(rejectFieldChangeSchema, req.body ?? {});
        res.json(await rejectFieldChange(auth, deps.data, idParam(req), reason, deps.now()));
      },
    },
  ];
}
