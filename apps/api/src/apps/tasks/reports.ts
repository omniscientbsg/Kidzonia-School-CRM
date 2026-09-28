import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  addDays,
  completionOf,
  fieldView,
  HIDDEN_NAME,
  idSchema,
  listFieldKey,
  localDate,
  OPEN_STATUSES,
  reportFiltersSchema,
  savedViewInputSchema,
  weekdayOf,
} from '@kidzonia/shared';
import type { Access, Completion, Report, ReportFilters, TaskStatus } from '@kidzonia/shared';
import { withUnitOfWork } from '../../db/index.js';
import type { Prisma, ScopedTx } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import type { AuthInfo } from '../../http/types.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { notFound } from '../../lib/errors.js';
import { requireModule, requireWritable } from '../../core/guards.js';
import { authOf } from '../../core/users/routes.js';
import { fromIsoDate } from './calendars.js';
import { factsOfCopy, presentCopy } from './copies-core.js';
import { copyScopeWhere } from './facts.js';
import { COPY_SELECT, loadChoices } from './records.js';

/**
 * Task reports (brief 9.14). Visibility first, then filters, in one function
 * (reportWhere) that both the summary and the rows use, so the rows behind a
 * number are the rows it was counted from (a test checks they always match).
 * Filter options only list what the person can see; filters pointing at
 * something no longer visible are dropped with a notice (Phase 5 b). Dates
 * follow the organisation's time zone.
 */

const REPORTS = 'task_reports';
const ROWS_PER_PAGE = 200;

type StatusCount = { status: TaskStatus; _count: { _all: number } };
const tally = (rows: readonly StatusCount[]): Completion =>
  completionOf(
    rows.flatMap((r) => Array<{ status: TaskStatus }>(r._count._all).fill({ status: r.status })),
  );
const percent = (c: Completion) =>
  c.total ? Math.round(((c.done + c.submitted) / c.total) * 100) : 0;

/** Today, this week (Monday to Sunday), this month, or a custom range, in the organisation's time zone. */
export function dateRange(f: ReportFilters, today: string): { from: string; to: string } {
  if (f.range === 'today') return { from: today, to: today };
  if (f.range === 'this_week') {
    const back = (weekdayOf(today) + 6) % 7;
    const from = addDays(today, -back);
    return { from, to: addDays(from, 6) };
  }
  if (f.range === 'this_month') {
    const from = `${today.slice(0, 8)}01`;
    const next = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1));
    return { from, to: addDays(next.toISOString().slice(0, 10), -1) };
  }
  const from = f.from ?? today;
  const to = f.to && f.to >= from ? f.to : from;
  return { from, to };
}

/** What someone may see in reports, before any filter (reach + manager switch + school switcher). */
function visibleWhere(access: Access, from: string, to: string): Prisma.TaskAssignmentWhereInput {
  return {
    AND: [
      { task: { kind: 'task' }, serviceDate: { gte: fromIsoDate(from), lte: fromIsoDate(to) } },
      ...access.scopes(REPORTS).map(copyScopeWhere),
    ],
  };
}

/** The one filter function for the summary, the rows and the CSV. */
export function reportWhere(
  access: Access,
  f: ReportFilters,
  from: string,
  to: string,
): Prisma.TaskAssignmentWhereInput {
  const and: Prisma.TaskAssignmentWhereInput[] = [visibleWhere(access, from, to)];
  if (f.schoolId) and.push({ schoolId: f.schoolId === 'head_office' ? null : f.schoolId });
  if (f.roleId) and.push({ user: { roleAssignment: { roleId: f.roleId } } });
  if (f.department) and.push({ user: { department: f.department } });
  if (f.userId) and.push({ userId: f.userId });
  if (f.categoryId) and.push({ task: { categoryId: f.categoryId } });
  if (f.priorityId) and.push({ task: { priorityId: f.priorityId } });
  if (f.listValue) {
    const [listId = '', valueId = ''] = f.listValue.split(':');
    and.push({ task: { customValues: { path: [listId], equals: valueId } } });
  }
  if (f.status === 'open') and.push({ status: { in: [...OPEN_STATUSES] } });
  else if (f.status) and.push({ status: f.status });
  return { AND: and };
}

export class ReportsService {
  constructor(private readonly deps: AppDeps) {}

  private async today(db: ScopedTx) {
    const org = await db.organisation.findFirstOrThrow({ select: { timezone: true } });
    return localDate(this.deps.now(), org.timezone);
  }

