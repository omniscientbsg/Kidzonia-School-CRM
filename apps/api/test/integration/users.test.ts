import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { approverFor } from '../../src/core/field-changes/service.js';
import { createTestApp, mobileOf, people, signIn } from '../support/app.js';
import type { TestApp } from '../support/app.js';

let t: TestApp;
const as = people(() => t);
const u = (k: string) => t.demo.users[k] ?? '';
const role = (k: string) => t.demo.roles[k] ?? '';
const school = (k: string) => t.demo.schools[k] ?? '';

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.prisma.rateLimit.deleteMany();
});

type Item = Record<string, unknown>;
const namesOf = (b: { items: Item[] }) => b.items.map((i) => i.fullName);

describe('listing people', () => {
  it('lists everyone for the Owner, paginated', async () => {
    const p1 = await (await as('u1')).get('/users?limit=10').expect(200);
    expect(p1.body.items).toHaveLength(10);
    const p2 = await (
      await as('u1')
    )
      .get(`/users?limit=10&cursor=${p1.body.nextCursor as string}`)
      .expect(200);
    expect(p2.body.items).toHaveLength(8);
    expect(p2.body.nextCursor).toBeNull();
  });

  it('limits a principal to their school (reach "school")', async () => {
    const res = await (await as('u5')).get('/users?limit=50').expect(200);
    expect(new Set(namesOf(res.body))).toEqual(
      new Set(['Meera Iyer', 'Priya Sharma', 'Rohan Gupta', 'Sneha Pillai', 'Rahul Verma']),
    );
    await (await as('u5')).get(`/users/${u('u13')}`).expect(404);
  });

  it('refuses people without Users', async () => {
    await (await as('u9')).get('/users').expect(403);
  });

  it('counts people waiting for a role', async () => {
    const res = await (await as('u1')).get('/users/summary').expect(200);
    expect(res.body).toEqual({ total: 18, waitingForRole: 1 });
  });

  it('shows role and "No access yet"', async () => {
    const res = await (await as('u1')).get(`/users/${u('u14')}`).expect(200);
    expect(res.body.role).toBeNull();
    const meera = await (await as('u1')).get(`/users/${u('u5')}`).expect(200);
    expect(meera.body.role).toMatchObject({
      name: 'Principal',
      scope: { allSchools: false, schoolIds: [school('jh')] },
    });
    expect(meera.body.directReportsCount).toBe(4);
  });
});

describe('hidden fields can’t leak through search, filters or sorting (addition d)', () => {
  it('hides the mobile column from a Department head', async () => {
    const res = await (await as('u2')).get('/users?limit=50').expect(200);
    expect((res.body.items as Item[]).every((i) => !('mobile' in i))).toBe(true);
  });

  it('matches mobile numbers only for people who can see them', async () => {
    const owner = await (await as('u1')).get('/users?search=98480%2044108').expect(200);
    expect(namesOf(owner.body)).toEqual(['Priya Sharma']);
    const dept = await (await as('u2')).get('/users?search=98480%2044108').expect(200);
    expect(dept.body.items).toEqual([]);
    // Names still work.
    const byName = await (await as('u2')).get('/users?search=priya').expect(200);
    expect(namesOf(byName.body)).toEqual(['Priya Sharma']);
  });

  it('refuses sorting by a hidden field', async () => {
    await (await as('u1')).get('/users?sort=mobile').expect(200);
    const res = await (await as('u2')).get('/users?sort=mobile').expect(400);
    expect(res.body.error.message).toBe('You can’t sort by that.');
  });

  it('refuses filtering by a hidden field', async () => {
    await t.prisma.roleFieldPermission.create({
      data: {
        organisationId: t.demo.organisationId,
        roleId: role('dept_head'),
        moduleKey: 'users',
        fieldKey: 'school',
        access: 'hidden',
      },
    });
    try {
      await (await as('u2')).get(`/users?schoolId=${school('jh')}`).expect(400);
      await (await as('u2')).get('/users?sort=school').expect(400);
      const res = await (await as('u2')).get('/users?limit=5').expect(200);
      expect(
        (res.body.items as Item[]).every((i) => !('homeSchoolId' in i) && !('homeSchoolName' in i)),
      ).toBe(true);
    } finally {
      await t.prisma.roleFieldPermission.deleteMany({
        where: { roleId: role('dept_head'), fieldKey: 'school' },
      });
    }
    await (await as('u2')).get(`/users?schoolId=${school('jh')}`).expect(200);
  });
});

