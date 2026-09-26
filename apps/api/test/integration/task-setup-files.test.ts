import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, people } from '../support/app.js';
import type { TestApp } from '../support/app.js';
import {
  atLocal,
  docm,
  docx,
  oldDoc,
  pdf,
  pdfWithHiddenScript,
  phonePhoto,
  xlsx,
} from '../support/tasks.js';

/** Task setup (brief 9.9, 9.10) and task photos and files (addition g, decision 4). */

let t: TestApp;
const as = people(() => t);
const u = (k: string) => t.demo.users[k] ?? '';

beforeAll(async () => {
  t = await createTestApp();
  atLocal(t, '07:00');
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.prisma.rateLimit.deleteMany();
});

type Body = Record<string, unknown>;

describe('task setup masters', () => {
  it('lets only task_setup change them ("+ New" permission)', async () => {
    await (
      await as('u5')
    )
      .post('/task-setup/categories', { name: 'Hygiene', color: '#123456' })
      .expect(403);
    const made = await (
      await as('u1')
    )
      .post('/task-setup/categories', { name: 'Hygiene', color: '#123456' })
      .expect(201);
    expect(made.body.name).toBe('Hygiene');
    const clash = await (
      await as('u1')
    )
      .post('/task-setup/categories', { name: 'hygiene', color: '#654321' })
      .expect(409);
    expect(clash.body.error.message).toBe('A category with that name already exists.');
    await (await as('u1')).post('/task-setup/categories', { name: 'X', color: 'red' }).expect(400);
  });

  it('edits with the merged record and archives on delete, keeping old tasks intact', async () => {
    const safety = t.tasks.categories.Safety ?? '';
    await (
      await as('u1')
    )
      .put(`/task-setup/categories/${safety}`, { color: '#aa0000' })
      .expect(200);
    await (await as('u1')).delete(`/task-setup/categories/${safety}`).expect(204);
    const setup = await (await as('u1')).get('/task-setup').expect(200);
    expect(setup.body.categories.map((c: Body) => c.name)).not.toContain('Safety');
    const t3 = await (await as('u5')).get(`/tasks/${t.tasks.tasks.t3 ?? ''}`).expect(200);
    expect(t3.body.category).toMatchObject({ name: 'Safety', color: '#aa0000' });
    await (await as('u1')).delete(`/task-setup/categories/${safety}`).expect(404);
  });

  it('reorders priorities, needing every one exactly once', async () => {
    const ids = Object.values(t.tasks.priorities);
    await (await as('u1')).put('/task-setup/priorities/order', { ids: ids.slice(1) }).expect(400);
    const res = await (
      await as('u1')
    )
      .put('/task-setup/priorities/order', { ids: [...ids].reverse() })
      .expect(200);
    expect(res.body.priorities.map((p: Body) => p.name)).toEqual([
      'Low',
      'Medium',
      'High',
      'Urgent',
    ]);
  });

  it('adds lists and values, which join the registry', async () => {
    const list = await (
      await as('u1')
    )
      .post('/task-setup/lists', { name: 'Task type' })
      .expect(201);
    await (
      await as('u1')
    )
      .post(`/task-setup/lists/${list.body.id as string}/values`, { value: 'Cleaning' })
      .expect(201);
    const me = await (await as('u8')).get('/me').expect(200);
    expect(me.body.customLists.map((l: Body) => l.name)).toEqual(['Area', 'Task type']);
    await (await as('u1')).delete(`/task-setup/lists/${list.body.id as string}`).expect(204);
    const after = await (await as('u8')).get('/me').expect(200);
    expect(after.body.customLists.map((l: Body) => l.name)).toEqual(['Area']);
  });

  it('keeps parent message templates', async () => {
    const res = await (
      await as('u1')
    )
      .post('/task-setup/message-templates', {
        name: 'Trip',
        body: 'Dear parent, {class_name} goes to the zoo.',
      })
      .expect(201);
    await (
      await as('u1')
    )
      .put(`/task-setup/message-templates/${res.body.id as string}`, { name: 'Zoo trip' })
      .expect(200);
    const setup = await (await as('u8')).get('/task-setup').expect(200);
    expect(setup.body.messageTemplates.map((m: Body) => m.name)).toContain('Zoo trip');
  });
});

