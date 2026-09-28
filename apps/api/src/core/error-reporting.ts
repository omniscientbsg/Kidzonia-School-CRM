import type { Config } from '../config.js';
import type { Logger } from '../lib/logger.js';
import { REDACTED, scrubText, scrubValue } from '../lib/scrub.js';

/**
 * Where unexpected errors are sent so someone hears about them: 5xx responses,
 * failed background jobs and crashes. Behind an interface so the tracker can be
 * swapped (or left off) without touching the code that reports.
 *
 * Nothing personal leaves through here: request bodies, headers, cookies and
 * query strings are never attached, and everything that is sent goes through
 * `scrubValue` (tokens, phone numbers, email addresses).
 */
export interface ErrorReporter {
  /** False for the no-op reporter; lets callers skip building context. */
  readonly enabled: boolean;
  capture(error: unknown, context?: ErrorContext): void;
  /** Waits (up to `timeoutMs`) for queued reports to be sent; call before exiting. */
  flush(timeoutMs?: number): Promise<boolean>;
}

/** Ids and names only. Never put request bodies, phone numbers or names here. */
export interface ErrorContext {
  source: 'http' | 'job' | 'job-queue' | 'process' | 'startup';
  requestId?: string;
  organisationId?: string;
  userId?: string;
  /** The route pattern (`/api/tasks/:id`), never the raw URL with its query string. */
  route?: string;
  method?: string;
  status?: number;
  job?: string;
  jobId?: string;
}

export const noopErrorReporter: ErrorReporter = {
  enabled: false,
  capture: () => undefined,
  flush: () => Promise.resolve(true),
};

let current: ErrorReporter = noopErrorReporter;

/**
 * The reporter for this process. A module-level value rather than an AppDeps
 * field so the error handler, the job runner and process handlers all reach it
 * without every test having to build one; it stays the no-op unless the server
 * installs a real one at start-up.
 */
export function errorReporter(): ErrorReporter {
  return current;
}

export function setErrorReporter(reporter: ErrorReporter): void {
  current = reporter;
}

/**
 * Origins the browser may send error reports to, for the CSP's connect-src.
 * Empty when the web app has no DSN, so the policy stays 'self' only.
 */
export function errorTrackingConnectSources(
  config: Pick<Config, 'WEB_ERROR_TRACKING_DSN'>,
): string[] {
  return config.WEB_ERROR_TRACKING_DSN ? [new URL(config.WEB_ERROR_TRACKING_DSN).origin] : [];
}

/**
 * Builds the reporter the config asks for. The Sentry SDK is imported only
 * when tracking is on, so development, tests and a production without a DSN
 * never load it.
 */
export async function createErrorReporter(
  config: Pick<
    Config,
    'ERROR_TRACKING_DSN' | 'ERROR_TRACKING_ENVIRONMENT' | 'NODE_ENV' | 'APP_VERSION'
  >,
  logger: Logger,
): Promise<ErrorReporter> {
  const dsn = config.ERROR_TRACKING_DSN;
  if (!dsn) return noopErrorReporter;
  const reporter = await createSentryReporter({
    dsn,
    environment: config.ERROR_TRACKING_ENVIRONMENT ?? config.NODE_ENV,
    ...(config.APP_VERSION ? { release: config.APP_VERSION } : {}),
  });
  logger.info(
    { environment: config.ERROR_TRACKING_ENVIRONMENT ?? config.NODE_ENV },
    'Error tracking on',
  );
  return reporter;
}

/** The shape of an outgoing Sentry event that we clean; the SDK's own type is wider. */
interface OutgoingEvent {
  request?: unknown;
  user?: { id?: unknown } | null;
  breadcrumbs?: unknown;
  server_name?: string;
}

/**
 * Cleans an event just before it is sent. Exported so the tests can prove it
 * without a network. The SDK is set up to attach none of these, so this is
 * the second line of defence.
 */
export function scrubEvent<E extends OutgoingEvent>(event: E): E {
  const cleaned = scrubValue(event);
  // Request data (body, cookies, headers, query) is never needed to fix a bug.
  delete cleaned.request;
  delete cleaned.breadcrumbs;
  // The host name can identify the customer's server; not needed either.
  delete cleaned.server_name;
  if (cleaned.user) cleaned.user = cleaned.user.id ? { id: cleaned.user.id } : null;
  return cleaned;
}

async function createSentryReporter(options: {
  dsn: string;
  environment: string;
  release?: string;
}): Promise<ErrorReporter> {
  const Sentry = await import('@sentry/node');
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    ...(options.release ? { release: options.release } : {}),
    // No automatic instrumentation: it would record HTTP URLs, console lines
    // and database queries as breadcrumbs, any of which can carry a phone
    // number. Errors are reported explicitly through `capture`.
    defaultIntegrations: false,
    integrations: [],
    // Never collect user details, cookies, headers, bodies or query strings.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    maxBreadcrumbs: 0,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: () => null,
  });
  return {
    enabled: true,
    capture(error, context) {
      Sentry.withScope((scope) => {
        if (context) {
          const safe = scrubValue(context);
          const tags: Record<string, string> = {};
          for (const [k, v] of Object.entries(safe)) {
            if (v !== undefined && v !== REDACTED) tags[k] = String(v);
          }
          scope.setTags(tags);
          if (safe.userId) scope.setUser({ id: safe.userId });
        }
        Sentry.captureException(error instanceof Error ? error : new Error(describe(error)));
      });
    },
    flush: (timeoutMs = 2000) => Sentry.flush(timeoutMs),
  };
}

/** Thrown non-errors (strings, objects) still get a readable, scrubbed title. */
function describe(value: unknown): string {
  if (typeof value === 'string') return scrubText(value);
  try {
    return scrubText(JSON.stringify(scrubValue(value)));
  } catch {
    return 'Non-error thrown';
  }
}
