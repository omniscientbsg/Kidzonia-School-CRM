import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { navigationFor, contextFromMe, meSchema, registry } from '@kidzonia/shared';
import { TokenService } from '../../src/core/auth/tokens.js';
import { createApp } from '../../src/app.js';
import { createTestApp, mobileOf, signIn } from '../support/app.js';
import type { Session, TestApp } from '../support/app.js';
import request from 'supertest';

let t: TestApp;
let owner: Session;
let teacher: Session;
let noRole: Session;
let principal: Session;

beforeAll(async () => {
  t = await createTestApp();
  [owner, teacher, noRole, principal] = await Promise.all([
    signIn(t, mobileOf('u1')),
    signIn(t, mobileOf('u9')),
    signIn(t, mobileOf('u14')),
    signIn(t, mobileOf('u5')),
  ]);
});
afterAll(async () => {
  await t.close();
});

describe('GET /me', () => {
  it('describes the Owner with full access', async () => {
    const res = await t.http.get('/api/me').set(owner.auth).expect(200);
    const me = meSchema.parse(res.body);
    expect(me.user.fullName).toBe('Ananya Rao');
    expect(me.organisation).toMatchObject({
      name: 'Kidzonia Pre-schools',
      setupType: 'head_office',
    });
    expect(me.role).toMatchObject({ roleName: 'Owner', isOwner: true });
    expect(me.scope.allSchools).toBe(true);
    // Her reporting tree: HO heads, two COCO principals and their teachers. Franchise
    // schools report to Suresh, who reports to nobody, so they aren't her team.
    expect(me.teamUserIds).toHaveLength(10);
    expect(me.askForAccess).toBeNull();
  });

  it('never includes contact details or secrets', async () => {
    const res = await t.http.get('/api/me').set(owner.auth).expect(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('+9198480');
    expect(text).not.toContain('passwordHash');
    expect(text).not.toContain('ananya@');
  });

  it('gives a principal their school scope and whole team', async () => {
    const me = meSchema.parse((await t.http.get('/api/me').set(principal.auth).expect(200)).body);
    expect(me.scope).toEqual({ allSchools: false, schoolIds: [t.demo.schools.jh] });
    expect(new Set(me.teamUserIds)).toEqual(
      new Set([t.demo.users.u8, t.demo.users.u9, t.demo.users.u10, t.demo.users.u14]),
    );
  });

  it('builds the teacher’s reduced menu from the role alone', async () => {
    const me = meSchema.parse((await t.http.get('/api/me').set(teacher.auth).expect(200)).body);
    const nav = navigationFor(contextFromMe(me, registry));
    expect(nav.apps.map((a) => a.app.key)).toEqual(['tasks', 'hrms']);
  });

  it('tells someone with no role who to ask', async () => {
    const me = meSchema.parse((await t.http.get('/api/me').set(noRole.auth).expect(200)).body);
    expect(me.role).toBeNull();
    expect(me.askForAccess).toMatchObject({ fullName: 'Meera Iyer', jobTitle: 'Principal' });
    expect(navigationFor(contextFromMe(me, registry)).hasAccess).toBe(false);
  });

  it('reflects permission changes on the next request', async () => {
    const teacherRole = t.demo.roles.teacher;
    if (!teacherRole) throw new Error('no teacher role');
    const before = meSchema.parse((await t.http.get('/api/me').set(teacher.auth).expect(200)).body);
    await t.prisma.rolePermission.create({
      data: {
        organisationId: t.demo.organisationId,
        roleId: teacherRole,
        moduleKey: 'roles',
        actions: ['view'],
      },
    });
    try {
      const after = meSchema.parse(
        (await t.http.get('/api/me').set(teacher.auth).expect(200)).body,
      );
      const tabs = (m: typeof before) =>
        navigationFor(contextFromMe(m, registry)).apps.map((a) => a.app.key);
      expect(tabs(before)).not.toContain('settings');
      expect(tabs(after)).toContain('settings');
    } finally {
      await t.prisma.rolePermission.deleteMany({
        where: { roleId: teacherRole, moduleKey: 'roles' },
      });
    }
  });

  it('401 without a token, with a garbage token, or with an expired one', async () => {
    await t.http.get('/api/me').expect(401);
    await t.http.get('/api/me').set('Authorization', 'Bearer nonsense').expect(401);
    await t.http.get('/api/me').set('Authorization', 'Basic abc').expect(401);
    t.clock.now = new Date(Date.now() + 13 * 60 * 60 * 1000);
    try {
      await t.http.get('/api/me').set(owner.auth).expect(401);
    } finally {
      t.clock.now = new Date();
    }
  });

  it('rejects a token signed with another secret', async () => {
    const forger = new TokenService('f'.repeat(48), undefined, 600);
    const session = await t.prisma.authSession.findFirstOrThrow({
      where: { userId: t.demo.users.u1! },
    });
    const { token } = await forger.issueAccess(
      { userId: session.userId, organisationId: session.organisationId, sessionId: session.id },
      new Date(),
    );
    await t.http.get('/api/me').set('Authorization', `Bearer ${token}`).expect(401);
  });
});

describe('GET /registry', () => {
  it('lists apps, modules, actions and reaches', async () => {
    const res = await t.http.get('/api/registry').set(teacher.auth).expect(200);
    expect(res.body.modules.map((m: { key: string }) => m.key)).toContain('task_reports');
    expect(res.body.apps.find((a: { key: string }) => a.key === 'hrms').comingSoon).toBe(true);
    expect(res.body.actions.approve.label).toBe('Approve work');
  });

  it('needs sign-in', async () => {
    await t.http.get('/api/registry').expect(401);
  });
});

describe('platform behaviour', () => {
  it('GET /health checks the database', async () => {
    const res = await t.http.get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok' });
  });

  it('GET /health reports 503 when the database is down', async () => {
    const broken = createApp({
      ...t.deps,
      data: { ...t.deps.data, ping: () => Promise.reject(new Error('down')) },
    });
    const res = await request(broken.app).get('/api/health').expect(503);
    expect(res.body).toEqual({ status: 'error', database: 'unreachable' });
  });

  it('echoes a sane X-Request-Id and generates one otherwise', async () => {
    const res = await t.http.get('/api/health').set('X-Request-Id', 'abc-123').expect(200);
    expect(res.headers['x-request-id']).toBe('abc-123');
    const gen = await t.http.get('/api/health').set('X-Request-Id', '<script>').expect(200);
    expect(gen.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers unknown API routes with a JSON 404', async () => {
    const res = await t.http.get('/api/nothing-here').expect(404);
    expect(res.body.error).toMatchObject({ code: 'not_found' });
  });

  it('answers malformed JSON with a clear 400', async () => {
    const res = await t.http
      .post('/api/auth/request-code')
      .set('Content-Type', 'application/json')
      .send('{"mobile":')
      .expect(400);
    expect(res.body.error.message).toBe('The request body is not valid JSON.');
  });

  it('never leaks a stack trace in production', async () => {
    const prodDeps = { ...t.deps, config: { ...t.deps.config, NODE_ENV: 'production' as const } };
    const failing = createApp({
      ...prodDeps,
      data: {
        ...t.deps.data,
        auth: Object.assign(
          Object.create(Object.getPrototypeOf(t.deps.data.auth) as object),
          t.deps.data.auth,
          {
            liveSession: () => Promise.reject(new Error('secret internal detail')),
          },
        ) as typeof t.deps.data.auth,
      },
    });
    const res = await request(failing.app).get('/api/me').set(owner.auth).expect(500);
    expect(res.body).toEqual({
      error: {
        code: 'internal',
        message: 'Something went wrong. Please try again.',
        requestId: expect.any(String),
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
  });

  it('sets security headers', async () => {
    const res = await t.http.get('/api/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('only allows listed browser origins', async () => {
    const ok = await t.http
      .options('/api/me')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await t.http
      .options('/api/me')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});
