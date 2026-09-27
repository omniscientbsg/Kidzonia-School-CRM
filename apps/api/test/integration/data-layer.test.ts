import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenancyViolation, mapDbError, withUnitOfWork } from '../../src/db/index.js';
import type { ScopedDb } from '../../src/db/index.js';
import { createTestApp, people } from '../support/app.js';
import type { TestApp } from '../support/app.js';

let t: TestApp;
let a: ScopedDb; // the demo organisation
let aId: string;
let bId: string;
const actorFor = (organisationId: string) => ({ organisationId, userId: null, requestId: 'test' });

beforeAll(async () => {
  t = await createTestApp();
  aId = t.demo.organisationId;
  bId = t.second.organisationId;
  a = t.deps.data.forOrganisation(aId);
});
afterAll(async () => {
  await t.close();
});

const id = (m: Record<string, string>, k: string) => {
  const v = m[k];
  if (!v) throw new Error(`missing ${k}`);
  return v;
};

/** Runs a write expected to fail and returns the user-facing error it maps to. */
async function mappedError(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    return mapDbError(err);
  }
  throw new Error('expected the write to fail');
}

describe('scoped client: reads never see another organisation', () => {
  it('lists only its own rows', async () => {
    const users = await a.user.findMany({ select: { organisationId: true } });
    expect(users.length).toBe(18);
    expect(new Set(users.map((u) => u.organisationId))).toEqual(new Set([aId]));
  });

  it('returns nothing for another organisation’s id, whichever read is used', async () => {
    const other = id(t.second.users, 's1');
    expect(await a.user.findUnique({ where: { id: other } })).toBeNull();
    expect(await a.user.findFirst({ where: { id: other } })).toBeNull();
    await expect(a.user.findUniqueOrThrow({ where: { id: other } })).rejects.toThrow();
    expect(await a.user.findMany({ where: { organisationId: bId } })).toEqual([]);
  });

  it('scopes count, aggregate and groupBy', async () => {
    expect(await a.user.count()).toBe(18);
    expect(await a.user.count({ where: { organisationId: bId } })).toBe(0);
    const agg = await a.school.aggregate({ _count: { _all: true } });
    expect(agg._count._all).toBe(4);
    const groups = await a.user.groupBy({ by: ['organisationId'], _count: { _all: true } });
    expect(groups).toEqual([{ organisationId: aId, _count: { _all: 18 } }]);
  });

  it('only ever sees its own organisation row', async () => {
    const orgs = await a.organisation.findMany({ select: { id: true } });
    expect(orgs).toEqual([{ id: aId }]);
    expect(await a.organisation.findUnique({ where: { id: bId } })).toBeNull();
  });

  it('relation includes never return another organisation’s rows', async () => {
    const schools = await a.school.findMany({
      include: { homeOf: { select: { organisationId: true } }, franchiseOwner: true },
    });
    for (const s of schools) {
      for (const u of s.homeOf) expect(u.organisationId).toBe(aId);
      if (s.franchiseOwner) expect(s.franchiseOwner.organisationId).toBe(aId);
    }
    const roles = await a.role.findMany({ include: { assignments: { include: { user: true } } } });
    for (const r of roles) for (const x of r.assignments) expect(x.user.organisationId).toBe(aId);
  });

  it('keeps scoping inside interactive transactions', async () => {
    const count = await a.$transaction(async (tx) => tx.user.count());
    expect(count).toBe(18);
  });
});

