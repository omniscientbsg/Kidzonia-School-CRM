import { ERROR_STATUS } from '@kidzonia/shared';
import type { ErrorCode } from '@kidzonia/shared';

/**
 * An error meant for the person using the app. The message is shown as-is, so
 * it must be plain English and must never contain internal details.
 */
export class AppError extends Error {
  override name = 'AppError';
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
    readonly headers?: Record<string, string>,
    /** Structured data the client needs to act, e.g. the tasks blocking logout. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = ERROR_STATUS[code];
  }
}

export const invalidInput = (message: string, fields?: Record<string, string>) =>
  new AppError('invalid_input', message, fields);

export const notLoggedIn = (message = 'Please sign in again.') =>
  new AppError('not_logged_in', message);

export const notAllowed = (message = "You don't have permission to do that.") =>
  new AppError('not_allowed', message);

/** Also used for records outside the user's reach, so ids can't be probed. */
export const notFound = (what = 'That item') => new AppError('not_found', `${what} was not found.`);

export const conflict = (message: string) => new AppError('conflict', message);

export const businessRule = (message: string, fields?: Record<string, string>) =>
  new AppError('business_rule', message, fields);

export const tooManyRequests = (message: string, retryAfterSeconds: number) =>
  new AppError('too_many_requests', message, undefined, {
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
  });
