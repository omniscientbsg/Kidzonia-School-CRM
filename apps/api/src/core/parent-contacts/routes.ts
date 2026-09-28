import express from 'express';
import type { Request } from 'express';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import {
  classInputSchema,
  classUpdateSchema,
  consentInputSchema,
  contactListQuerySchema,
  fieldView,
  formatMobile,
  idSchema,
  maskMobile,
  parseContactsCsv,
} from '@kidzonia/shared';
import type { Access, Consent, ContactCsvRow, ImportPreview, RecordFacts } from '@kidzonia/shared';
import { mapDbError, withUnitOfWork } from '../../db/index.js';
import type { Prisma, ScopedTx } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import type { AuthInfo } from '../../http/types.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { businessRule, conflict, invalidInput, notFound } from '../../lib/errors.js';
import { checkWritableFields, requireModule, requireWritable } from '../guards.js';
import { authOf } from '../users/routes.js';

/**
 * Parent contacts (Phase 6, open decision 13.1): classes per school, children
 * and their parents, filled from a CSV per school. Only parents marked as
 * agreed are ever messaged; an opt-out sticks until someone deliberately
 * re-marks the parent (audited). Parents' numbers are personal data: they are
 * shown only here (and only to roles that can see the field), never in logs,
 * audit entries, exports or the message log, and deleting a parent removes the
 * number completely.
 */

const MODULE = 'parent_contacts';
const CSV_MAX_BYTES = 2 * 1024 * 1024;
const FIELDS = ['studentName', 'parentName', 'parentMobile', 'consent'] as const;

const facts = (schoolId: string): RecordFacts => ({ subjectUserIds: [], schoolIds: [schoolId] });
const idParam = (req: Request) => parse(z.object({ id: idSchema }), req.params).id;

/** Schools in someone's scope (like the Schools page); in a preview, both people's. */
function seesSchool(access: Access, schoolId: string): boolean {
  return access.contexts.every(
    (c) => c.role?.isOwner === true || c.scope.allSchools || c.scope.schoolIds.includes(schoolId),
  );
}