describe('scoped client: writes never touch another organisation', () => {
  it('updateMany and deleteMany leave other organisations alone', async () => {
    const updated = await a.automaticRoleSetting.updateMany({ data: { enabled: false } });
    expect(updated.count).toBe(0);
    const b = t.deps.data.forOrganisation(bId);
    const bLinks = await b.roleAssignmentSchool.count();
    expect(bLinks).toBeGreaterThan(0);
    const deleted = await a.roleAssignmentSchool.deleteMany({
      where: { schoolId: id(t.second.schools, 'mp') },
    });
    expect(deleted.count).toBe(0);
    expect(await b.roleAssignmentSchool.count()).toBe(bLinks);
    const sessions = await a.authSession.updateMany({ data: { revokedReason: 'x' } });
    expect(sessions.count).toBe(0);
  });

  it('cannot update or delete another organisation’s row by id', async () => {
    const other = id(t.second.users, 's1');
    const err = await mappedError(() =>
      withUnitOfWork(a, actorFor(aId), ({ tx }) =>
        tx.user.update({ where: { id: other }, data: { fullName: 'Hacked' } }),
      ),
    );
    expect(err?.status).toBe(404);
    const delErr = await mappedError(() => a.authSession.delete({ where: { id: other } }));
    expect(delErr?.status).toBe(404);
    const still = await t.deps.data.forOrganisation(bId).user.findFirst({ where: { id: other } });
    expect(still?.fullName).toBe('Nisha Kapoor');
  });

  it('refuses to create rows stamped with another organisation', async () => {
    await expect(
      a.automaticRoleSetting.create({
        data: { organisationId: bId, switchKey: 'x', enabled: true },
      }),
    ).rejects.toThrow(TenancyViolation);
  });

  it('refuses bulk writes to tracked tables before running them', async () => {
    const before = await a.user.count({ where: { jobTitle: 'Bulk' } });
    await expect(
      withUnitOfWork(a, actorFor(aId), ({ tx }) =>
        tx.user.updateMany({ data: { jobTitle: 'Bulk' } }),
      ),
    ).rejects.toThrow(TenancyViolation);
    expect(await a.user.count({ where: { jobTitle: 'Bulk' } })).toBe(before);
  });

  it('refuses writes to tracked tables outside a unit of work', async () => {
    await expect(
      a.school.create({ data: { organisationId: aId, name: 'Loose', city: 'X', type: 'coco' } }),
    ).rejects.toThrow(/withUnitOfWork/);
  });
});

describe('database: cross-organisation references are impossible', () => {
  const inUow = <T>(
    fn: (tx: Parameters<Parameters<typeof withUnitOfWork>[2]>[0]['tx']) => Promise<T>,
  ) => withUnitOfWork(a, actorFor(aId), ({ tx }) => fn(tx));

  it('rejects a user whose school belongs to another organisation (422)', async () => {
    const err = await mappedError(() =>
      inUow((tx) =>
        tx.user.update({
          where: { id: id(t.demo.users, 'u8') },
          data: { homeSchoolId: id(t.second.schools, 'mp') },
        }),
      ),
    );
    expect(err?.status).toBe(422);
  });

  it('rejects reporting to someone in another organisation (422)', async () => {
    const err = await mappedError(() =>
      inUow((tx) =>
        tx.user.update({
          where: { id: id(t.demo.users, 'u8') },
          data: { reportsToUserId: id(t.second.users, 's1') },
        }),
      ),
    );
    expect(err?.status).toBe(422);
  });

  it('rejects a franchise owner from another organisation (422)', async () => {
    const err = await mappedError(() =>
      inUow((tx) =>
        tx.school.update({
          where: { id: id(t.demo.schools, 'kp') },
          data: { franchiseOwnerUserId: id(t.second.users, 's1') },
        }),
      ),
    );
    expect(err?.status).toBe(422);
  });

  it('rejects giving someone another organisation’s role (422)', async () => {
    const err = await mappedError(() =>
      inUow((tx) =>
        tx.roleAssignment.update({
          where: { userId: id(t.demo.users, 'u8') },
          data: { roleId: id(t.second.roles, 'teacher') },
        }),
      ),
    );
    expect(err?.status).toBe(422);
  });

  it('rejects scoping a role to another organisation’s school (422)', async () => {
    const assignment = await a.roleAssignment.findFirstOrThrow({
      where: { userId: id(t.demo.users, 'u8') },
    });
    const err = await mappedError(() =>
      inUow((tx) =>
        tx.roleAssignmentSchool.create({
          data: {
            organisationId: aId,
            assignmentId: assignment.id,
            schoolId: id(t.second.schools, 'mp'),
          },
        }),
      ),
    );
    expect(err?.status).toBe(422);
  });
});

