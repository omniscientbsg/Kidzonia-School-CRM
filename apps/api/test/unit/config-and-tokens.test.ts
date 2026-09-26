import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { TokenService } from '../../src/core/auth/tokens.js';
import { hashOtp, safeEqualHex } from '../../src/core/auth/crypto.js';
import { assertRouteOrder } from '../../src/http/routes.js';
import type { RouteDef } from '../../src/http/routes.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(40),
  OTP_PEPPER: 'b'.repeat(40),
  CORS_ORIGINS: 'https://app.example.com',
};

describe('config', () => {
  it('reads rate limits from the environment, with defaults', () => {
    const c = loadConfig({ ...base, RL_OTP_PER_MOBILE_DAY: '4' });
    expect(c.RL_OTP_PER_MOBILE_DAY).toBe(4);
    expect(c.RL_OTP_PER_IP_DAY).toBe(50);
  });

  it('refuses short secrets', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('refuses the dev-only fixed code in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', DEV_FIXED_OTP: '123456' })).toThrow(
      /DEV_FIXED_OTP/,
    );
  });

  it('refuses the console message provider in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/message provider/);
  });
});

describe('tokens', () => {
  const now = new Date('2026-09-26T08:00:00Z');
  const claims = { userId: 'u', organisationId: 'o', sessionId: 's' };

  it('round-trips access tokens and expires them', async () => {
    const t = new TokenService('x'.repeat(40), undefined, 60);
    const { token } = await t.issueAccess(claims, now);
    expect(await t.verifyAccess(token, now)).toEqual(claims);
    expect(await t.verifyAccess(token, new Date(now.getTime() + 61_000))).toBeNull();
  });

  it('accepts tokens signed with the previous secret while rotating', async () => {
    const old = new TokenService('old'.repeat(20), undefined, 600);
    const { token } = await old.issueAccess(claims, now);
    const rotating = new TokenService('new'.repeat(20), 'old'.repeat(20), 600);
    expect(await rotating.verifyAccess(token, now)).toEqual(claims);
    const rotated = new TokenService('new'.repeat(20), undefined, 600);
    expect(await rotated.verifyAccess(token, now)).toBeNull();
  });

  it('never accepts one kind of token as another', async () => {
    const t = new TokenService('x'.repeat(40), undefined, 600);
    const selection = await t.issueSelection({ mobile: '+91', userIds: ['u'], jti: 'j' }, now);
    expect(await t.verifyAccess(selection, now)).toBeNull();
    const { token } = await t.issueAccess(claims, now);
    expect(await t.verifySelection(token, now)).toBeNull();
  });

  it('binds a code hash to its challenge', () => {
    const a = hashOtp('pepper', 'c1', '123456');
    expect(safeEqualHex(a, hashOtp('pepper', 'c1', '123456'))).toBe(true);
    expect(safeEqualHex(a, hashOtp('pepper', 'c2', '123456'))).toBe(false);
    expect(safeEqualHex(a, 'abcd')).toBe(false);
  });
});

describe('route order', () => {
  const r = (method: RouteDef['method'], path: string): RouteDef => ({
    method,
    path,
    access: 'public',
    handler: () => undefined,
  });

  it('rejects a fixed path declared after a parameter path that would swallow it', () => {
    expect(() => {
      assertRouteOrder([r('get', '/tasks/:id'), r('get', '/tasks/analytics')]);
    }).toThrow(/shadowed/);
  });

  it('allows the right order and different methods', () => {
    expect(() => {
      assertRouteOrder([
        r('get', '/tasks/analytics'),
        r('get', '/tasks/:id'),
        r('post', '/tasks/x'),
      ]);
    }).not.toThrow();
  });
});
