import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import type { AppDeps } from '../deps.js';
import { requireAuth, writeGuard } from './auth.js';

export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface RouteDef {
  method: Method;
  /** Path under /api, e.g. `/me`. */
  path: string;
  /**
   * public: no sign-in. authenticated: sign-in required.
   * Every authenticated route must have a case in the tenant-isolation suite.
   */
  access: 'public' | 'authenticated';
  /**
   * Whether write guards (logout block) apply. Defaults to true for
   * authenticated writes; auth, files and notifications opt out (brief 9.7).
   */
  guardWrites?: boolean;
  /** Extra middleware run before the handler (e.g. a rate limiter). */
  before?: RequestHandler[];
  handler: (req: Request, res: Response) => Promise<void> | void;
}

const toRegex = (path: string) =>
  new RegExp(`^${path.replace(/:[A-Za-z0-9_]+/g, '[^/]+').replace(/\//g, '\\/')}$`);

/**
 * Brief 11: fixed paths must come before parameter paths, or `/tasks/analytics`
 * gets matched as `/tasks/:id`. Checked at startup so the mistake can't ship.
 */
export function assertRouteOrder(routes: readonly RouteDef[]): void {
  routes.forEach((earlier, i) => {
    if (!earlier.path.includes(':')) return;
    const re = toRegex(earlier.path);
    for (const later of routes.slice(i + 1)) {
      if (later.method === earlier.method && !later.path.includes(':') && re.test(later.path)) {
        throw new Error(
          `Route ${later.method.toUpperCase()} ${later.path} is shadowed by ${earlier.path}; declare it first`,
        );
      }
    }
  });
}

/**
 * Collects every route in one table. The table is mounted on the app and also
 * exported, so tests can prove every endpoint is covered.
 */
export class RouteTable {
  readonly routes: RouteDef[] = [];

  add(...defs: RouteDef[]): this {
    this.routes.push(...defs);
    return this;
  }

  router(deps: AppDeps): Router {
    assertRouteOrder(this.routes);
    const router = Router();
    const auth = requireAuth(deps);
    const guard = writeGuard(deps);
    for (const r of this.routes) {
      const chain: RequestHandler[] = [];
      if (r.access === 'authenticated') {
        chain.push(auth);
        if (r.method !== 'get' && r.guardWrites !== false) chain.push(guard);
      }
      chain.push(...(r.before ?? []));
      const handler: RequestHandler = async (req, res) => {
        await r.handler(req, res);
      };
      router[r.method](r.path, ...chain, handler);
    }
    return router;
  }
}
