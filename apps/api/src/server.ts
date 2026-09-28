import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { RateLimits } from './core/auth/rate-limits.js';
import { TokenService } from './core/auth/tokens.js';
import { createHooks } from './core/hooks.js';
import { ConsoleMessageProvider } from './core/messaging.js';
import { createStorage } from './core/storage.js';
import { createPrisma } from './db/client.js';
import { createDataAccess } from './db/index.js';
import type { AppDeps } from './deps.js';
import { allJobs, startScheduleWatchdog } from './jobs/index.js';
import { SCHEDULE_JOB } from './apps/tasks/schedule.js';
import type { PgBoss } from 'pg-boss';
import { startJobs } from './jobs/runner.js';
import { createLogger } from './lib/logger.js';
import { scrubText } from './lib/scrub.js';
import { createErrorReporter, errorReporter, setErrorReporter } from './core/error-reporting.js';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  setErrorReporter(await createErrorReporter(config, logger));
  // A promise nobody awaited, or an exception nothing caught, leaves the process
  // in an unknown state: log it, report it, and exit so the container restarts.
  const crash = (kind: string) => (err: unknown) => {
    logger.fatal({ err }, kind);
    errorReporter().capture(err, { source: 'process' });
    void errorReporter()
      .flush(2000)
      .finally(() => process.exit(1));
  };
  process.on('unhandledRejection', crash('Unhandled promise rejection'));
  process.on('uncaughtException', crash('Uncaught exception'));
  const prisma = createPrisma(config.DATABASE_URL, config.DATABASE_POOL_SIZE);
  const rateLimitPool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 3 });
  const data = createDataAccess(prisma);

  // Test-only: a clock that runs from a chosen moment (E2E_TEST_HOOKS=1 and E2E_NOW).
  const testClock = {
    offsetMs:
      config.E2E_TEST_HOOKS === '1' && process.env.E2E_NOW
        ? Date.parse(process.env.E2E_NOW) - Date.now()
        : 0,
  };
  let boss: PgBoss | null = null;
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
    storage: createStorage(config),
    hooks: createHooks(),
    schedule: {
      // Ask for an early look at one organisation; the 15-minute run catches it anyway.
      request: (organisationId) => {
        void boss
          ?.send(
            SCHEDULE_JOB,
            { organisationId },
            { singletonKey: organisationId, singletonSeconds: 20 },
          )
          .catch((err: unknown) => {
            logger.warn({ err, organisationId }, 'Could not request an early schedule run');
          });
      },
    },
    // Tests move the clock through a test-only route (E2E_TEST_HOOKS); never in production.
    now: () => new Date(Date.now() + testClock.offsetMs),
  };

  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = process.env.WEB_DIST ?? path.resolve(here, '../../../web/dist');
  const { app } = createApp(deps, { webDist, testClock });

  await data.ping();
  boss = await startJobs(config.DATABASE_URL, logger, allJobs(deps), deps.now);
  const stopWatchdog = startScheduleWatchdog(data, logger, deps.now);
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
        stopWatchdog();
        await boss.stop({ graceful: true });
        await prisma.$disconnect();
        await rateLimitPool.end();
        await errorReporter().flush(2000);
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

main().catch(async (err: unknown) => {
  // The logger may not exist yet (bad config), so write plain JSON to stderr.
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: 'Startup failed', err: scrubText(String(err)) })}\n`,
  );
  // Reported only if tracking was already set up when start-up failed.
  errorReporter().capture(err, { source: 'startup' });
  await errorReporter().flush(2000);
  process.exit(1);
});
