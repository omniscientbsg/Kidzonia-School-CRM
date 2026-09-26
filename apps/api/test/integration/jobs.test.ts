import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authCleanupJob } from '../../src/jobs/index.js';
import { createTestApp, mobileOf, signIn } from '../support/app.js';
import type { TestApp } from '../support/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('auth cleanup job', () => {
  it('removes only expired data and is safe to run twice', async () => {
    await signIn(t, mobileOf('u5'));
    const live = await t.prisma.authSession.count();
    await t.prisma.otpChallenge.create({
      data: {
        id: '0190a8f4-1b2c-7d3e-8f40-123456789abc',
        mobile: '+919848033105',
        codeHash: 'x',
        expiresAt: new Date('2020-01-01T00:00:00Z'),
      },
    });
    await t.prisma.rateLimit.create({ data: { key: 'old', points: 1, expire: BigInt(1000) } });

    const job = authCleanupJob(t.deps.data);
    const first = await job.run(new Date());
    expect(first).toMatchObject({ challenges: 1, rateLimits: 1, sessions: 0 });
    const second = await job.run(new Date());
    expect(second).toEqual({ challenges: 0, sessions: 0, rateLimits: 0, tokens: 0 });
    expect(await t.prisma.authSession.count()).toBe(live);
  });

  it('removes sessions a week after they expire', async () => {
    const job = authCleanupJob(t.deps.data);
    const later = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
    const res = await job.run(later);
    expect(res.sessions).toBeGreaterThan(0);
    expect(await t.prisma.authSession.count()).toBe(0);
  });
});
