import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import {
  createErrorReporter,
  errorReporter,
  errorTrackingConnectSources,
  noopErrorReporter,
  scrubEvent,
  setErrorReporter,
} from '../../src/core/error-reporting.js';
import type { ErrorContext, ErrorReporter } from '../../src/core/error-reporting.js';
import { errorHandler } from '../../src/http/error-handler.js';
import { AppError } from '../../src/lib/errors.js';
import { createLogger, errSerializer } from '../../src/lib/logger.js';
import { scrubText, scrubValue } from '../../src/lib/scrub.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(40),
  OTP_PEPPER: 'b'.repeat(40),
  CORS_ORIGINS: 'https://app.example.com',
};
const logger = createLogger('silent');
const DSN = 'https://public@o1.ingest.example.com/42';

afterEach(() => {
  setErrorReporter(noopErrorReporter);
});

describe('choosing the reporter', () => {
  it('is off by default in every environment', async () => {
    for (const NODE_ENV of ['development', 'test'] as const) {
      const config = loadConfig({ ...base, NODE_ENV });
      expect(config.ERROR_TRACKING_DSN).toBeUndefined();
      expect(await createErrorReporter(config, logger)).toBe(noopErrorReporter);
    }
    // Production can't load here (no real message provider exists yet), so the
    // reporter is asked directly with a production config that has no DSN.
    const production = { NODE_ENV: 'production' as const, ERROR_TRACKING_DSN: undefined };
    expect(
      await createErrorReporter(
        { ...production, ERROR_TRACKING_ENVIRONMENT: undefined, APP_VERSION: undefined },
        logger,
      ),
    ).toBe(noopErrorReporter);
  });

  it('treats an empty DSN (as in .env.example) as not set', async () => {
    const config = loadConfig({ ...base, ERROR_TRACKING_DSN: '' });
    expect(await createErrorReporter(config, logger)).toBe(noopErrorReporter);
  });

  it('refuses a DSN that is not a URL', () => {
    expect(() => loadConfig({ ...base, ERROR_TRACKING_DSN: 'not a url' })).toThrow(
      /ERROR_TRACKING_DSN/,
    );
  });

  // Loads the Sentry SDK for real, which can take a while when the whole suite runs at once.
  it('turns tracking on only when a DSN is set', { timeout: 90_000 }, async () => {
    const config = loadConfig({ ...base, ERROR_TRACKING_DSN: DSN, APP_VERSION: 'v1.2.3' });
    const reporter = await createErrorReporter(config, logger);
    expect(reporter.enabled).toBe(true);
    // Nothing was captured, so flushing sends nothing.
    await expect(reporter.flush(100)).resolves.toBe(true);
  });

  it('is the no-op in tests: nothing installs a real reporter', () => {
    expect(process.env.ERROR_TRACKING_DSN ?? '').toBe('');
    expect(errorReporter()).toBe(noopErrorReporter);
    expect(errorReporter().enabled).toBe(false);
  });

  it('allows the browser to reach the tracker only when the web app has a DSN', () => {
    expect(errorTrackingConnectSources(loadConfig(base))).toEqual([]);
    expect(
      errorTrackingConnectSources(loadConfig({ ...base, WEB_ERROR_TRACKING_DSN: DSN })),
    ).toEqual(['https://o1.ingest.example.com']);
  });
});

