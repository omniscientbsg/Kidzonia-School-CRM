import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, people } from '../support/app.js';
import type { TestApp } from '../support/app.js';

let t: TestApp;
const as = people(() => t);
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('organisation settings', () => {
  it('shows the organisation to people who can view it', async () => {
    const res = await (await as('u1')).get('/organisation').expect(200);
    expect(res.body).toMatchObject({
      name: 'Kidzonia Pre-schools',
      setupType: 'head_office',
      logoUrl: null,
    });
    // Franchise owners can view but not edit.
    await (await as('u4')).get('/organisation').expect(200);
    await (await as('u9')).get('/organisation').expect(403);
  });

  it('updates part of the record, validating the merged result', async () => {
    const owner = await as('u1');
    const res = await owner
      .put('/organisation', { closesAt: '17:00', timezone: 'Asia/Kolkata' })
      .expect(200);
    expect(res.body).toMatchObject({ opensAt: '08:00', closesAt: '17:00' });
    // Only closesAt sent, but it conflicts with the stored opensAt.
    const bad = await owner.put('/organisation', { closesAt: '07:00' }).expect(400);
    expect(bad.body.error.fields).toEqual({ closesAt: 'Closing time must be after opening time' });
    await owner.put('/organisation', { timezone: 'Mars/Olympus' }).expect(400);
    await owner.put('/organisation', { workingDays: [] }).expect(400);
  });

  it('refuses edits from people without organisation edit', async () => {
    await (await as('u4')).put('/organisation', { name: 'Mine now' }).expect(403);
  });

  it('writes an audit entry with before and after', async () => {
    await (await as('u1')).put('/organisation', { name: 'Kidzonia Schools' }).expect(200);
    const entry = await t.prisma.auditLog.findFirstOrThrow({
      where: { action: 'organisation.updated', organisationId: t.demo.organisationId },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry.before).toEqual({ name: 'Kidzonia Pre-schools' });
    expect(entry.after).toEqual({ name: 'Kidzonia Schools' });
    await (await as('u1')).put('/organisation', { name: 'Kidzonia Pre-schools' }).expect(200);
  });
});

describe('setup checklist', () => {
  it('ticks itself from live data and can be hidden', async () => {
    const owner = await as('u1');
    const res = await owner.get('/organisation/checklist').expect(200);
    const byKey = Object.fromEntries(
      (res.body.items as { key: string; done: boolean }[]).map((i) => [i.key, i.done]),
    );
    expect(byKey).toEqual({
      schools: true,
      roles: false,
      users: true,
      give_roles: false,
      first_task: false,
    });
    expect(res.body.dismissed).toBe(false);
    await owner.post('/organisation/checklist/dismiss').expect(204);
    expect((await owner.get('/organisation/checklist')).body.dismissed).toBe(true);
    await (await as('u9')).get('/organisation/checklist').expect(403);
  });
});

describe('holidays', () => {
  it('adds, lists, edits and removes holidays', async () => {
    const owner = await as('u1');
    const created = await owner
      .post('/holidays', {
        name: 'Diwali break',
        startDate: '2026-11-08',
        endDate: '2026-11-10',
        schoolIds: [],
      })
      .expect(201);
    expect(created.body).toMatchObject({
      name: 'Diwali break',
      startDate: '2026-11-08',
      endDate: '2026-11-10',
      schoolIds: [],
    });
    const oneDay = await owner
      .post('/holidays', {
        name: 'Founders day',
        startDate: '2026-12-01',
        schoolIds: [t.demo.schools.jh],
      })
      .expect(201);
    expect(oneDay.body.endDate).toBe('2026-12-01');

    const list = await owner.get('/holidays?year=2026&limit=1').expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.nextCursor).toBeTruthy();

    await owner.put(`/holidays/${oneDay.body.id as string}`, { endDate: '2026-11-30' }).expect(400);
    const edited = await owner
      .put(`/holidays/${oneDay.body.id as string}`, { schoolIds: [] })
      .expect(200);
    expect(edited.body.schoolIds).toEqual([]);
    await owner.delete(`/holidays/${created.body.id as string}`).expect(204);
    await owner.put(`/holidays/${created.body.id as string}`, { name: 'x' }).expect(404);
  });

  it('refuses another organisation’s school', async () => {
    await (
      await as('u1')
    )
      .post('/holidays', { name: 'X', startDate: '2026-12-02', schoolIds: [t.second.schools.mp] })
      .expect(404);
  });

  it('needs organisation edit to change and view to read', async () => {
    await (
      await as('u4')
    )
      .post('/holidays', { name: 'X', startDate: '2026-12-02', schoolIds: [] })
      .expect(403);
    await (await as('u4')).get('/holidays').expect(200);
    await (await as('u9')).get('/holidays').expect(403);
  });
});

describe('logo upload (addition g)', () => {
  let upload: (
    body: Buffer,
    contentType?: string,
  ) => ReturnType<Awaited<ReturnType<typeof as>>['postRaw']>;
  beforeAll(async () => {
    const owner = await as('u1');
    upload = (body, contentType = 'image/png') =>
      owner.postRaw('/organisation/logo', body, contentType);
  });

  it('accepts a real image, strips its metadata, and serves it safely', async () => {
    const jpeg = await sharp({
      create: { width: 40, height: 20, channels: 3, background: '#1a63c6' },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-device-info', Artist: 'Someone' } } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();

    // Declared as PNG on purpose: the declared type is ignored.
    const res = await upload(jpeg, 'image/png').expect(200);
    expect(res.body.logoUrl).toMatch(/^\/api\/organisation\/logo\?v=/);

    const got = await (await as('u9')).get('/organisation/logo').buffer(true).expect(200);
    expect(got.headers['content-type']).toBe('image/jpeg');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(got.headers['content-security-policy']).toContain("default-src 'none'");
    const meta = await sharp(got.body as Buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe('jpeg');
  });

  it('rejects SVG, even named as an image', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const res = await upload(svg, 'image/png').expect(400);
    expect(res.body.error.message).toMatch(/PNG, JPEG or WebP/);
  });

  it('rejects files that only pretend to be images', async () => {
    const fake = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('not really'),
    ]);
    await upload(fake).expect(400);
    await upload(Buffer.from('GIF89a....')).expect(400);
  });

  it('rejects files over 2 MB', async () => {
    await upload(Buffer.alloc(2 * 1024 * 1024 + 10, 1)).expect(400);
  });

  it('needs organisation edit to upload or remove', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    await (await as('u4')).postRaw('/organisation/logo', png, 'image/png').expect(403);
    await (await as('u4')).delete('/organisation/logo').expect(403);
    await (await as('u1')).delete('/organisation/logo').expect(204);
    await (await as('u1')).get('/organisation/logo').expect(404);
  });
});
