import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD } from '../../src/seed/demo.js';
import {
  CLIENT_HEADER,
  createTestApp,
  mobileOf,
  refreshCookieFrom,
  signIn,
} from '../support/app.js';
import type { TestApp } from '../support/app.js';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({
    RL_OTP_PER_MOBILE_10MIN: '3',
    RL_OTP_PER_IP_10MIN: '1000',
    RL_OTP_PER_MOBILE_DAY: '5',
    RL_OTP_PER_IP_DAY: '1000',
    RL_LOGIN_PER_MOBILE_15MIN: '4',
    RL_LOGIN_PER_IP_15MIN: '1000',
  });
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  // Each test starts with fresh rate-limit counters and the real clock.
  await t.prisma.rateLimit.deleteMany();
  t.clock.now = new Date();
  t.messages.sent.length = 0;
});

const requestCode = (mobile: string) => t.http.post('/api/auth/request-code').send({ mobile });

describe('POST /auth/request-code', () => {
  it('creates a challenge and texts the code to a known number', async () => {
    const res = await requestCode(mobileOf('u5')).expect(201);
    expect(res.body).toMatchObject({ expiresIn: 300, resendIn: 30 });
    expect(res.body.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.messages.sent).toEqual([
      { mobile: '+919848033105', code: expect.stringMatching(/^\d{6}$/) },
    ]);
  });

  it('answers the same for unknown numbers but sends nothing', async () => {
    const res = await requestCode('90000 00000').expect(201);
    expect(Object.keys(res.body)).toEqual(['challengeId', 'expiresIn', 'resendIn']);
    expect(t.messages.sent).toEqual([]);
  });

  it('rejects an invalid mobile with a field message', async () => {
    const res = await requestCode('12345').expect(400);
    expect(res.body.error).toMatchObject({
      code: 'invalid_input',
      fields: { mobile: 'Enter a valid mobile number' },
    });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('limits codes per mobile per 10 minutes, with Retry-After', async () => {
    const m = mobileOf('u9');
    for (let i = 0; i < 3; i++) await requestCode(m).expect(201);
    const res = await requestCode(m).expect(429);
    expect(res.body.error.code).toBe('too_many_requests');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('also caps codes per mobile per day, from config', async () => {
    const m = mobileOf('u10');
    for (let i = 0; i < 3; i++) await requestCode(m).expect(201);
    // Clear only the short window: the daily cap (5) must still bite.
    await t.prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'otp_m10' } } });
    await requestCode(m).expect(201);
    await requestCode(m).expect(201);
    await t.prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'otp_m10' } } });
    const res = await requestCode(m).expect(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(60 * 60);
  });
});