async function visibleSchool(db: ScopedTx, access: Access, schoolId: string) {
  const school = await db.school.findFirst({
    where: { id: schoolId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!school || !seesSchool(access, schoolId)) throw notFound('That school');
  return school;
}

/** A parent is reachable through any child at a school the person can see. */
async function visibleGuardian(db: ScopedTx, access: Access, guardianId: string) {
  const g = await db.guardian.findFirst({
    where: { id: guardianId },
    select: {
      id: true,
      consent: true,
      students: { select: { studentId: true, student: { select: { schoolId: true } } } },
    },
  });
  const schools = g ? [...new Set(g.students.map((s) => s.student.schoolId))] : [];
  if (!g || !schools.some((s) => seesSchool(access, s))) throw notFound('That parent');
  return { ...g, schoolId: schools.find((s) => seesSchool(access, s)) ?? '' };
}

// ---------- CSV import ----------

interface Plan {
  preview: ImportPreview['rows'];
  classes: Map<string, string>;
  students: Map<string, string>;
  guardians: Map<string, { id: string; fullName: string; consent: Consent }>;
  links: Set<string>;
}

const studentKey = (classId: string, name: string) => `${classId}|${name.trim().toLowerCase()}`;

/**
 * What an upload would do, row by row, from one read of the database: which
 * rows are new, which change a parent, which change nothing, and why a row
 * can't be saved. The preview shows this; the import applies the same plan.
 */
async function planImport(
  db: ScopedTx,
  schoolId: string,
  rows: ContactCsvRow[],
  showMobile: boolean,
): Promise<Plan> {
  const classRows = await db.schoolClass.findMany({
    where: { schoolId },
    select: { id: true, name: true },
  });
  const classes = new Map(classRows.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const mobiles = [...new Set(rows.map((r) => r.mobile).filter((m): m is string => m !== null))];
  const [guardianRows, studentRows] = await Promise.all([
    mobiles.length
      ? db.guardian.findMany({
          where: { mobile: { in: mobiles } },
          select: { id: true, mobile: true, fullName: true, consent: true },
        })
      : Promise.resolve([]),
    classRows.length
      ? db.student.findMany({
          where: { classId: { in: classRows.map((c) => c.id) } },
          select: { id: true, classId: true, fullName: true },
        })
      : Promise.resolve([]),
  ]);
  const guardians = new Map(guardianRows.map((g) => [g.mobile, g]));
  const students = new Map(studentRows.map((s) => [studentKey(s.classId, s.fullName), s.id]));
  const linkRows =
    studentRows.length && guardianRows.length
      ? await db.studentGuardian.findMany({
          where: {
            studentId: { in: studentRows.map((s) => s.id) },
            guardianId: { in: guardianRows.map((g) => g.id) },
          },
          select: { studentId: true, guardianId: true },
        })
      : [];
  const links = new Set(linkRows.map((l) => `${l.studentId}|${l.guardianId}`));

  const preview = rows.map((r) => {
    const errors = [...r.errors];
    const notes: string[] = [];
    const classId = classes.get(r.className.trim().toLowerCase());
    if (r.className && !classId) {
      errors.push(`There’s no class “${r.className}” at this school. Add it first.`);
    }
    let action: ImportPreview['rows'][number]['action'] = null;
    if (errors.length === 0 && classId && r.mobile) {
      const g = guardians.get(r.mobile);
      const sId = students.get(studentKey(classId, r.studentName));
      const linked = g && sId ? links.has(`${sId}|${g.id}`) : false;
      const renamed = g !== undefined && g.fullName !== r.parentName;
      if (renamed) notes.push(`The parent’s name changes from ${g.fullName} to ${r.parentName}.`);
      let consentChanges = false;
      if (g?.consent === 'opted_out') {
        if (r.agreed) {
          notes.push('This parent opted out. They stay opted out until someone re-marks them.');
        }
      } else if (g && (g.consent === 'agreed') !== r.agreed) {
        consentChanges = true;
        notes.push(r.agreed ? 'Now agreed to messages.' : 'No longer agreed to messages.');
      }
      action = !linked
        ? 'new'
        : renamed || consentChanges
          ? 'update'
          : g?.consent === 'opted_out' && r.agreed
            ? 'keeps_opt_out'
            : 'unchanged';
    }
    return {
      line: r.line,
      className: r.className,
      studentName: r.studentName,
      parentName: r.parentName,
      ...(showMobile ? { parentMobile: r.mobile ? formatMobile(r.mobile) : null } : {}),
      agreed: r.agreed,
      action,
      errors,
      notes,
    };
  });
  return { preview, classes, students, guardians, links };
}

function summaryOf(rows: ImportPreview['rows']): ImportPreview['summary'] {
  const count = (a: string) => rows.filter((r) => r.action === a).length;
  return {
    rows: rows.length,
    valid: rows.filter((r) => r.errors.length === 0).length,
    withErrors: rows.filter((r) => r.errors.length > 0).length,
    new: count('new'),
    updated: count('update'),
    unchanged: count('unchanged') + count('keeps_opt_out'),
  };
}

export function parentContactRoutes(deps: AppDeps): RouteDef[] {
  const route = (
    method: RouteDef['method'],
    path: string,
    handler: RouteDef['handler'],
    before?: RouteDef['before'],
  ): RouteDef => ({
    method,
    path,
    access: 'authenticated',
    handler,
    ...(before ? { before } : {}),
  });

  async function importAccess(auth: AuthInfo, req: Request) {
    const access = await auth.access();
    requireWritable(access);
    requireModule(access, MODULE, 'create');
    requireModule(access, MODULE, 'edit');
    const schoolId = parse(z.object({ schoolId: idSchema }), req.query).schoolId;
    await visibleSchool(auth.db, access, schoolId);
    checkWritableFields(access, MODULE, FIELDS, facts(schoolId));
    if (typeof req.body !== 'string' || req.body.trim() === '') {
      throw invalidInput('Choose a CSV file to upload.', { file: 'Choose a CSV file.' });
    }
    const csv = parseContactsCsv(req.body, deps.config.CONTACTS_CSV_MAX_ROWS);
    return { access, schoolId, csv };
  }

  const csvBody = [express.text({ type: () => true, limit: CSV_MAX_BYTES })];

  return [
    // The schools this page can show (people here may not have the Schools module).
    route('get', '/parent-contacts/schools', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      requireModule(access, MODULE, 'view');
      const rows = await auth.db.school.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      res.json({ items: rows.filter((r) => seesSchool(access, r.id)) });
    }),

    // ---------- classes ----------
    route('get', '/parent-contacts/classes', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      requireModule(access, MODULE, 'view');
      const { schoolId } = parse(z.object({ schoolId: idSchema }), req.query);
      await visibleSchool(auth.db, access, schoolId);
      const [classes, agreed] = await Promise.all([
        auth.db.schoolClass.findMany({
          where: { schoolId },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, schoolId: true, name: true, _count: { select: { students: true } } },
        }),
        auth.db.studentGuardian.findMany({
          where: { student: { schoolId }, guardian: { consent: 'agreed' } },
          select: { guardianId: true, student: { select: { classId: true } } },
        }),
      ]);
      const agreedBy = new Map<string, Set<string>>();
      for (const a of agreed) {
        const set = agreedBy.get(a.student.classId) ?? new Set<string>();
        set.add(a.guardianId);
        agreedBy.set(a.student.classId, set);
      }
      res.json({
        items: classes.map((c) => ({
          id: c.id,
          schoolId: c.schoolId,
          name: c.name,
          students: c._count.students,
          agreedParents: agreedBy.get(c.id)?.size ?? 0,
        })),
      });
    }),
    route('post', '/parent-contacts/classes', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      requireWritable(access);
      requireModule(access, MODULE, 'create');
      const input = parse(classInputSchema, req.body);
      await visibleSchool(auth.db, access, input.schoolId);
      const row = await withUnitOfWork(auth.db, auth.actor, (uow) =>
        uow.tx.schoolClass.create({
          data: { organisationId: auth.organisationId, schoolId: input.schoolId, name: input.name },
          select: { id: true, schoolId: true, name: true },
        }),
      ).catch((err: unknown) => {
        if (mapDbError(err)?.code === 'conflict')
          throw conflict('That class is already on the list.');
        throw err;
      });
      res.status(201).json({ ...row, students: 0, agreedParents: 0 });
    }),
    route('put', '/parent-contacts/classes/:id', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      requireWritable(access);
      requireModule(access, MODULE, 'edit');
      const id = idParam(req);
      const input = parse(classUpdateSchema, req.body);
      const current = await auth.db.schoolClass.findFirst({
        where: { id },
        select: { schoolId: true },
      });
      if (!current || !seesSchool(access, current.schoolId)) throw notFound('That class');
      const row = await withUnitOfWork(auth.db, auth.actor, (uow) =>
        uow.tx.schoolClass.update({
          where: { id },
          data: { name: input.name },
          select: { id: true, schoolId: true, name: true },
        }),
      ).catch((err: unknown) => {
        if (mapDbError(err)?.code === 'conflict')
          throw conflict('That class is already on the list.');
        throw err;
      });
      res.json(row);
    }),
    route('delete', '/parent-contacts/classes/:id', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      requireWritable(access);
      requireModule(access, MODULE, 'delete');
      const id = idParam(req);
      const current = await auth.db.schoolClass.findFirst({
        where: { id },
        select: { schoolId: true, _count: { select: { students: true } } },
      });
      if (!current || !seesSchool(access, current.schoolId)) throw notFound('That class');
      if (current._count.students > 0) {
        throw businessRule('Remove the children in this class first.');
      }
      await withUnitOfWork(auth.db, auth.actor, (uow) =>
        uow.tx.schoolClass.delete({ where: { id }, select: { id: true } }),
      );
      res.status(204).end();
    }),

    // Class names for "Message parents" on a task: anyone who can create tasks,
    // for the schools in their scope (names only; no children or parents).
    route('get', '/parent-contacts/class-names', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      if (!access.can('tasks', 'create') && !access.can(MODULE, 'view')) {
        requireModule(access, 'tasks', 'create');
      }
      const rows = await auth.db.schoolClass.findMany({
        where: { school: { deletedAt: null } },
        select: { name: true, schoolId: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      const names = new Map<string, string>();
      for (const r of rows) {
        if (!seesSchool(access, r.schoolId)) continue;
        const key = r.name.trim().toLowerCase();
        if (!names.has(key)) names.set(key, r.name.trim());
      }
      res.json({ items: [...names.values()] });
    }),

    // ---------- contacts ----------
    route('get', '/parent-contacts', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      requireModule(access, MODULE, 'view');
      const q = parse(
        contactListQuerySchema.extend({ offset: z.coerce.number().int().min(0).default(0) }),
        req.query,
      );
      await visibleSchool(auth.db, access, q.schoolId);
      const f = facts(q.schoolId);
      // Filters only on fields the person can see (a hidden field can't be probed).
      const sees = fieldView(access, MODULE, f).sees;
      const and: Prisma.StudentGuardianWhereInput[] = [{ student: { schoolId: q.schoolId } }];
      if (q.classId) and.push({ student: { classId: q.classId } });
      if (q.consent && sees('consent')) and.push({ guardian: { consent: q.consent } });
      if (q.q) {
        const or: Prisma.StudentGuardianWhereInput[] = [];
        if (sees('studentName')) {
          or.push({ student: { fullName: { contains: q.q, mode: 'insensitive' } } });
        }
        if (sees('parentName')) {
          or.push({ guardian: { fullName: { contains: q.q, mode: 'insensitive' } } });
        }
        const digits = q.q.replace(/\D/g, '');
        if (sees('parentMobile') && digits.length >= 4) {
          or.push({ guardian: { mobile: { contains: digits } } });
        }
        and.push(or.length ? { OR: or } : { studentId: { in: [] } });
      }
      const rows = await auth.db.studentGuardian.findMany({
        where: { AND: and },
        orderBy: [{ student: { class: { name: 'asc' } } }, { student: { fullName: 'asc' } }],
        skip: q.offset,
        take: q.limit + 1,
        select: {
          studentId: true,
          guardianId: true,
          student: {
            select: {
              fullName: true,
              schoolId: true,
              classId: true,
              class: { select: { name: true } },
            },
          },
          guardian: {
            select: { fullName: true, mobile: true, consent: true, consentChangedAt: true },
          },
        },
      });
      const items = rows.slice(0, q.limit).map((r) =>
        access.serialize(
          MODULE,
          {
            id: `${r.studentId}:${r.guardianId}`,
            studentId: r.studentId,
            guardianId: r.guardianId,
            schoolId: r.student.schoolId,
            classId: r.student.classId,
            className: r.student.class.name,
            studentName: r.student.fullName,
            parentName: r.guardian.fullName,
            parentMobile: formatMobile(r.guardian.mobile),
            consent: r.guardian.consent,
            consentChangedAt: r.guardian.consentChangedAt?.toISOString() ?? null,
          },
          f,
        ),
      );
      res.json({ items, nextOffset: rows.length > q.limit ? q.offset + q.limit : null });
    }),

    route(
      'post',
      '/parent-contacts/import/preview',
      async (req, res) => {
        const auth = authOf(req);
        const { access, schoolId, csv } = await importAccess(auth, req);
        const showMobile = fieldView(access, MODULE, facts(schoolId)).sees('parentMobile');
        const plan = await planImport(auth.db, schoolId, csv.rows, showMobile);
        res.json({ problems: csv.problems, rows: plan.preview, summary: summaryOf(plan.preview) });
      },
      csvBody,
    ),

    route(
      'post',
      '/parent-contacts/import',
      async (req, res) => {
        const auth = authOf(req);
        const { schoolId, csv } = await importAccess(auth, req);
        if (csv.problems.length > 0)
          throw invalidInput(csv.problems.join(' '), { file: csv.problems[0] ?? '' });
        const now = deps.now();
        const result = await withUnitOfWork(
          auth.db,
          auth.actor,
          async (uow) => {
            const plan = await planImport(uow.tx, schoolId, csv.rows, false);
            const good = csv.rows.filter((_, i) => plan.preview[i]?.errors.length === 0);
            const newStudents: Prisma.StudentCreateManyInput[] = [];
            const newGuardians: Prisma.GuardianCreateManyInput[] = [];
            const changes = new Map<string, Prisma.GuardianUpdateInput>();
            const links: Prisma.StudentGuardianCreateManyInput[] = [];
            let consentChanged = 0;
            for (const r of good) {
              const classId = plan.classes.get(r.className.trim().toLowerCase()) ?? '';
              const mobile = r.mobile ?? '';
              const sKey = studentKey(classId, r.studentName);
              let studentId = plan.students.get(sKey);
              if (!studentId) {
                studentId = uuidv7();
                plan.students.set(sKey, studentId);
                newStudents.push({
                  id: studentId,
                  organisationId: auth.organisationId,
                  schoolId,
                  classId,
                  fullName: r.studentName,
                });
              }
              let g = plan.guardians.get(mobile);
              if (!g) {
                g = {
                  id: uuidv7(),
                  fullName: r.parentName,
                  consent: r.agreed ? 'agreed' : 'not_agreed',
                };
                plan.guardians.set(mobile, g);
                newGuardians.push({
                  id: g.id,
                  organisationId: auth.organisationId,
                  fullName: r.parentName,
                  mobile,
                  consent: g.consent,
                  consentChangedAt: r.agreed ? now : null,
                  consentChangedBy: r.agreed ? auth.userId : null,
                });
              } else {
                const change: Prisma.GuardianUpdateInput = {};
                if (g.fullName !== r.parentName) change.fullName = r.parentName;
                // An opt-out is never undone by an upload, only by re-marking the parent.
                if (g.consent !== 'opted_out' && (g.consent === 'agreed') !== r.agreed) {
                  change.consent = r.agreed ? 'agreed' : 'not_agreed';
                  change.consentChangedAt = now;
                  change.consentChangedBy = auth.userId;
                  consentChanged++;
                }
                if (Object.keys(change).length > 0 && !newGuardians.some((n) => n.id === g?.id)) {
                  changes.set(g.id, { ...(changes.get(g.id) ?? {}), ...change });
                  g = { ...g, ...(change.fullName ? { fullName: r.parentName } : {}) };
                }
              }
              const lk = `${studentId}|${g.id}`;
              if (!plan.links.has(lk)) {
                plan.links.add(lk);
                links.push({ organisationId: auth.organisationId, studentId, guardianId: g.id });
              }
            }
            if (newStudents.length) await uow.tx.student.createMany({ data: newStudents });
            if (newGuardians.length) await uow.tx.guardian.createMany({ data: newGuardians });
            for (const [id, data] of changes) {
              await uow.tx.guardian.update({ where: { id }, data, select: { id: true } });
            }
            if (links.length) {
              await uow.tx.studentGuardian.createMany({ data: links, skipDuplicates: true });
            }
            // Counts only: no names or numbers in the audit log.
            uow.audit({
              action: 'parent_contacts.imported',
              entityType: 'school',
              entityId: schoolId,
              after: {
                rows: csv.rows.length,
                imported: good.length,
                skipped: csv.rows.length - good.length,
                newChildren: newStudents.length,
                newParents: newGuardians.length,
                consentChanged,
              },
            });
            return {
              imported: good.length,
              skipped: csv.rows.length - good.length,
              students: newStudents.length,
              parents: newGuardians.length,
            };
          },
          { timeoutMs: 60_000 },
        );
        res.json(result);
      },
      csvBody,
    ),

    route('put', '/parent-contacts/guardians/:id/consent', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      requireWritable(access);
      requireModule(access, MODULE, 'edit');
      const id = idParam(req);
      const { consent } = parse(consentInputSchema, req.body);
      const g = await visibleGuardian(auth.db, access, id);
      checkWritableFields(access, MODULE, ['consent'], facts(g.schoolId));
      if (g.consent !== consent) {
        await withUnitOfWork(auth.db, auth.actor, async (uow) => {
          await uow.tx.guardian.update({
            where: { id },
            data: { consent, consentChangedAt: deps.now(), consentChangedBy: auth.userId },
            select: { id: true },
          });
          uow.audit({
            action:
              consent === 'opted_out'
                ? 'parent_contact.opted_out'
                : 'parent_contact.consent_changed',
            entityType: 'guardian',
            entityId: id,
            before: { consent: g.consent },
            after: { consent },
          });
        });
      }
      res.status(204).end();
    }),

    // Deleting a parent removes their number completely; children left with no parent go too.
    route('delete', '/parent-contacts/guardians/:id', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      requireWritable(access);
      requireModule(access, MODULE, 'delete');
      const id = idParam(req);
      const g = await visibleGuardian(auth.db, access, id);
      await withUnitOfWork(auth.db, auth.actor, async (uow) => {
        const children = g.students.map((s) => s.studentId);
        await uow.tx.guardian.delete({ where: { id }, select: { id: true } });
        const orphans = children.length
          ? await uow.tx.student.findMany({
              where: { id: { in: children }, guardians: { none: {} } },
              select: { id: true },
            })
          : [];
        for (const o of orphans) {
          await uow.tx.student.delete({ where: { id: o.id }, select: { id: true } });
        }
        uow.audit({
          action: 'parent_contact.deleted',
          entityType: 'guardian',
          entityId: id,
          after: { childrenRemoved: orphans.length },
        });
      });
      res.status(204).end();
    }),

    route('delete', '/parent-contacts/students/:id', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      requireWritable(access);
      requireModule(access, MODULE, 'delete');
      const id = idParam(req);
      const s = await auth.db.student.findFirst({
        where: { id },
        select: { schoolId: true, guardians: { select: { guardianId: true } } },
      });
      if (!s || !seesSchool(access, s.schoolId)) throw notFound('That child');
      await withUnitOfWork(auth.db, auth.actor, async (uow) => {
        const parents = s.guardians.map((g) => g.guardianId);
        await uow.tx.student.delete({ where: { id }, select: { id: true } });
        const orphans = parents.length
          ? await uow.tx.guardian.findMany({
              where: { id: { in: parents }, students: { none: {} } },
              select: { id: true },
            })
          : [];
        for (const o of orphans) {
          await uow.tx.guardian.delete({ where: { id: o.id }, select: { id: true } });
        }
        uow.audit({
          action: 'parent_contact.child_removed',
          entityType: 'student',
          entityId: id,
          after: { parentsRemoved: orphans.length },
        });
      });
      res.status(204).end();
    }),
  ];
}

/** For logs: a parent's number, masked (it must never appear in full outside the contacts screen). */
export const maskedParentMobile = maskMobile;
