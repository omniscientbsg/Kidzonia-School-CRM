import { describe, expect, it } from 'vitest';
import type { AppDeps } from '../../src/deps.js';
import {
  allJobs,
  notificationCleanupJob,
  notificationDeliveryJob,
  taskScheduleJob,
} from '../../src/jobs/index.js';

/**
 * When each background job runs. Building a job touches nothing (the database
 * is only used when it runs), so these need no app.
 */
const deps = { data: {} } as unknown as AppDeps;

describe('job timings', () => {
  it('runs the task schedule every 15 minutes and once at start-up', () => {
    const job = taskScheduleJob(deps);
    expect(job.name).toBe('task-schedule');
    expect(job.cron).toBe('*/15 * * * *');
    expect(job.runOnStart).toBe(true);
  });

  it('delivers notifications every minute and once at start-up', () => {
    const job = notificationDeliveryJob(deps);
    expect(job.cron).toBe('* * * * *');
    expect(job.runOnStart).toBe(true);
  });

  it('cleans up old notifications once a day, not at start-up', () => {
    const job = notificationCleanupJob(deps);
    expect(job.cron).toMatch(/^\d+ \d+ \* \* \*$/);
    expect(job.runOnStart).toBe(false);
  });

  it('registers every job once', () => {
    const names = allJobs(deps).map((j) => j.name);
    expect(names).toContain('task-schedule');
    expect(names).toContain('notification-cleanup');
    expect(new Set(names).size).toBe(names.length);
  });
});
