import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '@kidzonia/shared';
import { mapDbError } from '../db/index.js';
import { AppError, notFound } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

function isBodyParserError(err: unknown): err is { type: string; status: number } {
  return typeof err === 'object' && err !== null && 'type' in err && 'status' in err;
}

/** Unknown routes get the same JSON shape as every other error. */
export const unknownRoute: RequestHandler = () => {
  throw notFound('That page');
};

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
      if (appError.status >= 500) logger.error({ err }, 'Request failed');
      else logger.info({ code: appError.code, status: appError.status }, appError.message);
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
