import { describe, expect, it } from 'vitest';
import { TenancyViolation, scopeArgs } from '../../src/db/scope-args.js';

const ORG = '11111111-1111-7111-8111-111111111111';
const OTHER = '22222222-2222-7222-8222-222222222222';

describe('scopeArgs: reads', () => {
  it.each(['findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy'])(
    '%s ANDs the organisation filter onto any where',
    (op) => {
      const where = { OR: [{ fullName: 'a' }, { organisationId: OTHER }] };
      expect(scopeArgs('User', op, { where }, ORG)).toEqual({
        where: { AND: [where, { organisationId: ORG }] },
      });
    },
  );

  it('adds the filter even when there is no where', () => {
    expect(scopeArgs('User', 'findMany', undefined, ORG)).toEqual({
      where: { AND: [{ organisationId: ORG }] },
    });
    expect(scopeArgs('School', 'count', {}, ORG)).toEqual({
      where: { AND: [{ organisationId: ORG }] },
    });
  });

  it('keeps the unique key for findUnique and adds the filter beside it', () => {
    expect(scopeArgs('User', 'findUnique', { where: { id: 'x' } }, ORG)).toEqual({
      where: { id: 'x', AND: [{ organisationId: ORG }] },
    });
    expect(
      scopeArgs(
        'User',
        'findUniqueOrThrow',
        { where: { id: 'x', AND: { status: 'active' } } },
        ORG,
      ),
    ).toEqual({ where: { id: 'x', AND: [{ status: 'active' }, { organisationId: ORG }] } });
  });

  it('scopes the organisation table by its own id', () => {
    expect(scopeArgs('Organisation', 'findFirst', {}, ORG)).toEqual({
      where: { AND: [{ id: ORG }] },
    });
  });

  it('leaves models without an organisation alone', () => {
    const args = { where: { mobile: '+919848011201' } };
    expect(scopeArgs('OtpChallenge', 'findMany', args, ORG)).toBe(args);
  });
});

describe('scopeArgs: writes', () => {
  it('stamps the organisation on create and createMany', () => {
    expect(scopeArgs('School', 'create', { data: { name: 'A' } }, ORG)).toEqual({
      data: { name: 'A', organisationId: ORG },
    });
    expect(
      scopeArgs('School', 'createMany', { data: [{ name: 'A' }, { name: 'B' }] }, ORG),
    ).toEqual({
      data: [
        { name: 'A', organisationId: ORG },
        { name: 'B', organisationId: ORG },
      ],
    });
  });

  it('refuses to create rows for another organisation', () => {
    expect(() =>
      scopeArgs('School', 'create', { data: { name: 'A', organisationId: OTHER } }, ORG),
    ).toThrow(TenancyViolation);
    expect(() =>
      scopeArgs('School', 'createManyAndReturn', { data: [{ organisationId: OTHER }] }, ORG),
    ).toThrow(TenancyViolation);
  });

  it('filters updateMany and deleteMany to the organisation', () => {
    expect(
      scopeArgs(
        'User',
        'updateMany',
        { where: { status: 'invited' }, data: { status: 'active' } },
        ORG,
      ),
    ).toEqual({
      where: { AND: [{ status: 'invited' }, { organisationId: ORG }] },
      data: { status: 'active' },
    });
    expect(scopeArgs('User', 'deleteMany', {}, ORG)).toEqual({
      where: { AND: [{ organisationId: ORG }] },
    });
  });

  it('never lets an update move a row between organisations', () => {
    expect(() =>
      scopeArgs('User', 'update', { where: { id: 'x' }, data: { organisationId: OTHER } }, ORG),
    ).toThrow(TenancyViolation);
    expect(() =>
      scopeArgs('User', 'updateMany', { where: {}, data: { organisationId: ORG } }, ORG),
    ).toThrow(TenancyViolation);
  });

  it('scopes upsert on both branches', () => {
    expect(
      scopeArgs(
        'AutomaticRoleSetting',
        'upsert',
        {
          where: { organisationId_switchKey: { organisationId: ORG, switchKey: 'k' } },
          create: { switchKey: 'k', enabled: true },
          update: { enabled: true },
        },
        ORG,
      ),
    ).toEqual({
      where: {
        organisationId_switchKey: { organisationId: ORG, switchKey: 'k' },
        AND: [{ organisationId: ORG }],
      },
      create: { switchKey: 'k', enabled: true, organisationId: ORG },
      update: { enabled: true },
    });
  });

  it('rejects nested writes, which would bypass scoping', () => {
    expect(() =>
      scopeArgs(
        'User',
        'create',
        { data: { fullName: 'x', homeSchool: { connect: { id: 'y' } } } },
        ORG,
      ),
    ).toThrow(/nested writes/);
    expect(() =>
      scopeArgs(
        'Role',
        'update',
        { where: { id: 'r' }, data: { permissions: { create: [] } } },
        ORG,
      ),
    ).toThrow(/nested writes/);
  });

  it('never creates or deletes organisations through a scoped client', () => {
    expect(() => scopeArgs('Organisation', 'create', { data: { name: 'x' } }, ORG)).toThrow();
    expect(() => scopeArgs('Organisation', 'delete', { where: { id: ORG } }, ORG)).toThrow();
    expect(() =>
      scopeArgs('Organisation', 'update', { where: { id: ORG }, data: { id: OTHER } }, ORG),
    ).toThrow();
  });

  it('fails closed on operations it does not know', () => {
    expect(() => scopeArgs('User', 'findRaw', {}, ORG)).toThrow(/not supported/);
  });
});