  /** Options from what the person can see in the range, and filters checked against them. */
  async options(db: ScopedTx, access: Access, f: ReportFilters, from: string, to: string) {
    const base = visibleWhere(access, from, to);
    const [bySchool, byUser, tasks] = await Promise.all([
      db.taskAssignment.groupBy({ by: ['schoolId'], where: base }),
      db.taskAssignment.groupBy({ by: ['userId'], where: base }),
      db.taskAssignment.findMany({ where: base, distinct: ['taskId'], select: { taskId: true } }),
    ]);
    const schoolIds = bySchool.map((s) => s.schoolId).filter((x): x is string => x !== null);
    const [schools, people, taskRows, lists] = await Promise.all([
      db.school.findMany({
        where: { id: { in: schoolIds } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      db.user.findMany({
        where: { id: { in: byUser.map((u) => u.userId) } },
        select: {
          id: true,
          fullName: true,
          department: true,
          roleAssignment: { select: { role: { select: { id: true, name: true } } } },
        },
        orderBy: { fullName: 'asc' },
      }),
      db.task.findMany({
        where: { id: { in: tasks.map((t) => t.taskId) } },
        select: {
          customValues: true,
          category: { select: { id: true, name: true } },
          priority: { select: { id: true, name: true, sortOrder: true } },
        },
      }),
      db.taskList.findMany({
        where: { archivedAt: null },
        select: { id: true, name: true, values: { select: { id: true, value: true } } },
      }),
    ]);
    const seen = fieldView(access, 'tasks').sees;
    const uniq = <T extends { value: string }>(xs: T[]) => [
      ...new Map(xs.map((x) => [x.value, x])).values(),
    ];
    const usedValues = new Set(
      taskRows.flatMap((t) =>
        Object.values((t.customValues ?? {}) as Record<string, string>).filter(
          (v) => typeof v === 'string',
        ),
      ),
    );
    const options: Report['options'] = {
      schools: [
        ...(bySchool.some((s) => s.schoolId === null)
          ? [{ value: 'head_office', label: 'Head office' }]
          : []),
        ...schools.map((s) => ({ value: s.id, label: s.name })),
      ],
      roles: uniq(
        people
          .map((p) => p.roleAssignment?.role)
          .filter((r): r is { id: string; name: string } => r !== undefined)
          .map((r) => ({ value: r.id, label: r.name })),
      ),
      departments: uniq(
        people
          .map((p) => p.department)
          .filter((d): d is string => !!d)
          .map((d) => ({ value: d, label: d })),
      ),
      // A person filter needs their names; with names hidden there's no person filter.
      people: fieldView(access, 'users').sees('fullName')
        ? people.map((p) => ({ value: p.id, label: p.fullName }))
        : [],
      categories: seen('category')
        ? uniq(
            taskRows.flatMap((t) =>
              t.category ? [{ value: t.category.id, label: t.category.name }] : [],
            ),
          )
        : [],
      priorities: seen('priority')
        ? uniq(
            taskRows
              .flatMap((t) => (t.priority ? [t.priority] : []))
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((p) => ({ value: p.id, label: p.name })),
          )
        : [],
      lists: lists
        .filter((l) => seen(listFieldKey(l.id)))
        .map((l) => ({
          id: l.id,
          name: l.name,
          values: l.values
            .filter((v) => usedValues.has(v.id))
            .map((v) => ({ value: `${l.id}:${v.id}`, label: v.value })),
        }))
        .filter((l) => l.values.length > 0),
    };
    // Saved views pointing at something no longer visible: drop that filter, say so.
    const dropped: string[] = [];
    const droppedKeys = new Set<string>();
    const check = (key: keyof ReportFilters, allowed: { value: string }[], label: string) => {
      const v = f[key];
      if (typeof v === 'string' && !allowed.some((o) => o.value === v)) {
        droppedKeys.add(key);
        dropped.push(label);
      }
    };
    check('schoolId', options.schools, 'school');
    check('roleId', options.roles, 'role');
    check('department', options.departments, 'department');
    check('userId', options.people, 'person');
    check('categoryId', options.categories, 'category');
    check('priorityId', options.priorities, 'priority');
    check(
      'listValue',
      options.lists.flatMap((l) => l.values),
      'list',
    );
    const clean = Object.fromEntries(
      Object.entries(f).filter(([k]) => !droppedKeys.has(k)),
    ) as ReportFilters;
    return { options, filters: clean, dropped };
  }

  async report(auth: AuthInfo, raw: ReportFilters, offset: number): Promise<Report> {
    const access = await auth.access();
    requireModule(access, REPORTS, 'view');
    const db = auth.db;
    const today = await this.today(db);
    const { from, to } = dateRange(raw, today);
    const { options, filters, dropped } = await this.options(db, access, raw, from, to);
    const where = reportWhere(access, filters, from, to);
    // Summary: counted straight from the filter. Rows: the same filter, by person.
    const [summaryRows, peopleCount, byPerson] = await Promise.all([
      db.taskAssignment.groupBy({ by: ['status'], where, _count: { _all: true } }),
      db.taskAssignment.groupBy({ by: ['userId'], where }),
      db.taskAssignment.groupBy({ by: ['userId', 'status'], where, _count: { _all: true } }),
    ]);
    const summary = tally(summaryRows);
    const ids = [...new Set(byPerson.map((r) => r.userId))];
    const rows = await this.rows(db, access, ids, byPerson, today);
    rows.sort(
      (a, b) => a.percent - b.percent || a.person.fullName.localeCompare(b.person.fullName),
    );
    return {
      from,
      to,
      summary: {
        people: peopleCount.length,
        tasks: summary.total,
        percent: percent(summary),
        overdue: summary.overdue,
      },
      rows: rows.slice(offset, offset + ROWS_PER_PAGE),
      options,
      dropped,
      nextOffset: offset + ROWS_PER_PAGE < rows.length ? offset + ROWS_PER_PAGE : null,
    };
  }

  private async rows(
    db: ScopedTx,
    access: Access,
    ids: string[],
    byPerson: readonly (StatusCount & { userId: string })[],
    today: string,
  ) {
    const [people, dayEnd] = await Promise.all([
      db.user.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          fullName: true,
          jobTitle: true,
          homeSchool: { select: { name: true } },
          roleAssignment: { select: { role: { select: { name: true } } } },
        },
      }),
      db.taskAssignment.findMany({
        where: { userId: { in: ids }, serviceDate: fromIsoDate(today), task: { kind: 'day_end' } },
        select: { userId: true, status: true },
      }),
    ]);
    const users = fieldView(access, 'users');
    return ids.map((id) => {
      const p = people.find((x) => x.id === id);
      const c = tally(byPerson.filter((r) => r.userId === id));
      const d = dayEnd.find((x) => x.userId === id);
      return {
        person: {
          id,
          fullName: users.show('fullName', p?.fullName ?? HIDDEN_NAME, HIDDEN_NAME),
          jobTitle: p?.jobTitle ?? null,
          schoolName: users.show('school', p?.homeSchool?.name ?? null, null),
        },
        roleName: p?.roleAssignment?.role.name ?? null,
        total: c.total,
        done: c.done,
        submitted: c.submitted,
        overdue: c.overdue,
        percent: percent(c),
        dayEnd: d
          ? ['done', 'approved', 'submitted'].includes(d.status)
            ? ('in' as const)
            : ('due' as const)
          : null,
      };
    });
  }

