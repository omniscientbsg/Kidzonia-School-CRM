import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, people } from '../support/app.js';
import type { TestApp } from '../support/app.js';

/** Brief audit D2: people's photos, through the same checks as the logo. */

let t: TestApp;
const as = people(() => t);
const u = (k: string) => t.demo.users[k] ?? '';

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.prisma.rateLimit.deleteMany();
});

const png = (colour = '#1a63c6', width = 40, height = 20) =>
  sharp({ create: { width, height, channels: 3, background: colour } })
    .png()
    .toBuffer();

const photoKeyOf = async (key: string) =>
  (await t.prisma.user.findUniqueOrThrow({ where: { id: u(key) } })).photoKey;

describe('your own photo', () => {
  it('is set by anyone, even without Users, and shown on /me', async () => {
    // Priya is a teacher: no Users permission at all.
    const priya = await as('u8');
    const res = await priya.putRaw('/me/photo', await png(), 'image/png').expect(200);
    expect(res.body.photoUrl).toMatch(new RegExp(`^/api/users/${u('u8')}/photo\\?v=`));
    const me = await priya.get('/me').expect(200);
    expect(me.body.user.photoUrl).toBe(res.body.photoUrl);
    // Colleagues see it next to her name.
    const list = await (await as('u5')).get('/users?limit=50').expect(200);
    const row = (list.body.items as { id: string; photoUrl: string | null }[]).find(
      (i) => i.id === u('u8'),
    );
    expect(row?.photoUrl).toBe(res.body.photoUrl);
  });

  it('strips metadata, crops to a square, and is served safely', async () => {
    const jpeg = await sharp({
      create: { width: 600, height: 300, channels: 3, background: '#e3a11a' },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-device-info', Artist: 'Someone' } } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();

    // Declared as PNG on purpose: the declared type is ignored.
    const res = await (await as('u9')).putRaw('/me/photo', jpeg, 'image/png').expect(200);
    const got = await (
      await as('u8')
    )
      .get(String(res.body.photoUrl).replace(/^\/api/, ''))
      .buffer(true)
      .expect(200);
    expect(got.headers['content-type']).toBe('image/jpeg');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(got.headers['content-security-policy']).toContain("default-src 'none'");
    expect(got.headers['content-security-policy']).toContain('sandbox');
    expect(got.headers['cache-control']).toContain('private');
    const meta = await sharp(got.body as Buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([256, 256]);
  });

  it('replaces the old file and removes it on delete', async () => {
    const priya = await as('u8');
    await priya.putRaw('/me/photo', await png('#111111'), 'image/png').expect(200);
    const first = await photoKeyOf('u8');
    await priya.putRaw('/me/photo', await png('#222222'), 'image/png').expect(200);
    const second = await photoKeyOf('u8');
    expect(second).not.toBe(first);
    expect(await t.deps.storage.get(first ?? '')).toBeNull();

    await priya.delete('/me/photo').expect(204);
    expect(await photoKeyOf('u8')).toBeNull();
    expect(await t.deps.storage.get(second ?? '')).toBeNull();
    await priya.get(`/users/${u('u8')}/photo`).expect(404);
    expect((await priya.get('/me').expect(200)).body.user.photoUrl).toBeNull();
    // Removing when there is none is fine.
    await priya.delete('/me/photo').expect(204);
  });
});

describe('someone else’s photo', () => {
  it('can be set and removed by someone with Users → Edit over them', async () => {
    const owner = await as('u1');
    const res = await owner
      .putRaw(`/users/${u('u8')}/photo`, await png('#00aa00'), 'image/png')
      .expect(200);
    const detail = await owner.get(`/users/${u('u8')}`).expect(200);
    expect(detail.body.photoUrl).toBe(res.body.photoUrl);
    await owner.delete(`/users/${u('u8')}/photo`).expect(204);
    expect(await photoKeyOf('u8')).toBeNull();
  });

  it('can’t be changed without Users → Edit over the person', async () => {
    const before = await photoKeyOf('u9');
    // A teacher can't see Users at all: the person is "not found".
    await (await as('u8')).putRaw(`/users/${u('u9')}/photo`, await png(), 'image/png').expect(404);
    await (await as('u8')).delete(`/users/${u('u9')}/photo`).expect(404);
    // A principal can see her school's people but not edit them.
    await (await as('u5')).putRaw(`/users/${u('u9')}/photo`, await png(), 'image/png').expect(403);
    await (await as('u5')).delete(`/users/${u('u9')}/photo`).expect(403);
    // A franchise owner can't reach another school's people.
    await (await as('u4')).putRaw(`/users/${u('u8')}/photo`, await png(), 'image/png').expect(404);
    expect(await photoKeyOf('u9')).toBe(before);
  });

  it('follows reach and the power rule', async () => {
    const fo = await as('u4');
    // A franchise owner edits Users in their own schools…
    await fo.putRaw(`/users/${u('u15')}/photo`, await png(), 'image/png').expect(200);
    // …but head office is out of reach.
    await fo.putRaw(`/users/${u('u2')}/photo`, await png(), 'image/png').expect(404);
    // Someone whose role can do more than yours can't be changed, even in reach.
    await t.prisma.user.update({ where: { id: u('u15') }, data: { photoKey: null } });
    const owner = await as('u1');
    await owner
      .put(`/users/${u('u15')}/role`, {
        role: { roleId: t.demo.roles.owner, scope: { allSchools: true, schoolIds: [] } },
      })
      .expect(200);
    await fo.putRaw(`/users/${u('u15')}/photo`, await png(), 'image/png').expect(403);
    expect(await photoKeyOf('u15')).toBeNull();
  });

  it('is audited', async () => {
    const owner = await as('u1');
    await owner.putRaw(`/users/${u('u10')}/photo`, await png(), 'image/png').expect(200);
    await owner.delete(`/users/${u('u10')}/photo`).expect(204);
    const rows = await t.prisma.auditLog.findMany({
      where: { action: 'user.photo_changed', entityId: u('u10') },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => [r.actorUserId, r.before, r.after])).toEqual([
      [u('u1'), { photo: 'none' }, { photo: 'set' }],
      [u('u1'), { photo: 'set' }, { photo: 'none' }],
    ]);
  });
});

describe('file checks (same as the logo)', () => {
  it('rejects SVG, even named as an image', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const res = await (await as('u8')).putRaw('/me/photo', svg, 'image/png').expect(400);
    expect(res.body.error.message).toMatch(/PNG, JPEG or WebP/);
  });

  it('rejects a script dressed up with image bytes', async () => {
    const fake = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('<script>alert(document.cookie)</script>'),
    ]);
    await (await as('u8')).putRaw('/me/photo', fake, 'image/png').expect(400);
    await (await as('u8')).putRaw('/me/photo', Buffer.from('GIF89a....'), 'image/gif').expect(400);
  });

  it('rejects files over 5 MB and empty uploads', async () => {
    await (
      await as('u8')
    )
      .putRaw('/me/photo', Buffer.alloc(5 * 1024 * 1024 + 10, 1), 'image/png')
      .expect(400);
    await (await as('u8')).putRaw('/me/photo', Buffer.alloc(0), 'image/png').expect(400);
  });
});

describe('who can see a photo', () => {
  it('is only served within the organisation', async () => {
    await (await as('u8')).putRaw('/me/photo', await png(), 'image/png').expect(200);
    await (await as('u9')).get(`/users/${u('u8')}/photo`).expect(200);
    await (await as('s1')).get(`/users/${u('u8')}/photo`).expect(404);
    await t.http.get(`/api/users/${u('u8')}/photo`).expect(401);
  });

  it('goes with the person when they’re deleted', async () => {
    const owner = await as('u1');
    await owner.putRaw(`/users/${u('u14')}/photo`, await png(), 'image/png').expect(200);
    const key = await photoKeyOf('u14');
    expect(await t.deps.storage.get(key ?? '')).not.toBeNull();
    await owner.delete(`/users/${u('u14')}`).expect(204);
    expect(await photoKeyOf('u14')).toBeNull();
    expect(await t.deps.storage.get(key ?? '')).toBeNull();
    await owner.get(`/users/${u('u14')}/photo`).expect(404);
  });
});