describe('adding people', () => {
  it('adds someone with a role and sends an invite', async () => {
    const res = await (
      await as('u1')
    )
      .post('/users', {
        fullName: 'Nandini Rao',
        mobile: '96660 00001',
        homeSchoolId: school('jh'),
        reportsToUserId: u('u5'),
        jobTitle: 'Teacher, Playgroup',
        role: { roleId: role('teacher'), scope: { allSchools: false, schoolIds: [school('jh')] } },
      })
      .expect(201);
    expect(res.body).toMatchObject({
      fullName: 'Nandini Rao',
      status: 'invited',
      role: { name: 'Teacher' },
    });
    expect(t.messages.invites.at(-1)).toMatchObject({ mobile: '+919666000001' });
  });

  it('validates input with a message per field', async () => {
    const res = await (
      await as('u1')
    )
      .post('/users', { fullName: '', mobile: '123', homeSchoolId: null })
      .expect(400);
    expect(Object.keys(res.body.error.fields as object).sort()).toEqual(['fullName', 'mobile']);
  });

  it('refuses a mobile already used in the organisation', async () => {
    const res = await (
      await as('u1')
    )
      .post('/users', { fullName: 'Copy', mobile: mobileOf('u9'), homeSchoolId: school('jh') })
      .expect(409);
    expect(res.body.error.fields.mobile).toBeTruthy();
  });

  it('lets a franchise owner add people to their own schools with roles within theirs', async () => {
    await (
      await as('u4')
    )
      .post('/users', {
        fullName: 'Kiran Patel',
        mobile: '96660 00002',
        homeSchoolId: school('kp'),
        reportsToUserId: u('u6'),
        sendInvite: false,
        role: {
          roleId: role('principal'),
          scope: { allSchools: false, schoolIds: [school('kp')] },
        },
      })
      .expect(201);
  });

  it('stops a franchise owner placing people outside their schools', async () => {
    const res = await (
      await as('u4')
    )
      .post('/users', {
        fullName: 'Out',
        mobile: '96660 00003',
        homeSchoolId: school('jh'),
        sendInvite: false,
      })
      .expect(403);
    expect(res.body.error.fields.homeSchoolId).toBeTruthy();
  });

  it('stops a franchise owner giving a more powerful role or a wider scope', async () => {
    const tooStrong = await (
      await as('u4')
    )
      .post('/users', {
        fullName: 'Too Strong',
        mobile: '96660 00004',
        homeSchoolId: school('kp'),
        sendInvite: false,
        role: {
          roleId: role('dept_head'),
          scope: { allSchools: false, schoolIds: [school('kp')] },
        },
      })
      .expect(403);
    expect(tooStrong.body.error.message).toMatch(/more access than your own role/);
    await (
      await as('u4')
    )
      .post('/users', {
        fullName: 'Too Wide',
        mobile: '96660 00005',
        homeSchoolId: school('kp'),
        sendInvite: false,
        role: { roleId: role('principal'), scope: { allSchools: true, schoolIds: [] } },
      })
      .expect(403);
    await (
      await as('u4')
    )
      .post('/users', {
        fullName: 'Owner Wannabe',
        mobile: '96660 00006',
        homeSchoolId: school('kp'),
        sendInvite: false,
        role: { roleId: role('owner'), scope: { allSchools: true, schoolIds: [] } },
      })
      .expect(403);
  });

  it('refuses a manager outside the editor’s reach', async () => {
    const res = await (
      await as('u4')
    )
      .post('/users', {
        fullName: 'Wrong Boss',
        mobile: '96660 00007',
        homeSchoolId: school('kp'),
        reportsToUserId: u('u5'),
        sendInvite: false,
      })
      .expect(422);
    expect(res.body.error.fields.reportsToUserId).toBeTruthy();
  });

  it('refuses people who can only view Users', async () => {
    await (
      await as('u5')
    )
      .post('/users', { fullName: 'X', mobile: '96660 00008', homeSchoolId: school('jh') })
      .expect(403);
  });
});

