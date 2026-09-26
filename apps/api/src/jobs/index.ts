import type { DataAccess } from '../db/index.js';
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

export function allJobs(data: DataAccess): JobDef[] {
  return [authCleanupJob(data)];
}
