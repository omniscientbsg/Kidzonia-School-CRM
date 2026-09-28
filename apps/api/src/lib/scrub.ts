/**
 * Removes personal data and secrets from anything that leaves the process as
 * text: log lines and error reports. Parent and staff mobile numbers must
 * never reach a log service or an error tracker, whatever code path produced
 * them (a Postgres "duplicate key" detail quotes the value, for example).
 *
 * Kept free of imports so the logger, the error reporter and the ops scripts
 * can all use it. The web app has its own copy of the same rules in
 * apps/web/src/lib/scrub.ts; change both together.
 */

export const REDACTED = '[redacted]';

/**
 * Keys whose values are never kept, at any depth. Matched case-insensitively
 * against the whole key, so `x-refresh-token` and `accessToken` are caught.
 */
const SENSITIVE_KEY =
  /authorization|cookie|token|secret|password|passwd|pepper|otp|mobile|phone|dsn|api[-_]?key|credential/i;

/**
 * Ten to fifteen digits, optionally with a leading + and single spaces or
 * dashes between them: Indian mobiles in every common spelling ("9848011201",
 * "+91 98480 11201", "098480-11201") and international numbers. Dates and
 * times never have ten digits in a row with only these separators.
 */
const PHONE = /\+?(?<!\d)\d(?:[ -]?\d){9,14}(?!\d)/;
/**
 * Record ids are UUIDs, and some of their groups are all digits by chance;
 * they are matched first and kept, so ids in reports stay usable.
 */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const UUID_OR_PHONE = new RegExp(`(${UUID.source})|${PHONE.source}`, 'gi');
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** A JWT (header.payload.signature, base64url). */
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const BEARER = /\b(Bearer|Basic)\s+[\w.~+/=-]+/gi;
/** Postgres quotes the offending values in constraint errors: `Key (mobile)=(98480...)`. */
const PG_KEY_DETAIL = /\bKey \(([^)]*)\)=\((?:[^()]|\([^()]*\))*\)/g;
/** Credentials inside connection strings: `postgresql://user:pass@host`. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;

export function scrubText(text: string): string {
  return text
    .replace(URL_CREDENTIALS, `$1${REDACTED}@`)
    .replace(PG_KEY_DETAIL, `Key ($1)=(${REDACTED})`)
    .replace(JWT, REDACTED)
    .replace(BEARER, `$1 ${REDACTED}`)
    .replace(EMAIL, '[email]')
    .replace(UUID_OR_PHONE, (match, uuid: string | undefined) => (uuid ? match : '[phone]'));
}

const MAX_DEPTH = 12;

/**
 * A deep copy with sensitive keys blanked and every string passed through
 * `scrubText`. Errors are copied as plain objects (name, message, stack and
 * their own properties) so nothing is lost for the reader except the secrets.
 */
export function scrubValue<T>(value: T): T {
  return scrubInner(value, 0, new WeakSet()) as T;
}

function scrubInner(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[too deep]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => scrubInner(v, depth + 1, seen));
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return `[${value.length} bytes]`;

  const out: Record<string, unknown> = {};
  if (value instanceof Error) {
    out.name = value.name;
    out.message = scrubText(value.message);
    if (value.stack) out.stack = scrubText(value.stack);
    // `cause` is not enumerable, so it would be skipped below.
    if (value.cause !== undefined) out.cause = scrubInner(value.cause, depth + 1, seen);
  }
  for (const [key, v] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrubInner(v, depth + 1, seen);
  }
  return out;
}