describe('created_by and updated_by are stamped by the data layer (brief 5)', () => {
  const as = people(() => t);

  it('stamps the person acting on writes through the API, users and roles included', async () => {
    const owner = t.demo.users.u1 ?? '';
    const res = await (
      await as('u1')
    )
      .post('/users', {
        fullName: 'Stamp Check',
        mobile: '96660 22233',
        homeSchoolId: t.demo.schools.kp,
        reportsToUserId: t.demo.users.u6,
        role: {
          roleId: t.demo.roles.teacher,
          scope: { allSchools: false, schoolIds: [t.demo.schools.kp] },
        },
      })
      .expect(201);
    const created = await t.prisma.user.findUniqueOrThrow({ where: { id: res.body.id as string } });
    expect(created).toMatchObject({ createdBy: owner, updatedBy: owner });
    const assignment = await t.prisma.roleAssignment.findFirstOrThrow({
      where: { userId: created.id },
    });
    expect(assignment.createdBy).toBe(owner);
    // Suresh, the franchise owner, edits people in his schools.
    await (await as('u4')).put(`/users/${created.id}`, { department: 'Art' }).expect(200);
    const edited = await t.prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(edited).toMatchObject({ createdBy: owner, updatedBy: t.demo.users.u4 });
  });

  it('keeps a stamp the code sets itself, and never stamps without a person', async () => {
    const someone = t.demo.users.u2 ?? '';
    const holiday = await withUnitOfWork(
      a,
      { organisationId: aId, userId: someone, requestId: 'test' },
      (uow) =>
        uow.tx.holiday.create({
          data: {
            organisationId: aId,
            name: 'Stamped',
            startDate: new Date('2027-01-26'),
            endDate: new Date('2027-01-26'),
          },
        }),
    );
    expect(holiday).toMatchObject({ createdBy: someone, updatedBy: someone });
    const kept = await withUnitOfWork(
      a,
      { organisationId: aId, userId: someone, requestId: 'test' },
      (uow) =>
        uow.tx.holiday.update({
          where: { id: holiday.id },
          data: { name: 'Kept', updatedBy: t.demo.users.u1 ?? '' },
        }),
    );
    expect(kept.updatedBy).toBe(t.demo.users.u1);
    const job = await withUnitOfWork(a, actorFor(aId), (uow) =>
      uow.tx.holiday.update({ where: { id: holiday.id }, data: { name: 'By the job' } }),
    );
    expect(job.updatedBy).toBe(t.demo.users.u1);
  });
});

describe('database: one role per person', () => {
  it('rejects a second role for the same person, even written directly', async () => {
    const u8 = id(t.demo.users, 'u8');
    // Through Prisma, bypassing the app (409 once mapped).
    const err = await mappedError(() =>
      t.prisma.roleAssignment.create({
        data: { organisationId: aId, userId: u8, roleId: id(t.demo.roles, 'principal') },
      }),
    );
    expect(err?.status).toBe(409);
    // In plain SQL: the unique index itself refuses it.
    await expect(
      t.prisma.$executeRaw`
        INSERT INTO role_assignments (id, organisation_id, user_id, role_id, updated_at)
        VALUES (gen_random_uuid(), ${aId}::uuid, ${u8}::uuid, ${id(t.demo.roles, 'principal')}::uuid, now())`,
    ).rejects.toThrow(/unique|duplicate/i);
    expect(await t.prisma.roleAssignment.count({ where: { userId: u8 } })).toBe(1);
  });
});

