import type { AppDeps } from '../deps.js';
import type { DataAccess } from '../db/index.js';
import type { Logger } from '../lib/logger.js';
import { SCHEDULE_JOB, TaskSchedule } from '../apps/tasks/schedule.js';
import { DELIVERY_JOB, NotificationWorker } from '../core/notifications/worker.js';
import { PARENT_MESSAGE_JOB, ParentMessageWorker } from '../apps/tasks/parent-messages.js';
import type { JobDef } from './runner.js';

/**
 * Removes expired sign-in codes, old sessions and stale rate-limit counters.
 * Deleting what's already gone is a no-op, so running twice is harmless.
 */
export function authCleanupJob(data: DataAccess): JobDef {
  return {
    name: 'auth-cleanup',
    cron: '17 * * * *',
    runOnStart: true,
    run: (now) => data.auth.deleteExpired(now),
  };
}

/**
 * The task schedule (Phase 4): every 15 minutes and at start-up. A request
 * with an organisation id (after a holiday or hours change) looks at just
 * that organisation straight away.
 */
export function taskScheduleJob(deps: AppDeps): JobDef {
  const schedule = new TaskSchedule(deps);
  return {
    name: SCHEDULE_JOB,
    cron: '*/15 * * * *',
    runOnStart: true,
    run: async (now, payload) => {
      const org = typeof payload?.organisationId === 'string' ? payload.organisationId : null;
      const counts = await schedule.run(now, org);
      return counts ? { ...counts } : { skipped: 1 };
    },
  };
}

/** Delivers the notification outbox every minute (Phase 5 c). */
export function notificationDeliveryJob(deps: AppDeps): JobDef {
  const worker = new NotificationWorker(deps);
  return {
    name: DELIVERY_JOB,
    cron: '* * * * *',
    runOnStart: true,
    run: async (now) => {
      const counts = await worker.run(now);
      return counts ? { ...counts } : { skipped: 1 };
    },
  };
}

/** Removes notifications older than NOTIFICATIONS_KEEP_DAYS, daily. */
export function notificationCleanupJob(deps: AppDeps): JobDef {
  const worker = new NotificationWorker(deps);
  return {
    name: 'notification-cleanup',
    cron: '41 3 * * *',
    runOnStart: false,
    run: (now) => worker.cleanUp(now),
  };
}

/** Messages to parents (Phase 6): every minute and at start-up. */
export function parentMessageJob(deps: AppDeps): JobDef {
  const worker = new ParentMessageWorker(deps);
  return {
    name: PARENT_MESSAGE_JOB,
    cron: '* * * * *',
    runOnStart: true,
    run: async (now) => {
      const counts = await worker.run(now);
      return counts ? { ...counts } : { skipped: 1 };
    },
  };
}

export function allJobs(deps: AppDeps): JobDef[] {
  return [
    authCleanupJob(deps.data),
    taskScheduleJob(deps),
    notificationDeliveryJob(deps),
    notificationCleanupJob(deps),
    parentMessageJob(deps),
  ];
}

/** Warns in the logs when the task schedule hasn't succeeded for an hour (Phase 4 addition a). */
export function startScheduleWatchdog(data: DataAccess, logger: Logger, now: () => Date) {
  const check = async () => {
    try {
      const last = await data.jobs.lastSuccess(SCHEDULE_JOB);
      const age = last ? now().getTime() - last.getTime() : null;
      if (age === null || age > 60 * 60 * 1000) {
        logger.warn(
          { job: SCHEDULE_JOB, lastSuccessAt: last?.toISOString() ?? null },
          'The task schedule has not run successfully for over an hour',
        );
      }
    } catch (err) {
      logger.error({ err }, 'Schedule watchdog failed');
    }
  };
  const timer = setInterval(() => void check(), 5 * 60 * 1000);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
