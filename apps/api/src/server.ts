import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { RateLimits } from './core/auth/rate-limits.js';
import { TokenService } from './core/auth/tokens.js';
import { createHooks } from './core/hooks.js';
import { ConsoleMessageProvider } from './core/messaging.js';
import { createPrisma } from './db/client.js';
import { createDataAccess } from './db/index.js';
import type { AppDeps } from './deps.js';
import { allJobs } from './jobs/index.js';
import { startJobs } from './jobs/runner.js';
import { createLogger } from './lib/logger.js';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const prisma = createPrisma(config.DATABASE_URL, config.DATABASE_POOL_SIZE);
  const rateLimitPool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 3 });
  const data = createDataAccess(prisma);

  const deps: AppDeps = {
    config,
    logger,
    data,
    tokens: new TokenService(
      config.JWT_SECRET,
      config.JWT_SECRET_PREVIOUS,
      config.ACCESS_TOKEN_TTL_MINUTES * 60,
    ),
    rateLimits: new RateLimits(rateLimitPool, config),
    messages: new ConsoleMessageProvider(logger),
    hooks: createHooks(),
    now: () => new Date(),
  };

  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = process.env.WEB_DIST ?? path.resolve(here, '../../../web/dist');
  const { app } = createApp(deps, { webDist });

  await data.ping();
  const boss = await startJobs(config.DATABASE_URL, logger, allJobs(data));
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'API listening');
  });

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Shutting down');
    // Stop taking requests, let in-flight ones finish, then close resources.
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    server.close(() => {
      void (async () => {
        await boss.stop({ graceful: true });
        await prisma.$disconnect();
        await rateLimitPool.end();
        logger.info('Stopped');
        process.exit(0);
      })();
    });
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

main().catch((err: unknown) => {
  // The logger may not exist yet (bad config), so write plain JSON to stderr.
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: 'Startup failed', err: String(err) })}\n`,
  );
  process.exit(1);
});