describe('task templates (brief 9.10)', () => {
  it('strips people and fixed dates on save, whatever is sent', async () => {
    const res = await (
      await as('u1')
    )
      .post('/task-setup/templates', {
        name: 'Fire drill',
        payload: {
          title: 'Fire drill',
          target: { userIds: [u('u8')] },
          watchers: [{ userId: u('u2'), access: 'view' }],
          approverMode: 'named_user',
          approverUserId: u('u2'),
          dueType: 'on_date',
          dueDate: '2026-12-01',
          repeatStartDate: '2026-12-01',
          subtasks: [{ title: 'Ring the bell', assigneeUserId: u('u9') }],
        },
      })
      .expect(201);
    const stored = await t.prisma.taskTemplate.findUniqueOrThrow({
      where: { id: res.body.id as string },
    });
    const payload = stored.payload as Body;
    for (const k of ['target', 'watchers', 'approverUserId', 'dueDate', 'repeatStartDate']) {
      expect(payload).not.toHaveProperty(k);
    }
    expect(payload.approverMode).toBe('creator');
    expect(payload.subtasks).toEqual([{ title: 'Ring the bell' }]);
  });

  it('is used by anyone who can create tasks, and managed only in Task setup', async () => {
    const list = await (await as('u2')).get('/task-setup/templates').expect(200);
    expect(list.body.items.map((i: Body) => i.name)).toEqual(
      expect.arrayContaining(['Classroom safety check', 'Weekly lesson plan', 'Event preparation']),
    );
    await (await as('u2')).post('/task-setup/templates', { name: 'Mine', payload: {} }).expect(403);
    await (await as('u8')).get('/task-setup/templates').expect(403);
  });

  it('never changes tasks made from it', async () => {
    const tpl = (await (await as('u1')).get('/task-setup/templates').expect(200)).body.items.find(
      (i: Body) => i.name === 'Weekly lesson plan',
    ) as Body;
    const task = await (
      await as('u5')
    )
      .post('/tasks', {
        ...(tpl.payload as Body),
        target: { userIds: [u('u8')] },
        fromTemplateId: tpl.id,
      })
      .expect(201);
    await (
      await as('u1')
    )
      .put(`/task-setup/templates/${tpl.id as string}`, { payload: { title: 'Renamed plan' } })
      .expect(200);
    await (await as('u1')).delete(`/task-setup/templates/${tpl.id as string}`).expect(204);
    const after = await (await as('u5')).get(`/tasks/${task.body.id as string}`).expect(200);
    expect(after.body.title).toBe('Submit weekly lesson plan');
    expect(after.body.subtasks).toHaveLength(2);
  });
});

