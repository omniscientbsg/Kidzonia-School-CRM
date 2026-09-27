import { z } from 'zod';
import { TaskSchedule } from '../apps/tasks/schedule.js';
import { NotificationWorker } from '../core/notifications/worker.js';
import type { AppDeps } from '../deps.js';
import type { RouteDef } from './routes.js';
import { parse } from './validate.js';

/**
 * Test-only routes for Playwright (Phase 4 item g): move the server's clock
 * and run the task schedule on demand. Mounted only when E2E_TEST_HOOKS=1,
 * which the configuration refuses in production.
 */
export function testRoutes(deps: AppDeps, clock: { offsetMs: number }): RouteDef[] {
  const schedule = new TaskSchedule(deps);
  const worker = new NotificationWorker(deps);
  return [
    {
      method: 'post',
      path: '/__test/clock',
      access: 'public',
      handler: (req, res) => {
        const { now } = parse(z.object({ now: z.iso.datetime().nullable() }), req.body);
        // The clock keeps running from the new moment.
        clock.offsetMs = now ? Date.parse(now) - Date.now() : 0;
        res.json({ now: deps.now().toISOString() });
      },
    },
    {
      method: 'post',
      path: '/__test/deliver-notifications',
      access: 'public',
      handler: async (_req, res) => {
        res.json(await worker.run(deps.now()));
      },
    },
    {
      method: 'post',
      path: '/__test/run-schedule',
      access: 'public',
      handler: async (_req, res) => {
        res.json(await schedule.run(deps.now()));
      },
    },
  ];
}
