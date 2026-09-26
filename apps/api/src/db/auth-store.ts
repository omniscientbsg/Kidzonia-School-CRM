import type { PrismaClient } from '../generated/prisma/client.js';

/**
 * Sign-in is the one place that must look across organisations: a mobile
 * number is only unique within an organisation, and we don't know which
 * organisation someone wants until they've proved who they are. Every
 * cross-organisation query lives in this file so it can be reviewed in one go.
 */

export interface SignInCandidate {
  userId: string;
  organisationId: string;
  organisationName: string;
  logoKey: string | null;
  passwordHash: string | null;
}

export interface NewSession {
  organisationId: string;
  userId: string;
  refreshTokenHash: string;
  familyId: string;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
}

export class AuthStore {
  constructor(private readonly prisma: PrismaClient) {}

  /** People who may sign in with this number: not deleted, not deactivated. */
  async candidatesForMobile(mobile: string): Promise<SignInCandidate[]> {
    const users = await this.prisma.user.findMany({
      where: { mobile, deletedAt: null, status: { not: 'inactive' } },
      select: {
        id: true,
        organisationId: true,
        passwordHash: true,
        organisation: { select: { name: true, logoKey: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => ({
      userId: u.id,
      organisationId: u.organisationId,
      organisationName: u.organisation.name,
      logoKey: u.organisation.logoKey,
      passwordHash: u.passwordHash,
    }));
  }

  /** One person's sign-in record, if they may still sign in. Used on refresh. */
  async candidateForUser(userId: string): Promise<SignInCandidate | null> {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, status: { not: 'inactive' } },
      select: {
        id: true,
        organisationId: true,
        passwordHash: true,
        organisation: { select: { name: true, logoKey: true } },
      },
    });
    return u
      ? {
          userId: u.id,
          organisationId: u.organisationId,
          organisationName: u.organisation.name,
          logoKey: u.organisation.logoKey,
          passwordHash: u.passwordHash,
        }
      : null;
  }

  async createChallenge(input: {
    id: string;
    mobile: string;
    codeHash: string;
    expiresAt: Date;
    ip: string | null;
  }): Promise<{ id: string }> {
    return this.prisma.otpChallenge.create({ data: input, select: { id: true } });
  }

  async findOpenChallenge(id: string, now: Date) {
    return this.prisma.otpChallenge.findFirst({
      where: { id, consumedAt: null, expiresAt: { gt: now } },
    });
  }

  /**
   * Counts one attempt, atomically. Returns false once attempts are used up, so
   * parallel guesses can't exceed the limit.
   */
  async useAttempt(id: string, maxAttempts: number): Promise<boolean> {
    const res = await this.prisma.otpChallenge.updateMany({
      where: { id, consumedAt: null, attempts: { lt: maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    return res.count === 1;
  }

  /** Marks a challenge used. False if another request consumed it first. */
  async consumeChallenge(id: string, now: Date): Promise<boolean> {
    const res = await this.prisma.otpChallenge.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: now },
    });
    return res.count === 1;
  }

  /**
   * Starts a signed-in session and records the sign-in, in one transaction.
   * First sign-in also turns an invited person into an active one.
   */
  async startSession(input: NewSession, now: Date): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.authSession.create({ data: input, select: { id: true } });
      await tx.user.update({ where: { id: input.userId }, data: { lastLoginAt: now } });
      await tx.user.updateMany({
        where: { id: input.userId, status: 'invited' },
        data: { status: 'active' },
      });
      return session;
    });
  }

  /**
   * Replaces a session during refresh, atomically. Returns null if a parallel
   * refresh already retired it, so only one of two racing requests wins.
   */
  async rotateSession(oldId: string, input: NewSession, now: Date): Promise<{ id: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      const retired = await tx.authSession.updateMany({
        where: { id: oldId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'rotated', lastUsedAt: now },
      });
      if (retired.count !== 1) return null;
      return tx.authSession.create({ data: input, select: { id: true } });
    });
  }

  async findSessionByRefreshHash(refreshTokenHash: string) {
    return this.prisma.authSession.findUnique({ where: { refreshTokenHash } });
  }

  async revokeFamily(familyId: string, reason: string, now: Date): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
  }

  async revokeSession(id: string, reason: string, now: Date): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
  }

  /** The session behind an access token, if it is still live and its user may sign in. */
  async liveSession(id: string, now: Date) {
    return this.prisma.authSession.findFirst({
      where: {
        id,
        revokedAt: null,
        expiresAt: { gt: now },
        user: { deletedAt: null, status: { not: 'inactive' } },
      },
      select: { id: true, organisationId: true, userId: true, familyId: true },
    });
  }

  /** Housekeeping for the cleanup job. Returns how many rows each step removed. */
  async deleteExpired(now: Date) {
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const challenges = await this.prisma.otpChallenge.deleteMany({
      where: { expiresAt: { lt: dayAgo } },
    });
    const sessions = await this.prisma.authSession.deleteMany({
      where: { OR: [{ expiresAt: { lt: weekAgo } }, { revokedAt: { lt: weekAgo } }] },
    });
    const rateLimits = await this.prisma.rateLimit.deleteMany({
      where: { expire: { lt: BigInt(now.getTime()) } },
    });
    return { challenges: challenges.count, sessions: sessions.count, rateLimits: rateLimits.count };
  }
}