describe('photos and files', () => {
  let copyId = '';

  beforeAll(async () => {
    const res = await (
      await as('u5')
    )
      .post('/tasks', {
        title: 'Upload things',
        target: { userIds: [u('u8')] },
        needsApproval: true,
      })
      .expect(201);
    copyId = (
      await t.prisma.taskAssignment.findFirstOrThrow({ where: { taskId: res.body.id as string } })
    ).id;
  });

  const upload = (who: string, data: Buffer, name = 'file') => ({
    expect: async (status: number) =>
      (await as(who))
        .postRaw(
          `/assignments/${copyId}/attachments?name=${encodeURIComponent(name)}`,
          data,
          'application/octet-stream',
        )
        .expect(status),
  });

  it('shrinks phone photos and strips GPS and camera details', async () => {
    const res = await upload('u8', await phonePhoto(), 'IMG_1234.HEIC.jpg').expect(201);
    expect(res.body.status).toBe('in_progress');
    const att = res.body.attachments[0] as Body;
    expect(att).toMatchObject({
      fileName: 'IMG_1234.HEIC.jpg',
      contentType: 'image/jpeg',
      isImage: true,
    });
    const file = await (await as('u8')).get(`/attachments/${att.id as string}`).expect(200);
    expect(file.headers['content-disposition']).toMatch(/^inline/);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    const meta = await sharp(file.body as Buffer).metadata();
    expect(Math.max(meta.width, meta.height)).toBe(2000);
    expect(meta.exif).toBeUndefined();
  });

  it('accepts PDFs, Word and Excel, and names them by their real type', async () => {
    const p = await upload('u8', pdf(), 'plan.pdf').expect(201);
    const w = await upload('u8', docx(), 'lesson.docx').expect(201);
    const x = await upload('u8', xlsx(), 'marks.xlsx').expect(201);
    const names = (x.body.attachments as Body[]).map((a) => a.fileName);
    expect(names).toEqual(expect.arrayContaining(['plan.pdf', 'lesson.docx', 'marks.xlsx']));
    const doc = (w.body.attachments as Body[]).find((a) => a.fileName === 'lesson.docx') as Body;
    const file = await (await as('u8')).get(`/attachments/${doc.id as string}`).expect(200);
    // Office files always download, never preview.
    expect(file.headers['content-disposition']).toMatch(/^attachment/);
    expect(p.status).toBe(201);
    const renamed = await upload('u8', docx(), 'sneaky.svg').expect(201);
    expect((renamed.body.attachments as Body[]).map((a) => a.fileName)).toContain('sneaky.docx');
  });

  it('refuses SVG, HTML, scripts in PDFs, macros and old Office formats', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect((await upload('u8', svg).expect(400)).body.error.message).toContain('Upload a photo');
    await upload('u8', Buffer.from('<html><script>alert(1)</script></html>')).expect(400);
    const js = await upload('u8', pdf('/OpenAction << /S /JavaScript /JS (x) >>')).expect(400);
    expect(js.body.error.message).toContain('scripts');
    await upload('u8', pdfWithHiddenScript()).expect(400);
    const macro = await upload('u8', docm(), 'plan.docm').expect(400);
    expect(macro.body.error.message).toContain('macros');
    const old = await upload('u8', oldDoc(), 'plan.doc').expect(400);
    expect(old.body.error.message).toContain('.doc');
  });

  it('lets only the person doing the task add files, and only people who see it open them', async () => {
    await upload('u5', pdf()).expect(403); // the approver
    await upload('u9', pdf()).expect(404); // can't see it
    const detail = await (await as('u5')).get(`/assignments/${copyId}`).expect(200);
    const id = (detail.body.attachments as Body[])[0]?.id as string;
    await (await as('u5')).get(`/attachments/${id}`).expect(200);
    await (await as('u9')).get(`/attachments/${id}`).expect(404);
    await (await as('u13')).get(`/attachments/${id}`).expect(404);
  });

  it('lets the uploader remove a file while the task is open', async () => {
    const detail = await (await as('u8')).get(`/assignments/${copyId}`).expect(200);
    const id = (detail.body.attachments as Body[]).at(-1)?.id as string;
    await (await as('u5')).delete(`/assignments/${copyId}/attachments/${id}`).expect(403);
    const res = await (
      await as('u8')
    )
      .delete(`/assignments/${copyId}/attachments/${id}`)
      .expect(200);
    expect((res.body.attachments as Body[]).map((a) => a.id)).not.toContain(id);
  });

  it('caps files per task', async () => {
    const existing = await t.prisma.taskAttachment.count({ where: { assignmentId: copyId } });
    for (let i = existing; i < 10; i++) await upload('u8', pdf()).expect(201);
    const res = await upload('u8', pdf()).expect(422);
    expect(res.body.error.message).toBe('A task can have up to 10 photos and files.');
  });
});

describe('the demo’s files', () => {
  it('are real files that open', async () => {
    const copy = await t.prisma.taskAssignment.findFirstOrThrow({
      where: { taskId: t.tasks.tasks.t3 ?? '', userId: u('u9') },
    });
    const detail = await (await as('u5')).get(`/assignments/${copy.id}`).expect(200);
    const att = (detail.body.attachments as Body[])[0] as Body;
    expect(att.fileName).toBe('Room_KG1.jpg');
    await (await as('u5')).get(`/attachments/${att.id as string}`).expect(200);
  });
});