describe('POST /auth/verify-code', () => {
  it('signs in a person in one organisation and sets the refresh cookie', async () => {
    const code = await requestCode(mobileOf('u5')).expect(201);
    const sent = t.messages.sent[0]?.code;
    const res = await t.http
      .post('/api/auth/verify-code')
      .send({ challengeId: code.body.challengeId, code: sent })
      .expect(200);
    expect(res.body.status).toBe('signed_in');
    expect(res.body.accessToken).toBeTruthy();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/kz_refresh=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(res.body).not.toHaveProperty('refreshToken');
  });

  it('rejects a wrong code, then locks the challenge after too many tries', async () => {
    const code = await requestCode(mobileOf('u5')).expect(201);
    const sent = t.messages.sent[0]?.code ?? '';
    const wrong = sent === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const res = await t.http
        .post('/api/auth/verify-code')
        .send({ challengeId: code.body.challengeId, code: wrong })
        .expect(400);
      expect(res.body.error.message).toMatch(/wrong or has expired/);
    }
    const locked = await t.http
      .post('/api/auth/verify-code')
      .send({ challengeId: code.body.challengeId, code: sent })
      .expect(400);
    expect(locked.body.error.message).toMatch(/Too many wrong codes/);
  });

  it('rejects an expired code', async () => {
    const code = await requestCode(mobileOf('u5')).expect(201);
    t.clock.now = new Date(Date.now() + 301_000);
    await t.http
      .post('/api/auth/verify-code')
      .send({ challengeId: code.body.challengeId, code: t.messages.sent[0]?.code })
      .expect(400);
  });

  it('accepts each code only once', async () => {
    const code = await requestCode(mobileOf('u5')).expect(201);
    const body = { challengeId: code.body.challengeId, code: t.messages.sent[0]?.code };
    await t.http.post('/api/auth/verify-code').send(body).expect(200);
    await t.http.post('/api/auth/verify-code').send(body).expect(400);
  });

  it('validates the input shape', async () => {
    const res = await t.http
      .post('/api/auth/verify-code')
      .send({ challengeId: 'nope', code: '12' })
      .expect(400);
    expect(Object.keys(res.body.error.fields)).toEqual(['challengeId', 'code']);
  });

  it('asks which organisation to open when the number is in two', async () => {
    const code = await requestCode(mobileOf('u8')).expect(201);
    const res = await t.http
      .post('/api/auth/verify-code')
      .send({ challengeId: code.body.challengeId, code: t.messages.sent[0]?.code })
      .expect(200);
    expect(res.body.status).toBe('choose_organisation');
    expect(res.body.organisations.map((o: { name: string }) => o.name).sort()).toEqual([
      'Kidzonia Pre-schools',
      'Sunrise Kids Academy',
    ]);
    expect(res.headers['set-cookie']).toBeUndefined();

    const chosen = await t.http
      .post('/api/auth/select-organisation')
      .send({ selectionToken: res.body.selectionToken, organisationId: t.second.organisationId })
      .expect(200);
    expect(chosen.body.status).toBe('signed_in');
    const me = await t.http
      .get('/api/me')
      .set('Authorization', `Bearer ${chosen.body.accessToken}`)
      .expect(200);
    expect(me.body.organisation.name).toBe('Sunrise Kids Academy');
    expect(me.body.user.id).toBe(t.second.users.s2);
  });

  it('refuses an organisation the selection token does not cover', async () => {
    const code = await requestCode(mobileOf('u8')).expect(201);
    const res = await t.http
      .post('/api/auth/verify-code')
      .send({ challengeId: code.body.challengeId, code: t.messages.sent[0]?.code })
      .expect(200);
    await t.http
      .post('/api/auth/select-organisation')
      .send({
        selectionToken: res.body.selectionToken,
        organisationId: '0190a8f4-1b2c-7d3e-8f40-123456789abc',
      })
      .expect(401);
    await t.http
      .post('/api/auth/select-organisation')
      .send({ selectionToken: 'forged', organisationId: t.demo.organisationId })
      .expect(401);
  });
});