describe('editing people (addition c)', () => {
  it('edits part of someone’s details', async () => {
    const res = await (
      await as('u1')
    )
      .put(`/users/${u('u10')}`, { jobTitle: 'Senior teacher, KG 2' })
      .expect(200);
    expect(res.body.user.jobTitle).toBe('Senior teacher, KG 2');
    expect(res.body.pending).toEqual([]);
  });

  it('keeps every field not sent exactly as it was', async () => {
    // Users have no rule linking two fields, so the merged record is always
    // the stored one plus what was sent.
    const changed = new Set(['department', 'updatedAt', 'updatedBy']);
    const omit = (row: object) => Object.entries(row).filter(([k]) => !changed.has(k));
    const before = await t.prisma.user.findUniqueOrThrow({ where: { id: u('u9') } });
    const res = await (
      await as('u1')
    )
      .put(`/users/${u('u9')}`, { department: 'Early years' })
      .expect(200);
    expect(res.body.user.department).toBe('Early years');
    const after = await t.prisma.user.findUniqueOrThrow({ where: { id: u('u9') } });
    expect(after.department).toBe('Early years');
    expect(omit(after)).toEqual(omit(before));
  });

  it('won’t move someone to a school outside the editor’s reach', async () => {
    await (await as('u4')).put(`/users/${u('u11')}`, { homeSchoolId: school('jh') }).expect(403);
    await (await as('u4')).put(`/users/${u('u11')}`, { homeSchoolId: school('kk') }).expect(200);
    await (await as('u4')).put(`/users/${u('u11')}`, { homeSchoolId: school('kp') }).expect(200);
  });

  it('won’t let anyone change someone whose role is more powerful than theirs', async () => {
    // Imran (a Kondapur teacher) is made a Department head by the Owner.
    await (
      await as('u1')
    )
      .put(`/users/${u('u11')}/role`, {
        role: { roleId: role('dept_head'), scope: { allSchools: true, schoolIds: [] } },
      })
      .expect(200);
    try {
      const fo = await as('u4');
      const res = await fo.put(`/users/${u('u11')}`, { jobTitle: 'Demoted' }).expect(403);
      expect(res.body.error.message).toMatch(/more access than yours/);
      await fo.post(`/users/${u('u11')}/deactivate`).expect(403);
      await fo.put(`/users/${u('u11')}/role`, { role: null }).expect(403);
    } finally {
      await (
        await as('u1')
      )
        .put(`/users/${u('u11')}/role`, {
          role: {
            roleId: role('teacher'),
            scope: { allSchools: false, schoolIds: [school('kp')] },
          },
        })
        .expect(200);
    }
  });

  it('still runs the reporting-loop check', async () => {
    const res = await (
      await as('u1')
    )
      .put(`/users/${u('u5')}`, { reportsToUserId: u('u8') })
      .expect(422);
    expect(res.body.error.fields.reportsToUserId).toBeTruthy();
  });

  it('answers 404 for people outside reach and 403 without edit', async () => {
    await (await as('u4')).put(`/users/${u('u8')}`, { jobTitle: 'x' }).expect(404);
    await (await as('u2')).put(`/users/${u('u8')}`, { jobTitle: 'x' }).expect(403);
  });

  it('keeps at least one Owner', async () => {
    const res = await (await as('u1')).put(`/users/${u('u1')}/role`, { role: null }).expect(422);
    expect(res.body.error.message).toMatch(/only Owner/);
    await (await as('u1')).post(`/users/${u('u1')}/deactivate`).expect(422);
  });
});

describe('changes that need approval (addition f)', () => {
  beforeAll(async () => {
    // Teachers may see their own Users record and change their own mobile, with approval.
    await t.prisma.rolePermission.create({
      data: {
        organisationId: t.demo.organisationId,
        roleId: role('teacher'),
        moduleKey: 'users',
        actions: ['view'],
        reach: 'own',
      },
    });
    await t.prisma.roleFieldPermission.create({
      data: {
        organisationId: t.demo.organisationId,
        roleId: role('teacher'),
        moduleKey: 'users',
        fieldKey: 'mobile',
        access: 'view',
        ownRecord: 'edit',
        needsApproval: true,
      },
    });
  });

  const openChanges = () =>
    t.prisma.pendingFieldChange.findMany({ where: { recordId: u('u8'), status: 'pending' } });

  it('saves the change as pending, leaving the value as it was', async () => {
    const priya = await as('u8');
    const res = await priya.put('/me/profile', { mobile: '96660 10001' }).expect(200);
    expect(res.body.pending).toEqual(['mobile']);
    expect(res.body.user.mobile).toBe('+919848044108');
    // Other fields are still refused outright.
    await priya.put('/me/profile', { fullName: 'P. Sharma' }).expect(403);
  });

  it('keeps one open request per field: a new one replaces the old', async () => {
    await (await as('u8')).put('/me/profile', { mobile: '96660 10002' }).expect(200);
    const open = await openChanges();
    expect(open).toHaveLength(1);
    expect(open[0]?.newValue).toEqual({ mobile: '+919666010002' });
    expect(
      await t.prisma.pendingFieldChange.count({
        where: { recordId: u('u8'), status: 'superseded' },
      }),
    ).toBe(1);
  });

  it('shows the request to the manager, who approves it', async () => {
    const meera = await as('u5');
    const list = await meera.get('/field-changes?view=to_approve').expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      fieldLabel: 'Mobile number',
      subject: { fullName: 'Priya Sharma' },
    });
    // The requester can see it but not decide it.
    await (
      await as('u8')
    )
      .post(`/field-changes/${list.body.items[0].id as string}/approve`)
      .expect(403);
    // Someone else's team can't see it.
    await (
      await as('u7')
    )
      .post(`/field-changes/${list.body.items[0].id as string}/approve`)
      .expect(404);

    const done = await meera
      .post(`/field-changes/${list.body.items[0].id as string}/approve`)
      .expect(200);
    expect(done.body.status).toBe('approved');
    const priya = await t.prisma.user.findUniqueOrThrow({ where: { id: u('u8') } });
    expect(priya.mobile).toBe('+919666010002');
    await meera.post(`/field-changes/${list.body.items[0].id as string}/approve`).expect(409);
  });

  it('marks a request out of date if the value changed since, instead of overwriting', async () => {
    await (await as('u8')).put('/me/profile', { mobile: '96660 10003' }).expect(200);
    const [open] = await openChanges();
    await (await as('u1')).put(`/users/${u('u8')}`, { mobile: '96660 10004' }).expect(200);
    const res = await (await as('u5')).post(`/field-changes/${open?.id ?? ''}/approve`).expect(200);
    expect(res.body.status).toBe('out_of_date');
    const priya = await t.prisma.user.findUniqueOrThrow({ where: { id: u('u8') } });
    expect(priya.mobile).toBe('+919666010004');
  });

  it('lets the manager reject with a reason, and the person see their own requests', async () => {
    await (await as('u8')).put('/me/profile', { mobile: '96660 10005' }).expect(200);
    const [open] = await openChanges();
    await (
      await as('u5')
    )
      .post(`/field-changes/${open?.id ?? ''}/reject`, { reason: 'Use your school number' })
      .expect(200);
    const mine = await (await as('u8')).get('/field-changes?view=mine').expect(200);
    expect((mine.body.items as Item[]).map((i) => i.status)).toContain('rejected');
  });

  it('sends approvals up the chain while a manager is inactive (addition e)', async () => {
    expect(await approverFor(t.deps.data, t.demo.organisationId, u('u8'))).toBe(u('u5'));
    await t.prisma.user.update({ where: { id: u('u5') }, data: { status: 'inactive' } });
    try {
      expect(await approverFor(t.deps.data, t.demo.organisationId, u('u8'))).toBe(u('u1'));
    } finally {
      await t.prisma.user.update({ where: { id: u('u5') }, data: { status: 'active' } });
    }
  });
});

