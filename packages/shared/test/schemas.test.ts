import { describe, expect, it } from 'vitest';
import {
  formatMobile,
  mobileSchema,
  normalizeMobile,
  pageQuerySchema,
  toPage,
  verifyCodeSchema,
  workingDaysSchema,
} from '../src/index.js';

describe('mobile numbers', () => {
  it.each([
    ['98480 11201', '+919848011201'],
    ['+91 98480-11201', '+919848011201'],
    ['09848011201', '+919848011201'],
    ['919848011201', '+919848011201'],
    ['+44 7700 900123', '+447700900123'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeMobile(input)).toBe(expected);
  });

  it.each(['', '12345', '5848011201', 'abc', '+0123'])('rejects %s', (input) => {
    expect(normalizeMobile(input)).toBeNull();
    expect(mobileSchema.safeParse(input).success).toBe(false);
  });

  it('formats Indian numbers the way people write them', () => {
    expect(formatMobile('+919848011201')).toBe('98480 11201');
    expect(formatMobile('+447700900123')).toBe('+447700900123');
  });
});

describe('other schemas', () => {
  it('requires a 6-digit code', () => {
    const id = '0190a8f4-1b2c-7d3e-8f40-123456789abc';
    expect(verifyCodeSchema.safeParse({ challengeId: id, code: ' 123456 ' }).success).toBe(true);
    expect(verifyCodeSchema.safeParse({ challengeId: id, code: '12345' }).success).toBe(false);
  });

  it('sorts and de-duplicates working days', () => {
    expect(workingDaysSchema.parse([6, 1, 1, 3])).toEqual([1, 3, 6]);
    expect(workingDaysSchema.safeParse([]).success).toBe(false);
    expect(workingDaysSchema.safeParse([7]).success).toBe(false);
  });
});

describe('pagination', () => {
  it('defaults and caps the page size', () => {
    expect(pageQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(pageQuerySchema.parse({ limit: '10' })).toEqual({ limit: 10 });
    expect(pageQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ cursor: 'nope' }).success).toBe(false);
  });

  it('uses one extra row to know whether another page exists', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(toPage(rows, 2)).toEqual({ items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'b' });
    expect(toPage(rows, 3)).toEqual({ items: rows, nextCursor: null });
  });
});
