import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, people } from '../support/app.js';
import type { TestApp } from '../support/app.js';

/**
 * Parent contacts (Phase 6, open decision 13.1 answered): classes per school,
 * a CSV upload per school with a row-by-row preview, consent that only an
 * explicit re-mark can undo, full deletion, and numbers that never reach logs.
 */

let t: TestApp;
const as = people(() => t);
const u = (k: string) => t.demo.users[k] ?? '';
const role = (k: string) => t.demo.roles[k] ?? '';
const jh = () => t.demo.schools.jh ?? '';
const kp = () => t.demo.schools.kp ?? '';

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.prisma.rateLimit.deleteMany();
});

type Body = Record<string, unknown>;
const HEADER = 'Class,Student name,Parent name,Parent mobile,Agreed to messages';
const csv = (...rows: string[]) => Buffer.from([HEADER, ...rows].join('\n'));

async function upload(key: string, schoolId: string, body: Buffer, preview: boolean, status = 200) {
  return (await as(key))
    .postRaw(
      `/parent-contacts/import${preview ? '/preview' : ''}?schoolId=${schoolId}`,
      body,
      'text/csv',
    )
    .expect(status);
}
const auditText = async () =>
  JSON.stringify(
    await t.prisma.auditLog.findMany({ where: { action: { startsWith: 'parent_' } } }),
  );

describe('classes', () => {
  it('lists a school’s classes with children and agreed parents, and edits the list', async () => {
    const owner = await as('u1');
    const list = await owner.get(`/parent-contacts/classes?schoolId=${jh()}`).expect(200);
    const nurseryA = (list.body.items as Body[]).find((c) => c.name === 'Nursery A');
    // Seeded: five children, three agreed parents (one opted out, one not agreed).
    expect(nurseryA).toMatchObject({ students: 5, agreedParents: 3 });
    const made = await owner
      .post('/parent-contacts/classes', { schoolId: jh(), name: 'Daycare' })
      .expect(201);
    await owner.post('/parent-contacts/classes', { schoolId: jh(), name: 'daycare' }).expect(409);
    await owner.delete(`/parent-contacts/classes/${nurseryA?.id as string}`).expect(422);
    await owner.delete(`/parent-contacts/classes/${made.body.id as string}`).expect(204);
  });

  it('lists only the schools in the person’s scope', async () => {
    const meera = await (await as('u5')).get('/parent-contacts/schools').expect(200);
    expect((meera.body.items as Body[]).map((s) => s.name)).toEqual(['Jubilee Hills']);
    const owner = await (await as('u1')).get('/parent-contacts/schools').expect(200);
    expect(owner.body.items).toHaveLength(4);
  });

  it('keeps to the person’s schools', async () => {
    await (await as('u6')).get(`/parent-contacts/classes?schoolId=${jh()}`).expect(404);
    await (await as('u5')).get(`/parent-contacts/classes?schoolId=${jh()}`).expect(200);
    await (await as('u8')).get(`/parent-contacts/classes?schoolId=${jh()}`).expect(403);
  });
});

describe('the contact list', () => {
  it('shows children, parents, numbers and consent to people who may see them', async () => {
    const res = await (await as('u5')).get(`/parent-contacts?schoolId=${jh()}`).expect(200);
    const aarav = (res.body.items as Body[]).find((r) => r.studentName === 'Aarav Kumar');
    expect(aarav).toMatchObject({
      parentName: 'Neha Kumar',
      parentMobile: '99999 00001',
      consent: 'agreed',
    });
  });

  it('leaves out numbers a role hides, and can’t be searched by them', async () => {
    await t.prisma.roleFieldPermission.create({
      data: {
        organisationId: t.demo.organisationId,
        roleId: role('principal'),
        moduleKey: 'parent_contacts',
        fieldKey: 'parentMobile',
        access: 'hidden',
      },
    });
    try {
      const res = await (await as('u5')).get(`/parent-contacts?schoolId=${jh()}`).expect(200);
      expect(JSON.stringify(res.body)).not.toContain('99999');
      const search = await (
        await as('u5')
      )
        .get(`/parent-contacts?schoolId=${jh()}&q=00001`)
        .expect(200);
      expect(search.body.items).toEqual([]);
      // Without seeing numbers, they can't upload them either.
      await upload('u5', jh(), csv('Nursery A,New Child,New Parent,9848077701,yes'), true, 403);
    } finally {
      await t.prisma.roleFieldPermission.deleteMany({
        where: { roleId: role('principal'), moduleKey: 'parent_contacts' },
      });
    }
  });
});

