import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { meSchema } from '@kidzonia/shared';
import { CLIENT_HEADER, createTestApp, refreshCookieFrom } from '../support/app.js';
import type { TestApp } from '../support/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ RL_REGISTER_PER_IP_DAY: '3' });
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.prisma.rateLimit.deleteMany();
  t.messages.sent.length = 0;
  t.messages.invites.length = 0;
});

let n = 0;
/** A fresh, never-used mobile number per test. */
const freshMobile = () => `9${String(700000000 + ++n).padStart(9, '0')}`;

async function registrationToken(mobile: string): Promise<string> {
  const code = await t.http.post('/api/register/request-code').send({ mobile }).expect(201);
  const sent = t.messages.sent.at(-1)?.code;
  const res = await t.http
    .post('/api/register/verify-code')
    .send({ challengeId: code.body.challengeId, code: sent })
    .expect(200);
  return res.body.registrationToken as string;
}

const org = {
  name: 'Little Stars',
  city: 'Pune',
  state: 'Maharashtra',
  workingDays: [1, 2, 3, 4, 5],
  opensAt: '08:30',
  closesAt: '15:30',
};

describe('registration', () => {
  it('texts a code even to a number nobody uses yet', async () => {
    const mobile = freshMobile();
    await t.http.post('/api/register/request-code').send({ mobile }).expect(201);
    expect(t.messages.sent).toHaveLength(1);
  });

  it('refuses a wrong code', async () => {
    const code = await t.http.post('/api/register/request-code').send({ mobile: freshMobile() });
    await t.http
      .post('/api/register/verify-code')
      .send({ challengeId: code.body.challengeId, code: '000000' })
      .expect(400);
  });

  it('creates a single school with one school row and signs the owner in', async () => {
    const mobile = freshMobile();
    const token = await registrationToken(mobile);
    const res = await t.http
      .post('/api/register')
      .send({
        registrationToken: token,
        fullName: 'Asha Kulkarni',
        email: 'asha@example.com',
        password: 'a-strong-password',
        setupType: 'single_school',
        schoolModel: 'coco',
        organisation: org,
      })
      .expect(201);
    expect(res.body.status).toBe('signed_in');
    expect(refreshCookieFrom(res)).toMatch(/^kz_refresh=/);

    const me = meSchema.parse(
      (
        await t.http
          .get('/api/me')
          .set('Authorization', `Bearer ${res.body.accessToken}`)
          .expect(200)
      ).body,
    );
    expect(me.organisation).toMatchObject({ name: 'Little Stars', setupType: 'single_school' });
    expect(me.role).toMatchObject({ roleName: 'Owner', isOwner: true });
    const schools = await t.prisma.school.findMany({
      where: { organisationId: me.organisation.id },
    });
    expect(schools.map((s) => s.name)).toEqual(['Little Stars']);
    expect(me.user.homeSchoolId).toBe(schools[0]?.id);
    const roles = await t.prisma.role.findMany({ where: { organisationId: me.organisation.id } });
    expect(roles.map((r) => r.seedKey).sort()).toEqual(
      ['dept_head', 'franchise_owner', 'owner', 'principal', 'teacher'].sort(),
    );
    // The same password now works for sign-in.
    await t.http
      .post('/api/auth/login')
      .send({ mobile, password: 'a-strong-password' })
      .expect(200);
  });

  it('creates a head office with schools and invites franchise owners', async () => {
    const token = await registrationToken(freshMobile());
    const ownerMobile = freshMobile();
    const res = await t.http
      .post('/api/register')
      .send({
        registrationToken: token,
        fullName: 'Ravi Menon',
        password: 'another-strong-one',
        setupType: 'head_office',
        schoolModel: 'both',
        organisation: { ...org, name: 'Bright Minds Group' },
        schools: [
          { name: 'Baner', city: 'Pune', type: 'coco' },
          {
            name: 'Wakad',
            city: 'Pune',
            type: 'franchise',
            owner: { fullName: 'Nikhil Rao', mobile: ownerMobile },
          },
        ],
      })
      .expect(201);
    const me = meSchema.parse(
      (await t.http.get('/api/me').set('Authorization', `Bearer ${res.body.accessToken}`)).body,
    );
    const orgId = me.organisation.id;
    expect(t.messages.invites.map((i) => i.invite.organisationName)).toEqual([
      'Bright Minds Group',
    ]);
    const owner = await t.prisma.user.findFirstOrThrow({
      where: { organisationId: orgId, fullName: 'Nikhil Rao' },
      include: { roleAssignment: { include: { role: true, schools: true } } },
    });
    expect(owner.status).toBe('invited');
    expect(owner.roleAssignment?.role.seedKey).toBe('franchise_owner');
    const wakad = await t.prisma.school.findFirstOrThrow({
      where: { organisationId: orgId, name: 'Wakad' },
    });
    expect(owner.roleAssignment?.schools.map((s) => s.schoolId)).toEqual([wakad.id]);
    expect(wakad.franchiseOwnerUserId).toBe(owner.id);
    expect(me.user.homeSchoolId).toBeNull(); // head office
  });

  it('writes the whole sign-up in one transaction (nothing left behind on failure)', async () => {
    const before = await t.prisma.organisation.count();
    const token = await registrationToken(freshMobile());
    const dup = freshMobile();
    const res = await t.http
      .post('/api/register')
      .send({
        registrationToken: token,
        fullName: 'Fail Case',
        password: 'strong-enough-pw',
        setupType: 'head_office',
        schoolModel: 'franchise',
        organisation: { ...org, name: 'Half Built' },
        schools: [
          { name: 'A', city: 'X', type: 'franchise', owner: { fullName: 'One', mobile: dup } },
          { name: 'B', city: 'X', type: 'franchise', owner: { fullName: 'Two', mobile: dup } },
        ],
      })
      .expect(400);
    expect(res.body.error.message).toMatch(/own mobile number/);
    expect(await t.prisma.organisation.count()).toBe(before);
  });

  it('uses each registration token only once', async () => {
    const token = await registrationToken(freshMobile());
    const body = {
      registrationToken: token,
      fullName: 'Once Only',
      password: 'strong-enough-pw',
      setupType: 'single_school',
      schoolModel: 'coco',
      organisation: { ...org, name: 'Once School' },
    };
    await t.http.post('/api/register').send(body).expect(201);
    await t.http.post('/api/register').send(body).expect(401);
  });

  it('validates the whole form with messages per field', async () => {
    const res = await t.http
      .post('/api/register')
      .send({
        registrationToken: 'x',
        fullName: '',
        password: 'short',
        setupType: 'single_school',
        schoolModel: 'coco',
        organisation: { ...org, opensAt: '16:00', closesAt: '09:00' },
        schools: [{ name: 'Extra', city: 'X', type: 'coco' }],
      })
      .expect(400);
    expect(res.body.error.fields).toMatchObject({
      fullName: expect.any(String),
      password: 'Use at least 8 characters',
      'organisation.closesAt': 'Closing time must be after opening time',
      schools: 'A single school has no other schools',
    });
  });

  it('refuses a forged or expired registration token', async () => {
    await t.http
      .post('/api/register')
      .send({
        registrationToken: 'forged',
        fullName: 'X',
        password: 'strong-enough-pw',
        setupType: 'single_school',
        schoolModel: 'coco',
        organisation: org,
      })
      .expect(401);
  });

  it('limits new organisations per IP per day', async () => {
    const make = async () => {
      const token = await registrationToken(freshMobile());
      return t.http.post('/api/register').send({
        registrationToken: token,
        fullName: 'Many',
        password: 'strong-enough-pw',
        setupType: 'single_school',
        schoolModel: 'coco',
        organisation: { ...org, name: `School ${n}` },
      });
    };
    for (let i = 0; i < 3; i++) expect((await make()).status).toBe(201);
    const res = await make();
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeTruthy();
  });

  it('the organisation picker token also works only once', async () => {
    // Priya is in both seeded organisations.
    const code = await t.http.post('/api/auth/request-code').send({ mobile: '98480 44108' });
    const v = await t.http
      .post('/api/auth/verify-code')
      .send({ challengeId: code.body.challengeId, code: t.messages.sent.at(-1)?.code })
      .expect(200);
    const body = { selectionToken: v.body.selectionToken, organisationId: t.demo.organisationId };
    await t.http.post('/api/auth/select-organisation').send(body).expect(200);
    await t.http.post('/api/auth/select-organisation').send(body).expect(401);
  });

  it('keeps logging out possible for the new owner', async () => {
    const token = await registrationToken(freshMobile());
    const res = await t.http
      .post('/api/register')
      .send({
        registrationToken: token,
        fullName: 'Leaving Soon',
        password: 'strong-enough-pw',
        setupType: 'single_school',
        schoolModel: 'coco',
        organisation: { ...org, name: 'Leaving School' },
      })
      .expect(201);
    await t.http
      .post('/api/auth/logout')
      .set(CLIENT_HEADER)
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(204);
  });
});
