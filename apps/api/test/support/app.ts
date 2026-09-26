import pg from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { Config } from '../../src/config.js';
import { RateLimits } from '../../src/core/auth/rate-limits.js';
import { TokenService } from '../../src/core/auth/tokens.js';
import { createHooks } from '../../src/core/hooks.js';
import { MemoryMessageProvider } from '../../src/core/messaging.js';
import { LocalFileStorage } from '../../src/core/storage.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPrisma } from '../../src/db/client.js';
import type { PrismaClient } from '../../src/db/client.js';
import { createDataAccess } from '../../src/db/index.js';
import { resetDatabase } from '../../src/db/maintenance.js';
import type { AppDeps } from '../../src/deps.js';
import { DEMO_PEOPLE, seedDemo } from '../../src/seed/demo.js';
import type { SeededOrg } from '../../src/seed/demo.js';
import { CSRF_HEADER, REFRESH_COOKIE } from '../../src/core/auth/routes.js';

export interface TestApp {
  deps: AppDeps;
  prisma: PrismaClient;
  messages: MemoryMessageProvider;
  http: ReturnType<typeof request>;
  app: ReturnType<typeof createApp>;
  demo: SeededOrg;
  second: SeededOrg;
  /** Moves the app's clock; everything time-based reads deps.now(). */
  clock: { now: Date };
  close(): Promise<void>;
}

export function workerDatabaseUrl(): string {
  const url = process.env.KZ_WORKER_DB;
  if (!url) throw new Error('Worker database not prepared');
  return url;
}

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: workerDatabaseUrl(),
    JWT_SECRET: 'test-jwt-secret-0123456789abcdef0123456789',
    OTP_PEPPER: 'test-otp-pepper-0123456789abcdef0123456789',
    CORS_ORIGINS: 'http://localhost:5173',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

/** A real app on the worker's own database, freshly emptied and seeded. */
export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const config = testConfig(overrides);
  const prisma = createPrisma(config.DATABASE_URL, 5);
  await resetDatabase(prisma, config.DATABASE_URL);
  const data = createDataAccess(prisma);
  const { demo, second } = await seedDemo(data);
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
  const messages = new MemoryMessageProvider();
  const clock = { now: new Date() };
  const deps: AppDeps = {
    config,
    logger: pino({ level: 'silent' }),
    data,
    tokens: new TokenService(
      config.JWT_SECRET,
      config.JWT_SECRET_PREVIOUS,
      config.ACCESS_TOKEN_TTL_MINUTES * 60,
    ),
    rateLimits: new RateLimits(pool, config),
    messages,
    storage: new LocalFileStorage(mkdtempSync(path.join(tmpdir(), 'kz-files-'))),
    hooks: createHooks(),
    now: () => clock.now,
  };
  const app = createApp(deps);
  return {
    deps,
    prisma,
    messages,
    http: request(app.app),
    app,
    demo,
    second,
    clock,
    async close() {
      await prisma.$disconnect();
      await pool.end();
    },
  };
}

export const mobileOf = (key: string): string => {
  const p = DEMO_PEOPLE.find((x) => x.key === key);
  if (!p) throw new Error(`No demo person ${key}`);
  return p.mobile;
};

export interface Session {
  accessToken: string;
  refreshCookie: string;
  auth: { Authorization: string };
}

export function refreshCookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? (raw as string[]) : [];
  const c = cookies.find((x) => x.startsWith(`${REFRESH_COOKIE}=`));
  if (!c) throw new Error('No refresh cookie set');
  return c.split(';')[0] ?? '';
}

export const CLIENT_HEADER = { [CSRF_HEADER]: 'web' };

/**
 * Signs in through the real code flow. If the number belongs to several
 * organisations, picks `organisationId` (or the first offered).
 */
export async function signIn(
  t: TestApp,
  mobile: string,
  organisationId?: string,
): Promise<Session> {
  const code = await t.http.post('/api/auth/request-code').send({ mobile }).expect(201);
  const challengeId = (code.body as { challengeId: string }).challengeId;
  const sent = t.messages.sent.at(-1)?.code;
  if (!sent) throw new Error('No code was sent');
  let res = await t.http
    .post('/api/auth/verify-code')
    .send({ challengeId, code: sent })
    .expect(200);
  let body = res.body as {
    status: string;
    accessToken?: string;
    selectionToken?: string;
    organisations?: { id: string }[];
  };
  if (body.status === 'choose_organisation') {
    res = await t.http
      .post('/api/auth/select-organisation')
      .send({
        selectionToken: body.selectionToken,
        organisationId: organisationId ?? body.organisations?.[0]?.id,
      })
      .expect(200);
    body = res.body as typeof body;
  }
  if (!body.accessToken) throw new Error(`Sign-in failed: ${JSON.stringify(body)}`);
  return {
    accessToken: body.accessToken,
    refreshCookie: refreshCookieFrom(res),
    auth: { Authorization: `Bearer ${body.accessToken}` },
  };
}

export const SECOND_OWNER_MOBILE = '97000 55001';

/** Requests as one signed-in person, with the app header set. */
export function as(t: TestApp, s: Session, extra: Record<string, string> = {}) {
  const h = { ...s.auth, ...CLIENT_HEADER, ...extra };
  return {
    get: (url: string) => t.http.get(`/api${url}`).set(h),
    post: (url: string, body: object = {}) => t.http.post(`/api${url}`).set(h).send(body),
    /** A raw body (file upload) with the given content type. */
    postRaw: (url: string, body: Buffer, contentType: string) =>
      t.http.post(`/api${url}`).set(h).set('Content-Type', contentType).send(body),
    put: (url: string, body: object = {}) => t.http.put(`/api${url}`).set(h).send(body),
    delete: (url: string) => t.http.delete(`/api${url}`).set(h),
  };
}

/** Signs in each named demo person once and caches the session for the file. */
export function people(t: () => TestApp) {
  const cache = new Map<string, Session>();
  return async (key: string) => {
    const hit = cache.get(key);
    if (hit) return as(t(), hit);
    const mobile = key === 's1' ? SECOND_OWNER_MOBILE : mobileOf(key);
    const orgId = key.startsWith('s') ? t().second.organisationId : t().demo.organisationId;
    const s = await signIn(t(), mobile, orgId);
    cache.set(key, s);
    return as(t(), s);
  };
}