describe('CSV upload', () => {
  it('previews every row with its errors and what it would do, saving nothing', async () => {
    const before = await t.prisma.guardian.count();
    const res = await upload(
      'u1',
      jh(),
      csv(
        'Nursery A,Aarav Kumar,Neha Kumar,99999 00001,yes', // unchanged
        'Nursery A,Diya Reddy,Kiran R. Reddy,99999 00002,yes', // parent renamed
        'Nursery A,Saanvi Joshi,Rekha Joshi,99999 00005,yes', // opted out: stays opted out
        'Nursery B,Kabir Shah,Pooja Shah,98480 77702,yes', // new
        'Nursery Z,Tara Iyer,Anil Iyer,98480 77703,yes', // unknown class
        'Nursery B,Kabir Shah,Pooja Shah,98480 77702,yes', // duplicate
        'Nursery B,Om Das,Ravi Das,12345,yes', // bad number
      ),
      true,
    );
    const rows = res.body.rows as Body[];
    expect(rows.map((r) => r.action)).toEqual([
      'unchanged',
      'update',
      'keeps_opt_out',
      'new',
      null,
      null,
      null,
    ]);
    expect(rows[1]?.notes).toEqual([
      'The parent’s name changes from Kiran Reddy to Kiran R. Reddy.',
    ]);
    expect(rows[2]?.notes).toEqual([
      'This parent opted out. They stay opted out until someone re-marks them.',
    ]);
    expect(rows[4]?.errors).toEqual(['There’s no class “Nursery Z” at this school. Add it first.']);
    expect(rows[5]?.errors).toEqual(['Same child and parent as row 5.']);
    expect(rows[6]?.errors).toEqual(['The parent mobile isn’t a valid number.']);
    expect(res.body.summary).toMatchObject({
      rows: 7,
      valid: 4,
      withErrors: 3,
      new: 1,
      updated: 1,
      unchanged: 2,
    });
    expect(await t.prisma.guardian.count()).toBe(before);
  });

  it('imports the good rows, never undoes an opt-out, and audits counts only', async () => {
    const res = await upload(
      'u1',
      jh(),
      csv(
        'Nursery B,Kabir Shah,Pooja Shah,98480 77702,yes',
        'Nursery B,Kabir Shah,Arjun Shah,98480 77704,no',
        'Nursery A,Saanvi Joshi,Rekha Joshi,99999 00005,yes',
        'Nursery Z,Tara Iyer,Anil Iyer,98480 77703,yes',
      ),
      false,
    );
    expect(res.body).toEqual({ imported: 3, skipped: 1, students: 1, parents: 2 });
    const kabir = await t.prisma.student.findFirstOrThrow({
      where: { fullName: 'Kabir Shah' },
      include: { guardians: { include: { guardian: true } } },
    });
    expect(kabir.guardians.map((g) => [g.guardian.fullName, g.guardian.consent]).sort()).toEqual([
      ['Arjun Shah', 'not_agreed'],
      ['Pooja Shah', 'agreed'],
    ]);
    const rekha = await t.prisma.guardian.findFirstOrThrow({ where: { mobile: '+919999900005' } });
    expect(rekha.consent).toBe('opted_out');
    const entry = await t.prisma.auditLog.findFirstOrThrow({
      where: { action: 'parent_contacts.imported' },
    });
    expect(entry.after).toMatchObject({
      rows: 4,
      imported: 3,
      skipped: 1,
      newChildren: 1,
      newParents: 2,
    });
    expect(await auditText()).not.toMatch(/77702|77704|99999/);
  });

  it('explains a file without the right columns', async () => {
    const res = await (
      await as('u1')
    )
      .postRaw(
        `/parent-contacts/import/preview?schoolId=${jh()}`,
        Buffer.from('Name,Phone\nA,1'),
        'text/csv',
      )
      .expect(200);
    expect(res.body.problems[0]).toMatch(/must name the columns/);
    await (
      await as('u1')
    )
      .postRaw(
        `/parent-contacts/import?schoolId=${jh()}`,
        Buffer.from('Name,Phone\nA,1'),
        'text/csv',
      )
      .expect(400);
  });

  it('only for schools in the person’s scope', async () => {
    await upload('u6', jh(), csv('Nursery A,X,Y,9848077709,yes'), true, 404);
    await upload('u6', kp(), csv('KG 2,X,Y,9848077709,yes'), true, 200);
  });
});

