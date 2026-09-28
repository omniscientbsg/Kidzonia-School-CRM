import { PgBoss } from 'pg-boss';
import { errorReporter } from '../core/error-reporting.js';
import type { Logger } from '../lib/logger.js';

/**
 * A background job. Every job must be safe to run twice: pg-boss retries on
 * failure, and a job may also run once at start-up and again on schedule.
 */
export interface JobDef {
  name: string;
  /** Cron expression (server time zone: UTC). */
  cron: string;
  /** Also run once when the server starts, so a restart never skips a window. */
  runOnStart: boolean;
  /** Does the work and returns counts to log. Throwing triggers a retry. */
  run(now: Date, payload?: Record<string, unknown> | null): Promise<Record<string, number>>;
}

const RETRY = { retryLimit: 3, retryDelay: 30, retryBackoff: true, retryDelayMax: 600 };

export async function startJobs(
  connectionString: string,
  logger: Logger,
  jobs: readonly JobDef[],
  now: () => Date = () => new Date(),
): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString, schema: 'pgboss' });
  boss.on('error', (err) => {
    logger.error({ err }, 'Job queue error');
    errorReporter().capture(err, { source: 'job-queue' });
  });
  await boss.start();

  for (const job of jobs) {
    // "singleton": one active run of each job at a time on this queue.
    await boss.createQueue(job.name, { ...RETRY, policy: 'singleton' });
    await boss.schedule(job.name, job.cron, null, { tz: 'UTC' });
    await boss.work(job.name, async (batch) => {
      for (const item of batch) {
        const started = Date.now();
        try {
          const result = await job.run(now(), item.data as Record<string, unknown> | null);
          logger.info(
            { job: job.name, jobId: item.id, ms: Date.now() - started, result },
            'Job done',
          );
        } catch (err) {
          logger.error({ job: job.name, jobId: item.id, err }, 'Job failed; will retry');
          errorReporter().capture(err, { source: 'job', job: job.name, jobId: item.id });
          throw err;
        }
      }
    });
    if (job.runOnStart) await boss.send(job.name, {}, { singletonKey: `${job.name}:startup` });
  }
  return boss;
}
