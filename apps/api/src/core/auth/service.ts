import { uuidv7 } from 'uuidv7';
import type { RefreshResult, RequestCodeResponse, SignInResult } from '@kidzonia/shared';
import type { AppDeps } from '../../deps.js';
import type { NewSession, SignInCandidate } from '../../db/auth-store.js';
import { AppError, notLoggedIn } from '../../lib/errors.js';
import type { LogoutBlock } from '../hooks.js';
import { hashOtp, randomOtp, randomToken, safeEqualHex, sha256 } from './crypto.js';
import { verifyPassword } from './passwords.js';

export interface ClientInfo {
  ip: string;
  userAgent: string | null;
}

export interface SignedIn {
  result: SignInResult;
  /** Set as an httpOnly cookie; never put in a response body. */
  refreshToken?: string;
  refreshExpiresAt?: Date;
}

/** Codes older than this after rotation are real reuse, not two tabs racing. */
const ROTATION_GRACE_MS = 10_000;

const WRONG_CODE = 'That code is wrong or has expired. Request a new one.';

export class AuthService {
  constructor(private readonly deps: AppDeps) {}

  private get store() {
    return this.deps.data.auth;
  }

  async requestCode(mobile: string, client: ClientInfo): Promise<RequestCodeResponse> {
    const { config, now: clock } = this.deps;
    await this.deps.rateLimits.consumeOtpRequest(client.ip, mobile);
    const now = clock();
    const id = uuidv7();
    const code = config.DEV_FIXED_OTP ?? randomOtp();
    await this.store.createChallenge({
      id,
      mobile,
      codeHash: hashOtp(config.OTP_PEPPER, id, code),
      expiresAt: new Date(now.getTime() + config.OTP_TTL_SECONDS * 1000),
      ip: client.ip,
    });
    // Only text numbers that belong to someone: unknown numbers get the same
    // response (so accounts can't be discovered) but no SMS (so nobody can run
    // up our SMS bill by requesting codes for random numbers).
    const candidates = await this.store.candidatesForMobile(mobile);
    if (candidates.length > 0) await this.deps.messages.sendOtp(mobile, code);
    return {
      challengeId: id,
      expiresIn: config.OTP_TTL_SECONDS,
      resendIn: config.OTP_RESEND_SECONDS,
    };
  }

  async verifyCode(challengeId: string, code: string, client: ClientInfo): Promise<SignedIn> {
    const { config } = this.deps;
    const now = this.deps.now();
    const challenge = await this.store.findOpenChallenge(challengeId, now);
    if (!challenge) throw new AppError('invalid_input', WRONG_CODE, { code: WRONG_CODE });
    if (!(await this.store.useAttempt(challenge.id, config.OTP_MAX_ATTEMPTS))) {
      throw new AppError('invalid_input', 'Too many wrong codes. Request a new one.', {
        code: 'Too many wrong codes. Request a new one.',
      });
    }
    const expected = hashOtp(config.OTP_PEPPER, challenge.id, code);
    if (!safeEqualHex(expected, challenge.codeHash)) {
      throw new AppError('invalid_input', WRONG_CODE, { code: WRONG_CODE });
    }
    if (!(await this.store.consumeChallenge(challenge.id, now))) {
      throw new AppError('invalid_input', WRONG_CODE, { code: WRONG_CODE });
    }
    const candidates = await this.store.candidatesForMobile(challenge.mobile);
    if (candidates.length === 0) {
      // They've proved they own the number, so saying so reveals nothing new.
      throw new AppError(
        'not_found',
        'No account uses this mobile number. Ask your school admin to add you.',
      );
    }
    return this.finish(challenge.mobile, candidates, client);
  }

  async passwordLogin(mobile: string, password: string, client: ClientInfo): Promise<SignedIn> {
    await this.deps.rateLimits.consumeLoginAttempt(client.ip, mobile);
    const candidates = await this.store.candidatesForMobile(mobile);
    const matched: SignInCandidate[] = [];
    if (candidates.length === 0) await verifyPassword(null, password);
    for (const c of candidates) {
      if (await verifyPassword(c.passwordHash, password)) matched.push(c);
    }
    if (matched.length === 0) throw notLoggedIn('That mobile number or password is wrong.');
    return this.finish(mobile, matched, client);
  }

  async selectOrganisation(
    selectionToken: string,
    organisationId: string,
    client: ClientInfo,
  ): Promise<SignedIn> {
    const claims = await this.deps.tokens.verifySelection(selectionToken, this.deps.now());
    if (!claims) throw notLoggedIn('That sign-in has expired. Please sign in again.');
    // Re-read: someone may have been deactivated since they proved the code.
    const candidates = await this.store.candidatesForMobile(claims.mobile);
    const chosen = candidates.find(
      (c) => c.organisationId === organisationId && claims.userIds.includes(c.userId),
    );
    if (!chosen) throw notLoggedIn('That sign-in has expired. Please sign in again.');
    return this.startSession(chosen, client);
  }

