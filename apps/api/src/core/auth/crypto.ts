import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { OTP_LENGTH } from '@kidzonia/shared';

export function randomOtp(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

/**
 * Binds a code to its challenge with a server-side pepper, so a leaked table
 * of hashes can't be brute-forced offline (a 6-digit space is tiny).
 */
export function hashOtp(pepper: string, challengeId: string, code: string): string {
  return createHmac('sha256', pepper).update(`${challengeId}:${code}`).digest('hex');
}

/** Refresh tokens are 256 random bits; only their SHA-256 is stored. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
