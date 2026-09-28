import { ApiError } from '../api/client';
import { scrubValue } from './scrub';

/**
 * Error tracking for the web app, behind an interface so the tracker can be
 * swapped or left off. Off unless VITE_ERROR_TRACKING_DSN was set when the app
 * was built, and never in unit tests. The tracker's SDK is loaded lazily, so
 * builds without a DSN never download it.
 */
export interface ErrorReporter {
  capture(error: unknown, context?: Record<string, string>): void;
}

export interface ErrorReportingEnv {
  MODE: string;
  VITE_ERROR_TRACKING_DSN?: string;
  VITE_ERROR_TRACKING_ENVIRONMENT?: string;
  VITE_APP_VERSION?: string;
}

const noop: ErrorReporter = { capture: () => undefined };
let reporter: ErrorReporter = noop;

/** Errors seen while the tracker's SDK is still downloading; sent once it's ready. */
const MAX_EARLY = 20;
let early: { error: unknown; context?: Record<string, string> }[] | null = null;

/**
 * API errors are the server's to report (5xx are captured there, with more
 * context); 4xx are answers, not bugs.
 */
function worthReporting(error: unknown): boolean {
  return !(error instanceof ApiError);
}

export function reportError(error: unknown, context?: Record<string, string>): void {
  if (!worthReporting(error)) return;
  // The page path holds ids at most; the query string can hold search text.
  const withPath = { path: window.location.pathname, ...context };
  if (early) {
    if (early.length < MAX_EARLY) early.push({ error, context: withPath });
    return;
  }
  reporter.capture(error, withPath);
}

export function errorReportingEnabled(env: ErrorReportingEnv): boolean {
  return Boolean(env.VITE_ERROR_TRACKING_DSN) && env.MODE !== 'test';
}

/**
 * Listens for errors nothing else caught and loads the tracker. Render errors
 * inside routes are reported by the route error page instead (React Router
 * catches those before they reach the window).
 */
export function installErrorReporting(env: ErrorReportingEnv): void {
  const dsn = env.VITE_ERROR_TRACKING_DSN;
  if (!dsn || !errorReportingEnabled(env)) return;

  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, { source: 'window' });
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { source: 'promise' });
  });

  early = [];
  import('./error-reporting-sentry')
    .then(({ createSentryReporter }) => {
      reporter = createSentryReporter({
        dsn,
        environment: env.VITE_ERROR_TRACKING_ENVIRONMENT ?? env.MODE,
        ...(env.VITE_APP_VERSION ? { release: env.VITE_APP_VERSION } : {}),
      });
    })
    .catch(() => {
      // The tracker couldn't load (blocked, offline): the app works without it.
      reporter = noop;
    })
    .finally(() => {
      const queued = early ?? [];
      early = null;
      for (const item of queued) reporter.capture(item.error, item.context);
    });
}

/** The shape of an outgoing event that we clean; the SDK's own type is wider. */
interface OutgoingEvent {
  request?: unknown;
  user?: { id?: unknown } | null;
  breadcrumbs?: unknown;
}

/**
 * Cleans an event just before it's sent: no request data (URL query, headers),
 * no breadcrumbs, only the user's id, and no tokens or phone numbers anywhere.
 */
export function scrubEvent<E extends OutgoingEvent>(event: E): E {
  const cleaned = scrubValue(event);
  delete cleaned.request;
  delete cleaned.breadcrumbs;
  if (cleaned.user) cleaned.user = cleaned.user.id ? { id: cleaned.user.id } : null;
  return cleaned;
}

/** Tests only: back to the no-op reporter. */
export function resetErrorReportingForTests(next: ErrorReporter = noop): void {
  reporter = next;
  early = null;
}
