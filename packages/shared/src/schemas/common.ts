import { z } from 'zod';

/**
 * Mobile numbers are stored in E.164 (`+919848011201`). Staff type them in
 * every format ("98480 11201", "+91-98480-11201", "09848011201"); a bare
 * 10-digit Indian mobile gets +91.
 */
export function normalizeMobile(input: string): string | null {
  const trimmed = input.trim();
  const plus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (plus) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) {
    return `+${digits}`;
  }
  return null;
}

/** Shows an Indian number the way people write it: "98480 11201". */
export function formatMobile(e164: string): string {
  if (e164.startsWith('+91') && e164.length === 13) {
    return `${e164.slice(3, 8)} ${e164.slice(8)}`;
  }
  return e164;
}

export const mobileSchema = z
  .string({ message: 'Enter a mobile number' })
  .min(1, 'Enter a mobile number')
  .transform((v, ctx) => {
    const m = normalizeMobile(v);
    if (!m) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid mobile number' });
      return z.NEVER;
    }
    return m;
  });

/** 24-hour clock time, "HH:MM". */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 08:30');

/** Weekday numbers 0 (Sunday) to 6 (Saturday). */
export const workingDaysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1, 'Pick at least one working day')
  .transform((days) => [...new Set(days)].sort((a, b) => a - b));
