import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { authRoutes } from './core/auth/routes.js';
import { healthRoutes } from './core/health.js';
import { fieldChangeRoutes } from './core/field-changes/routes.js';
import { meRoutes } from './core/me.js';
import { organisationRoutes } from './core/organisation/routes.js';
import { registrationRoutes } from './core/registration/routes.js';
import { roleRoutes } from './core/roles/routes.js';
import { schoolRoutes } from './core/schools/routes.js';
import { userRoutes } from './core/users/routes.js';
import { photoRoutes } from './core/users/photo.js';
import { taskRoutes } from './apps/tasks/routes.js';
import { notificationRoutes } from './core/notifications/routes.js';
import { parentContactRoutes } from './core/parent-contacts/routes.js';
import { auditRoutes } from './core/audit/routes.js';
import { testRoutes } from './http/test-routes.js';
import type { AppDeps } from './deps.js';
import { errorHandler, unknownRoute } from './http/error-handler.js';
import { errorTrackingConnectSources } from './core/error-reporting.js';
import { errSerializer } from './lib/logger.js';
import { requestContext } from './http/request-context.js';
import { RouteTable } from './http/routes.js';
import './http/types.js';

export interface CreatedApp {
  app: Express;
  routes: RouteTable;
}

export interface AppOptions {
  /** Built web app to serve (production: one container serves both). */
  webDist?: string;
  /** The server's movable clock, for the test-only routes (E2E_TEST_HOOKS=1). */
  testClock?: { offsetMs: number };
}

/** Every route of the API, in one table. Apps add theirs here as they're built. */
export function buildRoutes(deps: AppDeps, options: AppOptions = {}): RouteTable {
  const table = new RouteTable();
  if (deps.config.E2E_TEST_HOOKS === '1' && options.testClock) {
    table.add(...testRoutes(deps, options.testClock));
  }
  return table.add(
    ...healthRoutes(deps),
    ...authRoutes(deps),
    ...registrationRoutes(deps),
    ...meRoutes(deps),
    ...organisationRoutes(deps),
    ...schoolRoutes(deps),
    ...userRoutes(deps),
    ...photoRoutes(deps),
    ...roleRoutes(deps),
    ...fieldChangeRoutes(deps),
    ...notificationRoutes(deps),
    ...parentContactRoutes(deps),
    ...auditRoutes(deps),
    ...taskRoutes(deps),
  );
}

export function createApp(deps: AppDeps, options: AppOptions = {}): CreatedApp {
  const app = express();
  const routes = buildRoutes(deps, options);
  const isProduction = deps.config.NODE_ENV === 'production';

  app.disable('x-powered-by');
  app.set('trust proxy', deps.config.TRUST_PROXY);

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      // A signed-out page load answering 401 is routine, not worth a warning.
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400 && res.statusCode !== 401 && res.statusCode !== 404) {
          return 'warn';
        }
        return 'info';
      },
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        err: errSerializer,
      },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'font-src': ["'self'", 'data:'],
          // Plus the error tracker's host when the web app reports errors (off by default).
          'connect-src': ["'self'", ...errorTrackingConnectSources(deps.config)],
        },
      },
      strictTransportSecurity: isProduction,
    }),
  );
  // The web app is served from the same origin, so CORS only matters for the
  // origins explicitly listed (e.g. the Vite dev server when not proxied).
  app.use(
    cors({
      origin: (origin, cb) => {
        cb(null, !origin || deps.config.CORS_ORIGINS.includes(origin));
      },
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Request-Id',
        'X-Kidzonia-Client',
        'X-Kidzonia-Preview',
      ],
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api', routes.router(deps));
  app.use('/api', unknownRoute);

  if (options.webDist && existsSync(options.webDist)) {
    const dist = path.resolve(options.webDist);
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    // Client-side routes: any other GET gets the app shell.
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler(deps.logger, !isProduction));
  return { app, routes };
}