describe('deactivating, deleting and inviting', () => {
  it('warns via the reports count and can move reports in the same step', async () => {
    const arjun = await signIn(t, mobileOf('u7'));
    const before = await (await as('u1')).get(`/users/${u('u7')}`).expect(200);
    expect(before.body.directReportsCount).toBe(2);
    const res = await (
      await as('u1')
    )
      .post(`/users/${u('u7')}/deactivate`, { moveReportsTo: u('u5') })
      .expect(200);
    expect(res.body).toMatchObject({
      movedReports: 2,
      user: { status: 'inactive', directReportsCount: 0 },
    });
    const lakshmi = await t.prisma.user.findUniqueOrThrow({ where: { id: u('u13') } });
    expect(lakshmi.reportsToUserId).toBe(u('u5'));
    // Signed out everywhere at once.
    await t.http.get('/api/me').set(arjun.auth).expect(401);
    await (await as('u1')).post(`/users/${u('u7')}/reactivate`).expect(200);
  });

  it('refuses to deactivate yourself', async () => {
    await (await as('u5')).post(`/users/${u('u5')}/deactivate`).expect(422);
  });

  it('refuses to delete someone people still report to', async () => {
    const res = await (await as('u1')).delete(`/users/${u('u5')}`).expect(422);
    expect(res.body.error.message).toMatch(/report to Meera Iyer/);
  });

  it('deletes someone and frees their mobile number', async () => {
    const created = await (
      await as('u1')
    )
      .post('/users', {
        fullName: 'Short Stay',
        mobile: '96660 20001',
        homeSchoolId: school('gb'),
        sendInvite: false,
      })
      .expect(201);
    await (await as('u1')).delete(`/users/${created.body.id as string}`).expect(204);
    await (await as('u1')).get(`/users/${created.body.id as string}`).expect(404);
    await (
      await as('u1')
    )
      .post('/users', {
        fullName: 'New Person',
        mobile: '96660 20001',
        homeSchoolId: school('gb'),
        sendInvite: false,
      })
      .expect(201);
  });

  it('limits invite re-sends per person per day (addition h)', async () => {
    const owner = await as('u1');
    const created = await owner
      .post('/users', { fullName: 'Invitee', mobile: '96660 30001', homeSchoolId: school('gb') })
      .expect(201);
    const id = created.body.id as string;
    await owner.post(`/users/${id}/invite`).expect(200);
    await owner.post(`/users/${id}/invite`).expect(200);
    const res = await owner.post(`/users/${id}/invite`).expect(429);
    expect(res.headers['retry-after']).toBeTruthy();
  });
});
