import { z } from 'zod';
import {
  isNotificationEvent,
  markReadSchema,
  mutedByDefault,
  NOTIFICATION_EVENTS,
  preferenceInputSchema,
  SMS_EVENTS,
} from '@kidzonia/shared';
import type { AppDeps } from '../../deps.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { invalidInput } from '../../lib/errors.js';
import { requireWritable } from '../guards.js';
import { authOf } from '../users/routes.js';
import { groupsFor, renderGroups } from './render.js';

/**
 * The bell (brief 10.2). Never narrowed by the school switcher (Phase 5
 * answer 5): missing an approval because you were looking at another school
 * would be worse than a broader list. Notifications stay usable during a
 * logout-block walkout (brief 9.7).
 */
export function notificationRoutes(deps: AppDeps): RouteDef[] {
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
  return [
    route('get', '/notifications', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      const q = parse(
        z.object({
          offset: z.coerce.number().int().min(0).default(0),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
        req.query,
      );
      const { rows, more } = await groupsFor(auth.db, access.userId, q.offset, q.limit);
      res.json({
        items: await renderGroups(auth.db, deps.hooks, access, rows),
        nextOffset: more ? q.offset + q.limit : null,
      });
    }),
    route('get', '/notifications/count', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      const groups = await auth.db.notification.groupBy({
        by: ['groupKey'],
        where: { recipientUserId: access.userId, readAt: null },
      });
      res.json({ unread: groups.length });
    }),
    route('post', '/notifications/read', async (req, res) => {
      const auth = authOf(req);
      requireWritable(await auth.access());
      const { keys } = parse(markReadSchema, req.body);
      await auth.db.notification.updateMany({
        where: { recipientUserId: auth.userId, groupKey: { in: keys }, readAt: null },
        data: { readAt: deps.now() },
      });
      res.status(204).end();
    }),
    route('post', '/notifications/read-all', async (req, res) => {
      const auth = authOf(req);
      requireWritable(await auth.access());
      await auth.db.notification.updateMany({
        where: { recipientUserId: auth.userId, readAt: null },
        data: { readAt: deps.now() },
      });
      res.status(204).end();
    }),

    // Muting per event and channel (Phase 5 c).
    route('get', '/me/notification-settings', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      const prefs = await auth.db.notificationPreference.findMany({
        where: { userId: access.userId },
      });
      const on = (event: string, channel: 'in_app' | 'sms') => {
        const p = prefs.find((x) => x.event === event && x.channel === channel);
        // Shown as the general default; due soon by SMS still reaches blocking tasks unless turned off.
        return p ? !p.muted : !mutedByDefault(event, channel, false);
      };
      res.json({
        events: Object.entries(NOTIFICATION_EVENTS).map(([event, label]) => ({
          event,
          label,
          inApp: on(event, 'in_app'),
          sms: (SMS_EVENTS as readonly string[]).includes(event) ? on(event, 'sms') : null,
        })),
      });
    }),
    route('put', '/me/notification-settings', async (req, res) => {
      const auth = authOf(req);
      requireWritable(await auth.access());
      const input = parse(preferenceInputSchema, req.body);
      if (!isNotificationEvent(input.event)) throw invalidInput('Unknown notification.');
      if (input.channel === 'sms' && !(SMS_EVENTS as readonly string[]).includes(input.event)) {
        throw invalidInput('That notification is only sent in the app.');
      }
      await auth.db.notificationPreference.upsert({
        where: {
          userId_event_channel: { userId: auth.userId, event: input.event, channel: input.channel },
        },
        create: {
          organisationId: auth.organisationId,
          userId: auth.userId,
          event: input.event,
          channel: input.channel,
          muted: !input.on,
        },
        update: { muted: !input.on },
        select: { userId: true },
      });
      res.status(204).end();
    }),
  ];
}