  /** One person's tasks in the report's range (clicking a row). */
  async personTasks(auth: AuthInfo, userId: string, raw: ReportFilters) {
    const access = await auth.access();
    requireModule(access, REPORTS, 'view');
    const today = await this.today(auth.db);
    const { from, to } = dateRange(raw, today);
    // Someone whose tasks the reader can't see at all (or who isn't in this organisation) is a 404.
    const reachable = await auth.db.taskAssignment.findFirst({
      where: {
        AND: [{ userId, task: { kind: 'task' } }, ...access.scopes(REPORTS).map(copyScopeWhere)],
      },
      select: { id: true },
    });
    if (!reachable) throw notFound('That person');
    const rows = await auth.db.taskAssignment.findMany({
      where: { AND: [reportWhere(access, { range: raw.range }, from, to), { userId }] },
      select: COPY_SELECT,
      orderBy: [{ serviceDate: 'desc' }, { dueAt: 'asc' }],
      take: 100,
    });
    const choices = await loadChoices(
      auth.db,
      rows.map((r) => r.task.customValues),
    );
    return {
      items: rows
        .filter((c) => access.can('tasks', 'view', factsOfCopy(c)))
        .map((c) => presentCopy(access, c, choices)),
    };
  }

  /**
   * CSV download (brief 9.14, Phase 5 d): field permissions decide the
   * columns; cells that a spreadsheet would run as a formula are made safe;
   * rows stream in pages; every export is audited and rate-limited.
   */
  async csv(auth: AuthInfo, raw: ReportFilters, res: Response) {
    const access = await auth.access();
    requireModule(access, REPORTS, 'export');
    await this.deps.rateLimits.consumeExport(auth.userId);
    const db = auth.db;
    const today = await this.today(db);
    const { from, to } = dateRange(raw, today);
    const { filters } = await this.options(db, access, raw, from, to);
    const where = reportWhere(access, filters, from, to);
    const users = fieldView(access, 'users');
    const nameShown = users.sees('fullName');
    const schoolShown = users.sees('school');
    const header = [
      ...(nameShown ? ['Name'] : []),
      'Role',
      ...(schoolShown ? ['School'] : []),
      'Tasks',
      'Done',
      'Waiting for approval',
      'Overdue',
      '% done or submitted',
      'Day-end today',
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="task-report-${from}-to-${to}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.write('﻿' + csvLine(header));
    const people = await db.taskAssignment.groupBy({
      by: ['userId'],
      where,
      orderBy: { userId: 'asc' },
    });
    let written = 0;
    for (let i = 0; i < people.length; i += 500) {
      const ids = people.slice(i, i + 500).map((p) => p.userId);
      const byPerson = await db.taskAssignment.groupBy({
        by: ['userId', 'status'],
        where: { AND: [where, { userId: { in: ids } }] },
        _count: { _all: true },
      });
      for (const r of await this.rows(db, access, ids, byPerson, today)) {
        res.write(
          csvLine([
            ...(nameShown ? [r.person.fullName] : []),
            r.roleName ?? '',
            ...(schoolShown ? [r.person.schoolName ?? 'Head office'] : []),
            String(r.total),
            String(r.done),
            String(r.submitted),
            String(r.overdue),
            String(r.percent),
            r.dayEnd === 'in' ? 'In' : r.dayEnd === 'due' ? 'Due' : '',
          ]),
        );
        written++;
      }
    }
    await withUnitOfWork(db, auth.actor, (uow) => {
      uow.audit({
        action: 'report.exported',
        entityType: 'user',
        entityId: auth.userId,
        after: { report: 'tasks', filters, from, to, rows: written },
      });
      return Promise.resolve();
    });
    res.end();
  }
}

/** Formula injection (Phase 5 d): a leading =, +, -, @, tab or CR would run in a spreadsheet. */
export function safeCell(v: string): string {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
const csvLine = (cells: readonly string[]) => `${cells.map(safeCell).join(',')}\r\n`;

const filtersOf = (req: Request) => parse(reportFiltersSchema, req.query);

export function reportRoutes(deps: AppDeps): RouteDef[] {
  const reports = new ReportsService(deps);
  const route = (
    method: RouteDef['method'],
    path: string,
    handler: RouteDef['handler'],
  ): RouteDef => ({
    method,
    path,
    access: 'authenticated',
    guardWrites: false,
    handler,
  });
  return [
    route('get', '/reports/tasks', async (req, res) => {
      const offset = parse(
        z.object({ offset: z.coerce.number().int().min(0).default(0) }),
        req.query,
      ).offset;
      res.json(await reports.report(authOf(req), filtersOf(req), offset));
    }),
    // Fixed paths before parameter paths (brief 11).
    route('get', '/reports/tasks.csv', async (req, res) => {
      await reports.csv(authOf(req), filtersOf(req), res);
    }),
    route('get', '/reports/tasks/people/:id', async (req, res) => {
      const id = parse(z.object({ id: idSchema }), req.params).id;
      res.json(await reports.personTasks(authOf(req), id, filtersOf(req)));
    }),

    // Saved views: per person (brief 9.14).
    route('get', '/saved-views', async (req, res) => {
      const auth = authOf(req);
      requireModule(await auth.access(), REPORTS, 'view');
      const rows = await auth.db.savedView.findMany({
        where: { userId: auth.userId, module: REPORTS },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, filters: true },
      });
      res.json({
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          filters: reportFiltersSchema.catch({ range: 'this_week' }).parse(r.filters),
        })),
      });
    }),
    route('post', '/saved-views', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      requireWritable(access);
      requireModule(access, REPORTS, 'view');
      const input = parse(savedViewInputSchema, req.body);
      const row = await auth.db.savedView.create({
        data: {
          organisationId: auth.organisationId,
          userId: auth.userId,
          module: REPORTS,
          name: input.name,
          filters: input.filters as Prisma.InputJsonValue,
        },
        select: { id: true, name: true, filters: true },
      });
      res.status(201).json({ id: row.id, name: row.name, filters: input.filters });
    }),
    route('delete', '/saved-views/:id', async (req, res) => {
      const auth = authOf(req);
      requireWritable(await auth.access());
      const id = parse(z.object({ id: idSchema }), req.params).id;
      const done = await auth.db.savedView.deleteMany({ where: { id, userId: auth.userId } });
      if (done.count === 0) throw notFound('That view');
      res.status(204).end();
    }),
  ];
}