describe('POST /auth/login (password)', () => {
  it('signs in with the right password', async () => {
    const res = await t.http
      .post('/api/auth/login')
      .send({ mobile: mobileOf('u1'), password: DEMO_PASSWORD })
      .expect(200);
    expect(res.body.status).toBe('signed_in');
  });

  it('gives the same answer for a wrong password and an unknown number', async () => {
    const a = await t.http
      .post('/api/auth/login')
      .send({ mobile: mobileOf('u1'), password: 'wrong' })
      .expect(401);
    const b = await t.http
      .post('/api/auth/login')
      .send({ mobile: '90000 00001', password: 'wrong' })
      .expect(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('refuses people without a password', async () => {
    await t.http
      .post('/api/auth/login')
      .send({ mobile: mobileOf('u5'), password: 'x' })
      .expect(401);
  });

  it('limits attempts per mobile', async () => {
    for (let i = 0; i < 4; i++) {
      await t.http
        .post('/api/auth/login')
        .send({ mobile: mobileOf('u1'), password: 'no' })
        .expect(401);
    }
    await t.http
      .post('/api/auth/login')
      .send({ mobile: mobileOf('u1'), password: DEMO_PASSWORD })
      .expect(429);
  });
});

describe('POST /auth/refresh', () => {
  it('needs the app header (CSRF protection)', async () => {
    const s = await signIn(t, mobileOf('u5'));
    await t.http.post('/api/auth/refresh').set('Cookie', s.refreshCookie).expect(403);
  });

  it('rotates: a new pair each time, and the old access token’s session ends', async () => {
    const s = await signIn(t, mobileOf('u5'));
    const res = await t.http
      .post('/api/auth/refresh')
      .set(CLIENT_HEADER)
      .set('Cookie', s.refreshCookie)
      .expect(200);
    const next = refreshCookieFrom(res);
    expect(next).not.toBe(s.refreshCookie);
    await t.http.get('/api/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    await t.http.get('/api/me').set(s.auth).expect(401);
  });

  it('treats a late reuse of an old token as theft and signs the device out', async () => {
    const s = await signIn(t, mobileOf('u5'));
    const res = await t.http
      .post('/api/auth/refresh')
      .set(CLIENT_HEADER)
      .set('Cookie', s.refreshCookie)
      .expect(200);
    t.clock.now = new Date(Date.now() + 60_000);
    await t.http
      .post('/api/auth/refresh')
      .set(CLIENT_HEADER)
      .set('Cookie', s.refreshCookie)
      .expect(401);
    // The legitimate newer token is revoked too.
    await t.http
      .post('/api/auth/refresh')
      .set(CLIENT_HEADER)
      .set('Cookie', refreshCookieFrom(res))
      .expect(401);
  });

  it('tolerates two tabs refreshing at the same moment', async () => {
    const s = await signIn(t, mobileOf('u5'));
    const first = await t.http
      .post('/api/auth/refresh')
      .set(CLIENT_HEADER)
      .set('Cookie', s.refreshCookie)
      .expect(200);
    await t.http
      .post('/api/auth/refresh')
      .set(CLIENT_HEADER)
      .set('Cookie', s.refreshCookie)
      .expect(401);
    await t.http
      .post('/api/auth/refresh')
      .set(CLIENT_HEADER)
      .set('Cookie', refreshCookieFrom(first))
      .expect(200);
  });

  it('401 without a cookie', async () => {
    await t.http.post('/api/auth/refresh').set(CLIENT_HEADER).expect(401);
  });
});

describe('POST /auth/logout', () => {
  it('ends the session immediately and clears the cookie', async () => {
    const s = await signIn(t, mobileOf('u5'));
    const res = await t.http.post('/api/auth/logout').set(CLIENT_HEADER).set(s.auth).expect(204);
    expect(String(res.headers['set-cookie'])).toMatch(/kz_refresh=;/);
    await t.http.get('/api/me').set(s.auth).expect(401);
    await t.http
      .post('/api/auth/refresh')
      .set(CLIENT_HEADER)
      .set('Cookie', s.refreshCookie)
      .expect(401);
  });

  it('is refused with 409 and the list while a logout guard objects', async () => {
    const s = await signIn(t, mobileOf('u5'));
    t.deps.hooks.logoutGuards.push(() =>
      Promise.resolve([{ title: 'Classroom safety check', path: '/tasks/t3' }]),
    );
    try {
      const res = await t.http.post('/api/auth/logout').set(CLIENT_HEADER).set(s.auth).expect(409);
      expect(res.body.error.code).toBe('logout_blocked');
      expect(res.body.error.details.blocks).toEqual([
        { title: 'Classroom safety check', path: '/tasks/t3' },
      ]);
      await t.http.get('/api/me').set(s.auth).expect(200);
    } finally {
      t.deps.hooks.logoutGuards.length = 0;
    }
  });

  it('needs a signed-in user', async () => {
    await t.http.post('/api/auth/logout').set(CLIENT_HEADER).expect(401);
  });
});

describe('deactivated people', () => {
  it('lose access at once and cannot sign in again', async () => {
    const s = await signIn(t, mobileOf('u13'));
    await t.prisma.user.update({ where: { id: t.demo.users.u13! }, data: { status: 'inactive' } });
    try {
      await t.http.get('/api/me').set(s.auth).expect(401);
      t.messages.sent.length = 0;
      const code = await requestCode(mobileOf('u13')).expect(201);
      expect(t.messages.sent.some((m) => m.mobile === '+919848044113')).toBe(false);
      await t.http
        .post('/api/auth/verify-code')
        .send({ challengeId: code.body.challengeId, code: '123456' })
        .expect(400);
    } finally {
      await t.prisma.user.update({ where: { id: t.demo.users.u13! }, data: { status: 'active' } });
    }
  });
});
