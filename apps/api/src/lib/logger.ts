import { pino } from 'pino';
import type { Logger } from 'pino';
import { currentContext } from './context.js';

export type { Logger };

/**
 * JSON logs. Every line written during a request carries its request id,
 * organisation and user, taken from the request context.
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'kidzonia-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
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