describe('database: reports-to can never form a loop', () => {
  const setManager = (user: string, manager: string | null) =>
    withUnitOfWork(a, actorFor(aId), ({ tx }) =>
      tx.user.update({ where: { id: user }, data: { reportsToUserId: manager } }),
    );

  it('rejects someone reporting to themselves', async () => {
    const u8 = id(t.demo.users, 'u8');
    expect((await mappedError(() => setManager(u8, u8)))?.status).toBe(422);
  });

  it('rejects a two-step loop (A reports to B, B reports to A)', async () => {
    // Meera (u5) manages Priya (u8); making Meera report to Priya would loop.
    const err = await mappedError(() => setManager(id(t.demo.users, 'u5'), id(t.demo.users, 'u8')));
    expect(err?.status).toBe(422);
    expect(err?.message).toMatch(/report to themselves/);
  });

  it('rejects a longer loop through the tree', async () => {
    // Ananya (u1) → Meera (u5) → Priya (u8). Ananya reporting to Priya closes the loop.
    const err = await mappedError(() => setManager(id(t.demo.users, 'u1'), id(t.demo.users, 'u8')));
    expect(err?.status).toBe(422);
  });

  it('lets only one of two concurrent opposite changes through', async () => {
    const x = id(t.demo.users, 'u9');
    const y = id(t.demo.users, 'u10');
    const results = await Promise.allSettled([setManager(x, y), setManager(y, x)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // Put them back under Meera.
    const meera = id(t.demo.users, 'u5');
    await setManager(x, meera);
    await setManager(y, meera);
  });

  it('allows ordinary changes', async () => {
    await setManager(id(t.demo.users, 'u9'), id(t.demo.users, 'u1'));
    await setManager(id(t.demo.users, 'u9'), id(t.demo.users, 'u5'));
  });
});

describe('activity and audit are written with the data', () => {
  it('records who changed which record, never its contents', async () => {
    const before = await a.activity.count();
    await withUnitOfWork(
      a,
      { organisationId: aId, userId: id(t.demo.users, 'u1'), requestId: 'r1' },
      async ({ tx, audit }) => {
        await tx.user.update({
          where: { id: id(t.demo.users, 'u9') },
          data: { jobTitle: 'Senior teacher' },
          select: { id: true },
        });
        audit({ action: 'user.updated', entityType: 'user', entityId: id(t.demo.users, 'u9') });
      },
    );
    const rows = await a.activity.findMany({ orderBy: { createdAt: 'desc' }, take: 1 });
    expect(await a.activity.count()).toBe(before + 1);
    expect(rows[0]).toMatchObject({
      action: 'updated',
      entityType: 'user',
      entityId: id(t.demo.users, 'u9'),
      actorUserId: id(t.demo.users, 'u1'),
      subjectUserIds: [id(t.demo.users, 'u9')],
      schoolId: id(t.demo.schools, 'jh'),
    });
    expect(JSON.stringify(rows[0])).not.toContain('Senior teacher');
    const audit = await a.auditLog.findFirst({ where: { requestId: 'r1' } });
    expect(audit?.entityId).toBe(id(t.demo.users, 'u9'));
  });

  it('rolls activity back with the data when the unit of work fails', async () => {
    const before = await a.activity.count();
    await expect(
      withUnitOfWork(a, actorFor(aId), async ({ tx }) => {
        await tx.user.update({ where: { id: id(t.demo.users, 'u9') }, data: { jobTitle: 'X' } });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await a.activity.count()).toBe(before);
    const u = await a.user.findFirst({ where: { id: id(t.demo.users, 'u9') } });
    expect(u?.jobTitle).toBe('Senior teacher');
  });

  it('reports soft deletes as deletes', async () => {
    await withUnitOfWork(a, actorFor(aId), async ({ tx }) => {
      await tx.school.update({
        where: { id: id(t.demo.schools, 'gb') },
        data: { deletedAt: new Date() },
      });
      await tx.school.update({
        where: { id: id(t.demo.schools, 'gb') },
        data: { deletedAt: null },
      });
    });
    const last = await a.activity.findMany({
      where: { entityId: id(t.demo.schools, 'gb') },
      orderBy: { createdAt: 'asc' },
    });
    expect(last.map((r) => r.action)).toContain('deleted');
  });
});
