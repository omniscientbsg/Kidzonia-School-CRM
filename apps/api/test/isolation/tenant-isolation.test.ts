import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLIENT_HEADER, createTestApp, mobileOf, signIn } from '../support/app.js';
import type { Session, TestApp } from '../support/app.js';

/**
 * Tenant isolation, endpoint by endpoint. Every authenticated route must have
 * a case here; the coverage test below fails the build when a new route is
 * added without one. Each case signs in as a user of the SECOND organisation
 * and tries to read or change the DEMO organisation's data.
 */

let t: TestApp;
let outsider: Session; // Nisha, Owner of the second organisation
let insider: Session; // Ananya, Owner of the demo organisation

beforeAll(async () => {
  t = await createTestApp();
  outsider = await signIn(t, '97000 55001');
  insider = await signIn(t, mobileOf('u1'));
});
afterAll(async () => {
  await t.close();
});

type Case = (ctx: { t: TestApp; outsider: Session; insider: Session }) => Promise<void>;

/** Public routes need no isolation case: they act before any organisation is chosen. */
const PUBLIC_REASON: Record<string, string> = {
  'GET /health': 'no organisation data',
  'POST /auth/request-code': 'pre-sign-in; covered by auth tests',
  'POST /auth/verify-code': 'pre-sign-in; organisation chosen by the verified mobile',
  'POST /auth/login': 'pre-sign-in; organisation chosen by the verified mobile',
  'POST /auth/select-organisation': 'covered below as an extra case',
  'POST /auth/refresh': 'bound to the session in the cookie',
};

const CASES: Record<string, Case> = {
  'GET /me': async ({ t, outsider }) => {
    const res = await t.http.get('/api/me').set(outsider.auth).expect(200);
    expect(res.body.organisation.id).toBe(t.second.organisationId);
    const text = JSON.stringify(res.body);
    for (const id of [...Object.values(t.demo.users), ...Object.values(t.demo.schools)]) {
      expect(text).not.toContain(id);
    }
  },
  'GET /registry': async ({ t, outsider }) => {
    // The registry is the same code for everyone and holds no organisation data.
    const res = await t.http.get('/api/registry').set(outsider.auth).expect(200);
    expect(JSON.stringify(res.body)).not.toContain(t.demo.organisationId);
  },
  'POST /auth/logout': async ({ t, outsider, insider }) => {
    // Logging out one organisation's session never touches another's.
    const extra = await signIn(t, '97000 55001');
    await t.http.post('/api/auth/logout').set(CLIENT_HEADER).set(extra.auth).expect(204);
    await t.http.get('/api/me').set(insider.auth).expect(200);
    await t.http.get('/api/me').set(outsider.auth).expect(200);
  },
};

describe('tenant isolation', () => {
  const routes = () =>
    t.app.routes.routes.map((r) => ({
      key: `${r.method.toUpperCase()} ${r.path}`,
      access: r.access,
    }));

  it('has a case for every authenticated route and a reason for every public one', () => {
    const missing = routes().filter((r) =>
      r.access === 'authenticated' ? !(r.key in CASES) : !(r.key in PUBLIC_REASON),
    );
    expect(missing).toEqual([]);
  });

  it('has no stale cases for routes that no longer exist', () => {
    const keys = new Set(routes().map((r) => r.key));
    expect(Object.keys(CASES).filter((k) => !keys.has(k))).toEqual([]);
  });

  for (const [key, run] of Object.entries(CASES)) {
    it(key, async () => {
      await run({ t, outsider, insider });
    });
  }

  it('a token for one organisation never works against another’s session', async () => {
    // Forge nothing: take a real outsider token and a real insider session id.
    const insiderSession = await t.prisma.authSession.findFirstOrThrow({
      where: { userId: t.demo.users.u1!, revokedAt: null },
    });
    const { token } = await t.deps.tokens.issueAccess(
      {
        userId: t.second.users.s1 ?? '',
        organisationId: t.second.organisationId,
        sessionId: insiderSession.id,
      },
      new Date(),
    );
    await t.http.get('/api/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('a selection token can’t open an organisation the person isn’t in', async () => {
    const code = await t.http.post('/api/auth/request-code').send({ mobile: mobileOf('u8') });
    const verify = await t.http
      .post('/api/auth/verify-code')
      .send({ challengeId: code.body.challengeId, code: t.messages.sent.at(-1)?.code })
      .expect(200);
    const thirdOrg = await t.deps.data.createOrganisation({
      name: 'Third',
      setupType: 'single_school',
      schoolModel: 'coco',
    });
    await t.http
      .post('/api/auth/select-organisation')
      .send({ selectionToken: verify.body.selectionToken, organisationId: thirdOrg.id })
      .expect(401);
  });
});
