import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { meSchema } from '@kidzonia/shared';
import { createTestApp, people } from '../support/app.js';
import type { TestApp } from '../support/app.js';

let t: TestApp;
const as = people(() => t);
const u = (k: string) => t.demo.users[k] ?? '';
const role = (k: string) => t.demo.roles[k] ?? '';

beforeAll(async () => {
  t = await createTestApp();
  const org = t.demo.organisationId;
  // Teachers may see their own Users record, including their mobile.
  await t.prisma.rolePermission.create({
    data: {
      organisationId: org,
      roleId: role('teacher'),
      moduleKey: 'users',
      actions: ['view'],
      reach: 'own',
    },
  });
  // Department heads can edit roles (so they may preview) but their role hides mobiles.
  await t.prisma.rolePermission.create({
    data: {
      organisationId: org,
      roleId: role('dept_head'),
      moduleKey: 'roles',
      actions: ['view', 'edit'],
    },
  });
});
afterAll(async () => {
  await t.close();
});

const header = (id: string) => ({ 'X-Kidzonia-Preview': id });

describe('preview as this role (addition a)', () => {
  it('shows only what both the previewer and the previewed person may see', async () => {
    // Priya alone sees her own mobile…
    const priya = await (await as('u8')).get('/me/profile').expect(200);
    expect(priya.body.mobile).toBe('+919848044108');

    // …but Vikram, whose role hides mobiles, previewing Priya does not.
    const vikram = await as('u2');
    await vikram.post('/preview', { userId: u('u8') }).expect(204);
    const previewed = await vikram
      .get('/me/profile')
      .set(header(u('u8')))
      .expect(200);
    expect(previewed.body.id).toBe(u('u8'));
    expect(previewed.body).not.toHaveProperty('mobile');
    expect(previewed.body.fullName).toBe('Priya Sharma');
  });

  it('describes the previewed person in /me, with the previewer alongside', async () => {
    const res = await (
      await as('u2')
    )
      .get('/me')
      .set(header(u('u8')))
      .expect(200);
    const me = meSchema.parse(res.body);
    expect(me.user.fullName).toBe('Priya Sharma');
    expect(me.role?.roleName).toBe('Teacher');
    expect(me.preview?.previewer.fullName).toBe('Vikram Mehta');
    expect(me.preview?.role?.roleName).toBe('Department head');
  });

  it('never shows the previewer data the previewed person can’t see', async () => {
    // Priya's reach in Users is "own": nobody else appears in the preview.
    const res = await (
      await as('u2')
    )
      .get('/users')
      .set(header(u('u8')))
      .expect(200);
    expect((res.body.items as { id: string }[]).map((i) => i.id)).toEqual([u('u8')]);
  });

  it('is read-only', async () => {
    const vikram = await as('u2');
    const res = await vikram
      .put('/me/profile', { mobile: '96660 00009' })
      .set(header(u('u8')))
      .expect(403);
    expect(res.body.error.message).toMatch(/Preview is read-only/);
    await vikram
      .post('/roles', { name: 'Sneaky' })
      .set(header(u('u8')))
      .expect(403);
  });

  it('is written to the audit log when it starts', async () => {
    const entry = await t.prisma.auditLog.findFirstOrThrow({
      where: { action: 'preview.started', entityId: u('u8') },
    });
    expect(entry.actorUserId).toBe(u('u2'));
  });

  it('needs roles.edit, and only works for people within the previewer’s reach', async () => {
    await (await as('u5')).post('/preview', { userId: u('u8') }).expect(403);
    await (
      await as('u5')
    )
      .get('/me')
      .set(header(u('u8')))
      .expect(403);
    await (await as('u2')).post('/preview', { userId: t.second.users.s1 }).expect(404);
    await (await as('u2')).post('/preview', { userId: u('u2') }).expect(403);
    await (await as('u2')).get('/me').set(header('not-an-id')).expect(400);
  });

  it('still lets the previewer log out', async () => {
    const own = await as('u1');
    await own
      .post('/auth/logout')
      .set(header(u('u8')))
      .expect(204);
  });
});
