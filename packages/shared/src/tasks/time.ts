import { addDays } from './calendar.js';
import type { IsoDate } from './calendar.js';
import { isOpen, FINISHED_STATUSES } from './status.js';
import type { TaskStatus } from './status.js';

/** "7 of 10 done" for any set of copies. */
export interface Completion {
  total: number;
  done: number;
  submitted: number;
  overdue: number;
}

/**
 * The one completion count (brief 9.4): closed and cancelled copies are left
 * out of the total everywhere (lists, the drawer, day-end Today, reports).
 */
export function completionOf(copies: readonly { status: TaskStatus }[]): Completion {
  const finished = FINISHED_STATUSES as readonly TaskStatus[];
  let total = 0;
  let done = 0;
  let submitted = 0;
  let overdue = 0;
  for (const c of copies) {
    if (c.status === 'expired' || c.status === 'cancelled') continue;
    total++;
    if (finished.includes(c.status)) done++;
    else if (c.status === 'submitted') submitted++;
    else if (c.status === 'overdue') overdue++;
  }
  return { total, done, submitted, overdue };
}

export interface BlockingCopy {
  serviceDate: IsoDate;
  dueAt: Date;
  status: TaskStatus;
  blocksLogout: boolean;
}

/**
 * Whether a copy stops its person logging out (brief 9.7, Phase 4 addition a).
 * Open blocking work from an earlier day always blocks (they walked out).
 * Today's blocks from `leadMinutes` before its deadline, and after it; 0
 * means only once the deadline has passed. Submitting ends it: submitted is
 * not open. A release for that date lifts it.
 */
export function blocksLogoutNow(
  c: BlockingCopy,
  today: IsoDate,
  now: Date,
  leadMinutes: number,
  releasedDates: ReadonlySet<IsoDate>,
): boolean {
  if (!c.blocksLogout || !isOpen(c.status)) return false;
  if (releasedDates.has(c.serviceDate)) return false;
  if (c.serviceDate < today) return true;
  if (c.serviceDate > today) return false;
  return now.getTime() >= c.dueAt.getTime() - leadMinutes * 60_000;
}

/** Deferring (brief 9.7): from tomorrow up to `maxDays` ahead. Working days are checked per school. */
export function deferRange(today: IsoDate, maxDays: number): { from: IsoDate; to: IsoDate } {
  return { from: addDays(today, 1), to: addDays(today, maxDays) };
}