describe('consent and deleting', () => {
  it('opting out is audited, and only a deliberate re-mark undoes it', async () => {
    const kiran = await t.prisma.guardian.findFirstOrThrow({ where: { mobile: '+919999900002' } });
    const meera = await as('u5');
    await meera
      .put(`/parent-contacts/guardians/${kiran.id}/consent`, { consent: 'opted_out' })
      .expect(204);
    const out = await t.prisma.auditLog.findFirstOrThrow({
      where: { action: 'parent_contact.opted_out', entityId: kiran.id },
    });
    expect(out).toMatchObject({ before: { consent: 'agreed' }, after: { consent: 'opted_out' } });
    // An upload saying "yes" keeps them opted out...
    await upload('u1', jh(), csv('Nursery A,Diya Reddy,Kiran R. Reddy,99999 00002,yes'), false);
    expect((await t.prisma.guardian.findUniqueOrThrow({ where: { id: kiran.id } })).consent).toBe(
      'opted_out',
    );
    // ...until someone re-marks them.
    await meera
      .put(`/parent-contacts/guardians/${kiran.id}/consent`, { consent: 'agreed' })
      .expect(204);
    expect((await t.prisma.guardian.findUniqueOrThrow({ where: { id: kiran.id } })).consent).toBe(
      'agreed',
    );
    // Someone in another school can't touch them.
    await (
      await as('u6')
    )
      .put(`/parent-contacts/guardians/${kiran.id}/consent`, { consent: 'opted_out' })
      .expect(404);
  });

  it('deletes a parent completely, with any child left without a parent', async () => {
    const pooja = await t.prisma.guardian.findFirstOrThrow({ where: { mobile: '+919848077702' } });
    const arjun = await t.prisma.guardian.findFirstOrThrow({ where: { mobile: '+919848077704' } });
    const owner = await as('u1');
    await owner.delete(`/parent-contacts/guardians/${pooja.id}`).expect(204);
    expect(await t.prisma.guardian.count({ where: { mobile: '+919848077702' } })).toBe(0);
    // Kabir still has Arjun, so he stays; removing Arjun removes Kabir too.
    expect(await t.prisma.student.count({ where: { fullName: 'Kabir Shah' } })).toBe(1);
    await owner.delete(`/parent-contacts/guardians/${arjun.id}`).expect(204);
    expect(await t.prisma.student.count({ where: { fullName: 'Kabir Shah' } })).toBe(0);
    expect(await auditText()).not.toMatch(/77702|77704/);
    // Teachers can't delete contacts.
    const any = await t.prisma.guardian.findFirstOrThrow();
    await (await as('u8')).delete(`/parent-contacts/guardians/${any.id}`).expect(403);
  });

  it('suggests class names to anyone who creates tasks', async () => {
    const res = await (await as('u5')).get('/parent-contacts/class-names').expect(200);
    expect(res.body.items).toEqual(expect.arrayContaining(['Nursery A', 'KG 2']));
    await (await as('u8')).get('/parent-contacts/class-names').expect(403);
    expect(u('u8')).not.toBe('');
  });
});
