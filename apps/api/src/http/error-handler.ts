import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import type { ApiErrorBody } from '@kidzonia/shared';
import { errorReporter } from '../core/error-reporting.js';
import { mapDbError } from '../db/index.js';
import { currentContext } from '../lib/context.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

function isBodyParserError(err: unknown): err is { type: string; status: number } {
  return typeof err === 'object' && err !== null && 'type' in err && 'status' in err;
}

/** Unknown routes get the same JSON shape as every other error. */
export const unknownRoute: RequestHandler = () => {
  throw notFound('That page');
};

/** Sends a server error to error tracking with ids only; never the body or query string. */
function report(err: unknown, req: Request, status: number): void {
  const reporter = errorReporter();
  if (!reporter.enabled) return;
  // The matched route pattern (`/api/tasks/:id`), so no id or search text is sent.
  const route = req.route ? `${req.baseUrl}${String((req.route as { path: unknown }).path)}` : '';
  const ctx = currentContext();
  reporter.capture(err, {
    source: 'http',
    requestId: req.requestId,
    ...(ctx?.organisationId ? { organisationId: ctx.organisationId } : {}),
    ...(ctx?.userId ? { userId: ctx.userId } : {}),
    method: req.method,
    status,
    ...(route ? { route } : {}),
  });
}

/**
 * The one place errors become responses. People get a clear message and the
 * request id; stack traces and internal messages only ever reach the logs.
 */
export function errorHandler(logger: Logger, exposeInternals: boolean): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    let appError: AppError | null = err instanceof AppError ? err : mapDbError(err);
    if (!appError && isBodyParserError(err)) {
      appError =
        err.type === 'entity.too.large'
          ? new AppError('invalid_input', 'That request is too large.')
          : new AppError('invalid_input', 'The request body is not valid JSON.');
    }

    if (appError) {
      if (appError.status >= 500) {
        logger.error({ err }, 'Request failed');
        report(err, req, appError.status);
      } else logger.info({ code: appError.code, status: appError.status }, appError.message);
      for (const [k, v] of Object.entries(appError.headers ?? {})) res.setHeader(k, v);
      const body: ApiErrorBody = {
        error: {
          code: appError.code,
          message: appError.message,
          ...(appError.fields ? { fields: appError.fields } : {}),
          ...(appError.details ? { details: appError.details } : {}),
          requestId: req.requestId,
        },
      };
      res.status(appError.status).json(body);
      return;
    }

    logger.error({ err }, 'Unhandled error');
    report(err, req, 500);
    const body: ApiErrorBody & { debug?: string } = {
      error: {
        code: 'internal',
        message: 'Something went wrong. Please try again.',
        requestId: req.requestId,
      },
    };
    if (exposeInternals && err instanceof Error) body.debug = err.stack ?? err.message;
    res.status(500).json(body);
  };
}
