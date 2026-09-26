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

const names = (body: { items: { name?: string }[] }) => body.items.map((s) => s.name);

describe('schools list', () => {
  it('shows every school to people who look after all schools, with details', async () => {
    const res = await (await as('u1')).get('/schools').expect(200);
    expect(names(res.body)).toEqual(['Gachibowli', 'Jubilee Hills', 'Kokapet', 'Kondapur']);
    const kp = (res.body.items as Record<string, unknown>[]).find((s) => s.name === 'Kondapur');
    expect(kp).toMatchObject({
      type: 'franchise',
      franchiseOwnerName: 'Suresh Reddy',
      peopleCount: 4,
    });
  });

  it('shows a franchise owner only their own schools', async () => {
    const res = await (await as('u4')).get('/schools').expect(200);
    expect(names(res.body)).toEqual(['Kokapet', 'Kondapur']);
  });

  it('paginates', async () => {
    const page1 = await (await as('u1')).get('/schools?limit=2').expect(200);
    expect(page1.body.items).toHaveLength(2);
    const page2 = await (
      await as('u1')
    )
      .get(`/schools?limit=2&cursor=${page1.body.nextCursor as string}`)
      .expect(200);
    expect(names(page2.body)).toEqual(['Kokapet', 'Kondapur']);
  });

  it('answers 404 for schools outside someone’s scope', async () => {
    await (await as('u4')).get(`/schools/${t.demo.schools.jh}`).expect(404);
    await (await as('u9')).get('/schools').expect(403);
  });
});

describe('adding and editing schools', () => {
  it('adds a COCO school with a principal', async () => {
    const res = await (
      await as('u1')
    )
      .post('/schools', {
        name: 'Madhapur',
        city: 'Hyderabad',
        type: 'coco',
        principalUserId: t.demo.users.u7,
      })
      .expect(201);
    expect(res.body).toMatchObject({
      name: 'Madhapur',
      principalName: 'Arjun Das',
      peopleCount: 0,
    });
    await (
      await as('u1')
    )
      .post('/schools', { name: 'madhapur', city: 'X', type: 'coco' })
      .expect(409);
  });

  it('adds a franchise school and invites its owner with a role', async () => {
    const res = await (
      await as('u1')
    )
      .post('/schools', {
        name: 'Manikonda',
        city: 'Hyderabad',
        type: 'franchise',
        inviteOwner: {
          fullName: 'Lata Iyer',
          mobile: '97000 11122',
          roleId: t.demo.roles.franchise_owner,
        },
      })
      .expect(201);
    expect(res.body.franchiseOwnerName).toBe('Lata Iyer');
    expect(t.messages.invites.at(-1)?.mobile).toBe('+919700011122');
  });

  it('keeps COCO schools without franchise owners', async () => {
    const res = await (
      await as('u1')
    )
      .post('/schools', {
        name: 'Nope',
        city: 'X',
        type: 'coco',
        franchiseOwnerUserId: t.demo.users.u4,
      })
      .expect(422);
    expect(res.body.error.fields.franchiseOwnerUserId).toBeTruthy();
  });

  it('refuses people from another organisation', async () => {
    await (
      await as('u1')
    )
      .post('/schools', {
        name: 'Cross',
        city: 'X',
        type: 'coco',
        principalUserId: t.second.users.s1,
      })
      .expect(422);
  });

  it('edits part of a school and validates the merged record', async () => {
    const owner = await as('u1');
    const res = await owner
      .put(`/schools/${t.demo.schools.gb}`, { opensAt: '07:30', closesAt: '14:30' })
      .expect(200);
    expect(res.body).toMatchObject({ opensAt: '07:30', closesAt: '14:30' });
    await owner.put(`/schools/${t.demo.schools.gb}`, { closesAt: '07:00' }).expect(422);
    // Kondapur has a franchise owner, so it can't just become COCO.
    await owner.put(`/schools/${t.demo.schools.kp}`, { type: 'coco' }).expect(422);
  });

  it('needs schools permissions', async () => {
    await (await as('u2')).post('/schools', { name: 'X', city: 'X', type: 'coco' }).expect(403);
    await (await as('u2')).put(`/schools/${t.demo.schools.gb}`, { city: 'Y' }).expect(403);
    await (await as('u2')).get('/schools').expect(200);
  });

  it('refuses to delete a school people still work at', async () => {
    const res = await (await as('u1')).delete(`/schools/${t.demo.schools.gb}`).expect(409);
    expect(res.body.error.message).toMatch(/work at Gachibowli/);
  });

  it('deletes an empty school', async () => {
    const created = await (
      await as('u1')
    )
      .post('/schools', { name: 'Temporary', city: 'X', type: 'coco' })
      .expect(201);
    await (await as('u1')).delete(`/schools/${created.body.id as string}`).expect(204);
    await (await as('u1')).get(`/schools/${created.body.id as string}`).expect(404);
  });
});
