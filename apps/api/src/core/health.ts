import type { AppDeps } from '../deps.js';
import type { RouteDef } from '../http/routes.js';

export function healthRoutes(deps: AppDeps): RouteDef[] {
  return [
    {
      method: 'get',
      path: '/health',
      access: 'public',
      handler: async (_req, res) => {
        const started = Date.now();
        try {
          await deps.data.ping();
          res.json({ status: 'ok', database: 'ok', latencyMs: Date.now() - started });
        } catch (err) {
          deps.logger.error({ err }, 'Health check: database unreachable');
          res.status(503).json({ status: 'error', database: 'unreachable' });
        }
      },
    },
  ];
}
