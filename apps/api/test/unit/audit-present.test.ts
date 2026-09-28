import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, auditAreaOf } from '@kidzonia/shared';
import {
  DESCRIBED_ACTIONS,
  looksLikePhone,
  maskPhone,
  maskPhonesIn,
  present,
} from '../../src/core/audit/present.js';
import type { Names, StoredEntry } from '../../src/core/audit/present.js';

const ROLE = '0190a8f4-1b2c-7d3e-8f40-000000000001';
const USER = '0190a8f4-1b2c-7d3e-8f40-000000000002';
const SCHOOL = '0190a8f4-1b2c-7d3e-8f40-000000000003';

const names: Names = {
  organisation: 'Kidzonia Pre-schools',
  roles: new Map([[ROLE, 'Principal']]),
  users: new Map([[USER, 'Rohan Gupta']]),
  schools: new Map([[SCHOOL, 'Jubilee Hills']]),
  holidays: new Map(),
  forms: new Map(),
  tasks: new Map(),
  copies: new Map(),
};

const entry = (over: Partial<StoredEntry>): StoredEntry => ({
  id: '0190a8f4-1b2c-7d3e-8f40-0000000000ff',
  createdAt: new Date('2026-10-05T04:30:00Z'),
  actor: { id: USER, fullName: 'Ananya Rao' },
  action: 'user.updated',
  entityType: 'user',
  entityId: USER,
  before: null,
  after: null,
  ...over,
});

describe('phone masking', () => {
  it('keeps only the country code and the last three digits', () => {
    expect(maskPhone('+919848044108')).toBe('+91 ••••• ••108');
    expect(maskPhone('98480 44108')).toBe('+91 ••••• ••108');
    expect(maskPhone('+447911123456')).toBe('+•••••••••456');
    expect(maskPhone('12')).toBe('•••••');
  });

  it('recognises mobile and E.164 numbers but not dates, times or ids', () => {
    expect(looksLikePhone('+919848011201')).toBe(true);
    expect(looksLikePhone('98480-11201')).toBe(true);
    expect(looksLikePhone('2026-12-15')).toBe(false);
    expect(looksLikePhone('17:45')).toBe(false);
    expect(looksLikePhone('LO-001')).toBe(false);
  });

  it('masks numbers inside free text', () => {
    expect(maskPhonesIn('Call 98480 44108 after school')).toBe('Call +91 ••••• ••108 after school');
    expect(maskPhonesIn('From 2026-12-15 to 2026-12-16')).toBe('From 2026-12-15 to 2026-12-16');
  });

  it('never lets a number through a log entry, whatever the key', () => {
    const out = present(
      entry({
        before: { mobile: '+919848044108', parentMobile: 'not a number', note: 'x' },
        after: { mobile: '+919848044199', parentMobile: '+919848044100', note: 'ring 9848044108' },
      }),
      names,
    );
    const text = JSON.stringify(out);
    for (const n of ['9848044108', '9848044199', '9848044100']) expect(text).not.toContain(n);
    expect(out.changes).toContainEqual({
      field: 'Mobile number',
      before: '+91 ••••• ••108',
      after: '+91 ••••• ••199',
    });
    expect(out.changes).toContainEqual({
      field: 'Parent mobile',
      before: '•••••',
      after: '+91 ••••• ••100',
    });
  });
});

describe('readable entries', () => {
  it('describes a role’s permissions per section with action labels', () => {
    const out = present(
      entry({
        action: 'role.permissions_changed',
        entityType: 'role',
        entityId: ROLE,
        before: { modules: { tasks: { actions: ['view'], reach: 'own' } }, fields: {} },
        after: { modules: { tasks: { actions: ['view', 'approve'], reach: 'own' } }, fields: {} },
      }),
      names,
    );
    expect(out.summary).toBe('changed permissions for Principal');
    expect(out.area).toBe('roles');
    expect(out.changes).toEqual([
      {
        field: 'Tasks',
        before: 'View · Only their own',
        after: 'View, Approve work · Only their own',
      },
    ]);
  });

  it('uses registry labels and names instead of ids', () => {
    const out = present(
      entry({ before: { homeSchoolId: null }, after: { homeSchoolId: SCHOOL } }),
      names,
    );
    expect(out.summary).toBe('changed details for Rohan Gupta');
    expect(out.changes).toEqual([{ field: 'School', before: null, after: 'Jubilee Hills' }]);
  });

  it('has a sentence for every action in the filter list', () => {
    for (const action of Object.keys(AUDIT_ACTIONS)) {
      expect(DESCRIBED_ACTIONS).toContain(action);
      expect(auditAreaOf(action)).not.toBe('other');
    }
  });
});
