import { pino, stdSerializers } from 'pino';
import type { Logger } from 'pino';
import { currentContext } from './context.js';
import { scrubValue } from './scrub.js';

export type { Logger };

/**
 * Logged errors pass through the scrubber: database errors quote the values
 * that broke a constraint (a parent's mobile, say), and those must never reach
 * the log service.
 */
export const errSerializer = (err: Error): unknown => scrubValue(stdSerializers.err(err));

/**
 * JSON logs. Every line written during a request carries its request id,
 * organisation and user, taken from the request context.
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'kidzonia-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: errSerializer },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.code',
        '*.refreshToken',
        '*.accessToken',
      ],
      censor: '[redacted]',
    },
    mixin() {
      const ctx = currentContext();
      return ctx
        ? { requestId: ctx.requestId, organisationId: ctx.organisationId, userId: ctx.userId }
        : {};
    },
  });
}
