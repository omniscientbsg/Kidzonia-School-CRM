import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

// Verified against when no account matches, so a wrong mobile number takes as
// long as a wrong password and response times don't reveal who has an account.
let dummyHash: Promise<string> | undefined;

export async function verifyPassword(hashed: string | null, password: string): Promise<boolean> {
  if (!hashed) {
    dummyHash ??= hashPassword('not-a-real-password');
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  return verify(hashed, password).catch(() => false);
}
