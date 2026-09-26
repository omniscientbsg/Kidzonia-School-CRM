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
import { meRoutes } from './core/me.js';
import type { AppDeps } from './deps.js';
import { errorHandler, unknownRoute } from './http/error-handler.js';
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
}

/** Every route of the API, in one table. Apps add theirs here as they're built. */
export function buildRoutes(deps: AppDeps): RouteTable {
  return new RouteTable().add(...healthRoutes(deps), ...authRoutes(deps), ...meRoutes());
}

export function createApp(deps: AppDeps, options: AppOptions = {}): CreatedApp {
  const app = express();
  const routes = buildRoutes(deps);
  const isProduction = deps.config.NODE_ENV === 'production';

  app.disable('x-powered-by');
  app.set('trust proxy', deps.config.TRUST_PROXY);

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
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
          'connect-src': ["'self'"],
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
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Kidzonia-Client'],
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