describe('scrubbing', () => {
  it('removes phone numbers in every common spelling', () => {
    for (const phone of [
      '9848011201',
      '+91 98480 11201',
      '+919848011201',
      '098480-11201',
      '98480 11201',
    ]) {
      const out = scrubText(`Could not send to ${phone} today`);
      expect(out).toBe('Could not send to [phone] today');
    }
  });

  it('keeps ids, dates and small numbers readable', () => {
    const id = '01926d1c-3b8a-7123-8456-112233445566';
    const text = `task ${id} due 2026-09-27T10:00:00.000Z, 25 copies, line 123:45`;
    expect(scrubText(text)).toBe(text);
  });

  it('removes tokens, credentials, e-mail addresses and values Postgres quotes', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJl';
    const out = scrubText(
      [
        `Authorization: Bearer ${jwt}`,
        `token ${jwt}`,
        'postgresql://kidzonia:s3cret@db.example.com:5432/app',
        'mail priya@example.com',
        'Key (organisation_id, name)=(abc, Priya Sharma) already exists.',
      ].join('\n'),
    );
    expect(out).not.toContain(jwt);
    expect(out).not.toContain('s3cret');
    expect(out).not.toContain('priya@example.com');
    expect(out).not.toContain('Priya Sharma');
    expect(out).toContain('Key (organisation_id, name)=([redacted])');
    expect(out).toContain('postgresql://[redacted]@db.example.com:5432/app');
  });

  it('blanks sensitive keys at any depth, including inside errors', () => {
    const err = Object.assign(new Error('Failed for 9848011201'), {
      detail: 'mobile 98480 11201',
    });
    const out = scrubValue({
      headers: { authorization: 'Bearer abc', cookie: 'kz_refresh=xyz', accept: 'json' },
      nested: { deeper: { refreshToken: 'r', parentMobile: '9848011201', count: 3 } },
      err,
    });
    expect(out.headers).toEqual({
      authorization: '[redacted]',
      cookie: '[redacted]',
      accept: 'json',
    });
    expect(out.nested.deeper).toEqual({
      refreshToken: '[redacted]',
      parentMobile: '[redacted]',
      count: 3,
    });
    expect(JSON.stringify(out.err)).not.toMatch(/98480/);
    expect((out.err as unknown as { message: string }).message).toBe('Failed for [phone]');
  });

  it('drops request data and breadcrumbs from outgoing events, keeping only the user id', () => {
    const event = scrubEvent({
      message: 'Parent 9848011201 could not be messaged',
      request: {
        url: 'https://app.example.com/api/users?search=9848011201',
        data: { mobile: '9848011201', code: '123456' },
        headers: { Authorization: 'Bearer eyJa.eyJb.c' },
        cookies: { kz_refresh: 'secret' },
      },
      breadcrumbs: [{ message: 'GET /api/users?search=9848011201' }],
      user: { id: 'u1', ip_address: '10.0.0.1', username: 'Priya' },
      server_name: 'kidzonia-prod-1',
      tags: { requestId: 'r1' },
    });
    expect(event.request).toBeUndefined();
    expect(event.breadcrumbs).toBeUndefined();
    expect(event.server_name).toBeUndefined();
    expect(event.user).toEqual({ id: 'u1' });
    expect(event.message).toBe('Parent [phone] could not be messaged');
    expect(JSON.stringify(event)).not.toMatch(/98480|secret|eyJa/);
  });

  it('scrubs errors written to the logs', () => {
    const err = Object.assign(new Error('duplicate key'), {
      detail: 'Key (organisation_id, mobile)=(o1, 9848011201) already exists.',
    });
    expect(JSON.stringify(errSerializer(err))).not.toMatch(/9848011201/);
  });
});

describe('the HTTP error handler', () => {
  function recorder() {
    const seen: { error: unknown; context: ErrorContext | undefined }[] = [];
    const reporter: ErrorReporter = {
      enabled: true,
      capture: (error, context) => seen.push({ error, context }),
      flush: () => Promise.resolve(true),
    };
    return { seen, reporter };
  }

  function appThrowing(err: unknown) {
    const app = express();
    app.use(express.json());
    app.post('/api/things/:id', () => {
      throw err;
    });
    app.use(errorHandler(logger, false));
    return app;
  }

  it('reports unexpected errors with the route pattern, never the body or query', async () => {
    const { seen, reporter } = recorder();
    setErrorReporter(reporter);
    const res = await request(appThrowing(new Error('boom')))
      .post('/api/things/42?search=9848011201')
      .send({ mobile: '9848011201' });
    expect(res.status).toBe(500);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.context).toMatchObject({
      source: 'http',
      method: 'POST',
      status: 500,
      route: '/api/things/:id',
    });
    expect(JSON.stringify(seen[0]!.context)).not.toMatch(/98480/);
  });

  it('does not report the errors people cause (4xx)', async () => {
    const { seen, reporter } = recorder();
    setErrorReporter(reporter);
    const res = await request(appThrowing(new AppError('invalid_input', 'Bad'))).post(
      '/api/things/1',
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(seen).toHaveLength(0);
  });
});