  private async finish(
    mobile: string,
    candidates: SignInCandidate[],
    client: ClientInfo,
  ): Promise<SignedIn> {
    const [only] = candidates;
    if (candidates.length === 1 && only) return this.startSession(only, client);
    const selectionToken = await this.deps.tokens.issueSelection(
      { mobile, userIds: candidates.map((c) => c.userId) },
      this.deps.now(),
    );
    return {
      result: {
        status: 'choose_organisation',
        selectionToken,
        organisations: candidates.map((c) => ({
          id: c.organisationId,
          name: c.organisationName,
          logoUrl: null,
        })),
      },
    };
  }

  private newSession(c: SignInCandidate, client: ClientInfo, familyId: string, now: Date) {
    const refreshToken = randomToken();
    const refreshExpiresAt = new Date(
      now.getTime() + this.deps.config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const input: NewSession = {
      organisationId: c.organisationId,
      userId: c.userId,
      refreshTokenHash: sha256(refreshToken),
      familyId,
      expiresAt: refreshExpiresAt,
      userAgent: client.userAgent?.slice(0, 300) ?? null,
      ip: client.ip,
    };
    return { input, refreshToken, refreshExpiresAt };
  }

  private async startSession(c: SignInCandidate, client: ClientInfo): Promise<SignedIn> {
    const now = this.deps.now();
    const { input, refreshToken, refreshExpiresAt } = this.newSession(c, client, uuidv7(), now);
    const session = await this.store.startSession(input, now);
    const access = await this.deps.tokens.issueAccess(
      { userId: c.userId, organisationId: c.organisationId, sessionId: session.id },
      now,
    );
    return {
      result: {
        status: 'signed_in',
        accessToken: access.token,
        expiresAt: access.expiresAt.toISOString(),
      },
      refreshToken,
      refreshExpiresAt,
    };
  }

  /**
   * Swaps a refresh token for a new pair. Each token works once: presenting a
   * retired one means it was copied, so the whole sign-in is revoked.
   */
  async refresh(
    refreshToken: string,
    client: ClientInfo,
  ): Promise<{ result: RefreshResult; refreshToken: string; refreshExpiresAt: Date }> {
    const now = this.deps.now();
    const session = await this.store.findSessionByRefreshHash(sha256(refreshToken));
    if (!session) throw notLoggedIn();
    if (session.revokedAt) {
      // Two tabs refreshing at once both present the same token; only a late
      // reuse (outside the grace window) is treated as theft.
      const racing =
        session.revokedReason === 'rotated' &&
        now.getTime() - session.revokedAt.getTime() < ROTATION_GRACE_MS;
      if (!racing) {
        await this.store.revokeFamily(session.familyId, 'refresh_token_reused', now);
        this.deps.logger.warn(
          { familyId: session.familyId },
          'Refresh token reuse; sign-in revoked',
        );
      }
      throw notLoggedIn();
    }
    if (session.expiresAt <= now) {
      throw notLoggedIn('Your sign-in has expired. Please sign in again.');
    }
    const candidate = await this.store.candidateForUser(session.userId);
    if (!candidate || candidate.organisationId !== session.organisationId) {
      await this.store.revokeFamily(session.familyId, 'user_unavailable', now);
      throw notLoggedIn();
    }
    const next = this.newSession(candidate, client, session.familyId, now);
    const rotated = await this.store.rotateSession(session.id, next.input, now);
    if (!rotated) throw notLoggedIn();
    const access = await this.deps.tokens.issueAccess(
      { userId: candidate.userId, organisationId: candidate.organisationId, sessionId: rotated.id },
      now,
    );
    return {
      result: { accessToken: access.token, expiresAt: access.expiresAt.toISOString() },
      refreshToken: next.refreshToken,
      refreshExpiresAt: next.refreshExpiresAt,
    };
  }

  /** Logging out runs every registered logout guard first (brief 9.7). */
  async logout(auth: { organisationId: string; userId: string; sessionId: string }): Promise<void> {
    const now = this.deps.now();
    const blocks: LogoutBlock[] = [];
    for (const guard of this.deps.hooks.logoutGuards) {
      blocks.push(
        ...(await guard({ organisationId: auth.organisationId, userId: auth.userId, now })),
      );
    }
    if (blocks.length > 0) {
      const titles = blocks.map((b) => `“${b.title}”`).join(', ');
      throw new AppError(
        'logout_blocked',
        `Please submit ${titles} before you log out.`,
        undefined,
        undefined,
        { blocks },
      );
    }
    await this.store.revokeSession(auth.sessionId, 'logout', now);
  }
}
