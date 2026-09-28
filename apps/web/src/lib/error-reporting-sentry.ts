import * as Sentry from '@sentry/browser';
import type { ErrorReporter } from './error-reporting';
import { scrubEvent } from './error-reporting';
import { scrubText, scrubValue } from './scrub';

/**
 * The Sentry adapter. Loaded with a dynamic import only when the app was built
 * with VITE_ERROR_TRACKING_DSN, so it's a separate chunk nobody else downloads.
 */
export function createSentryReporter(options: {
  dsn: string;
  environment: string;
  release?: string;
}): ErrorReporter {
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    ...(options.release ? { release: options.release } : {}),
    // No automatic integrations: they record URLs, clicks, console lines and
    // fetches as breadcrumbs, any of which can carry a phone number. Our own
    // window handlers and the route error page report explicitly.
    defaultIntegrations: false,
    integrations: [],
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
  });
  return {
    capture(error, context) {
      Sentry.withScope((scope) => {
        if (context) scope.setTags(scrubValue(context));
        Sentry.captureException(
          error instanceof Error ? error : new Error(scrubText(describe(error))),
        );
      });
    },
  };
}

function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(scrubValue(value));
  } catch {
    return 'Non-error thrown';
  }
}
