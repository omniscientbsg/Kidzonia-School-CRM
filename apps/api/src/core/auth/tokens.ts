import { SignJWT, errors, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

const ISSUER = 'kidzonia-360';
const encoder = new TextEncoder();

export interface AccessClaims {
  userId: string;
  organisationId: string;
  sessionId: string;
}

export interface SelectionClaims {
  mobile: string;
  /** The people (one per organisation) this sign-in proved ownership of. */
  userIds: string[];
}

type TokenType = 'access' | 'org_select';

/**
 * HS256 tokens. Verification also accepts JWT_SECRET_PREVIOUS so the secret
 * can be rotated without signing everyone out: deploy with the new secret and
 * the old one as previous, wait one access-token lifetime, then drop previous.
 */
export class TokenService {
  private readonly current: Uint8Array;
  private readonly previous: Uint8Array | undefined;

  constructor(
    secret: string,
    previousSecret: string | undefined,
    private readonly accessTtlSeconds: number,
  ) {
    this.current = encoder.encode(secret);
    this.previous = previousSecret ? encoder.encode(previousSecret) : undefined;
  }

  private sign(type: TokenType, subject: string, extra: JWTPayload, ttlSeconds: number, now: Date) {
    const iat = Math.floor(now.getTime() / 1000);
    return new SignJWT({ ...extra, typ: type })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setSubject(subject)
      .setIssuedAt(iat)
      .setExpirationTime(iat + ttlSeconds)
      .sign(this.current);
  }

  private async verify(token: string, type: TokenType, now: Date): Promise<JWTPayload | null> {
    const keys = this.previous ? [this.current, this.previous] : [this.current];
    for (const key of keys) {
      try {
        const { payload } = await jwtVerify(token, key, {
          issuer: ISSUER,
          algorithms: ['HS256'],
          currentDate: now,
        });
        // The type claim stops one kind of token being replayed as another.
        return payload.typ === type ? payload : null;
      } catch (err) {
        if (err instanceof errors.JWSSignatureVerificationFailed) continue;
        return null;
      }
    }
    return null;
  }

  async issueAccess(claims: AccessClaims, now: Date): Promise<{ token: string; expiresAt: Date }> {
    const token = await this.sign(
      'access',
      claims.userId,
      { org: claims.organisationId, sid: claims.sessionId },
      this.accessTtlSeconds,
      now,
    );
    return { token, expiresAt: new Date(now.getTime() + this.accessTtlSeconds * 1000) };
  }

  async verifyAccess(token: string, now: Date): Promise<AccessClaims | null> {
    const p = await this.verify(token, 'access', now);
    if (!p || typeof p.sub !== 'string' || typeof p.org !== 'string' || typeof p.sid !== 'string') {
      return null;
    }
    return { userId: p.sub, organisationId: p.org, sessionId: p.sid };
  }

  issueSelection(claims: SelectionClaims, now: Date): Promise<string> {
    return this.sign('org_select', claims.mobile, { uids: claims.userIds }, 5 * 60, now);
  }

  async verifySelection(token: string, now: Date): Promise<SelectionClaims | null> {
    const p = await this.verify(token, 'org_select', now);
    const uids: unknown = p?.uids;
    if (!p || typeof p.sub !== 'string' || !Array.isArray(uids)) return null;
    if (!uids.every((u): u is string => typeof u === 'string')) return null;
    return { mobile: p.sub, userIds: uids };
  }
}
