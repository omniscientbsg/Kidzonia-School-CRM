import type { ScopedTx, UnitOfWork } from '../db/index.js';

/**
 * Extension points that let apps add rules to Core without Core importing
 * them. Tasks registers its logout-block guard here in Phase 4.
 */

export interface GuardSubject {
  organisationId: string;
  userId: string;
  now: Date;
}

export interface LogoutBlock {
  /** Shown on the logout screen, e.g. "Classroom safety check". */
  title: string;
  /** Client path to open the blocking item. */
  path: string;
}

/** Returns what stops this person logging out; an empty list lets them go. */
export type LogoutGuard = (subject: GuardSubject) => Promise<LogoutBlock[]>;

/**
 * Called before any write outside the allowed areas. Returning a message
 * refuses the write (brief 9.7: walking out with blocking work still open).
 */
export type WriteGuard = (subject: GuardSubject) => Promise<string | null>;

/**
 * Runs inside the transaction that deactivates or deletes someone, after
 * their status has changed (e.g. Tasks moves work waiting for their approval).
 */
export type UserLeavingHook = (uow: UnitOfWork, userId: string, now: Date) => Promise<void>;

export interface Hooks {
  logoutGuards: LogoutGuard[];
  writeGuards: WriteGuard[];
  userLeaving: UserLeavingHook[];
  /** Runs in the transaction that takes someone's role away. */
  roleRemoved: UserLeavingHook[];
  /** Counts what a new holiday would fall on, for the warning (Phase 4 answer 1). */
  holidayImpact: HolidayImpactHook[];
}

export type HolidayImpactHook = (
  db: ScopedTx,
  range: { start: string; end: string; schoolIds: readonly string[] },
) => Promise<{ oneTimeTasks: number; copies: number; titles: string[] }>;

export const createHooks = (): Hooks => ({
  logoutGuards: [],
  writeGuards: [],
  userLeaving: [],
  roleRemoved: [],
  holidayImpact: [],
});

/**
 * Asks the task schedule to look at one organisation soon (e.g. after a
 * holiday or working hours change), instead of waiting up to 15 minutes.
 * The 15-minute run catches everything anyway; this only makes it quicker.
 */
export interface ScheduleRequests {
  request(organisationId: string): void;
}
