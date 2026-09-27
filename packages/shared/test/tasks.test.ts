import { describe, expect, it } from 'vitest';
import { registry } from '../src/modules/index.js';
import {
  can,
  createAccess,
  fieldAccess,
  reachScope,
  scopeMatches,
} from '../src/permissions/index.js';
import {
  createTaskSchema,
  includesNewJoiners,
  taskRecordSchema,
  templateInputSchema,
  updateTaskSchema,
} from '../src/schemas/tasks.js';
import {
  addDays,
  canMove,
  dueAtFor,
  firstCopy,
  isListFieldKey,
  listFieldKey,
  localDate,
  messageParts,
  OPEN_STATUSES,
  orgRegistry,
  planDates,
  STATUS_MOVES,
  TASK_STATUSES,
  weekdayOf,
  zonedInstant,
} from '../src/tasks/index.js';
import type { DueRule, StatusActor, TaskStatus, WorkCalendar } from '../src/tasks/index.js';
import { ctx, deptHeadRole, ids, principalCtx, teacherCtx } from './fixtures.js';

describe('status moves (brief 9.4)', () => {
  const ACTORS: StatusActor[] = ['assignee', 'approver', 'manager', 'system'];
  const open: TaskStatus[] = ['todo', 'in_progress', 'sent_back', 'overdue'];
  // Written out by hand, independently of STATUS_MOVES, so a change to the
  // table must be matched here on purpose.
  const allowed = new Set<string>([
    'todo>in_progress:assignee',
    ...open.map((s) => `${s}>submitted:assignee`),
    ...open.map((s) => `${s}>done:assignee`),
    'submitted>approved:approver',
    'submitted>sent_back:approver',
    'todo>overdue:system',
    'in_progress>overdue:system',
    'sent_back>overdue:system',
    ...open.map((s) => `${s}>expired:system`),
    ...[...open, 'submitted'].map((s) => `${s}>cancelled:manager`),
  ]);

  for (const from of TASK_STATUSES) {
    for (const to of TASK_STATUSES) {
      for (const actor of ACTORS) {
        const key = `${from}>${to}:${actor}`;
        const expected = allowed.has(key);
        it(`${expected ? 'allows' : 'refuses'} ${from} → ${to} by ${actor}`, () => {
          expect(canMove(from, to, actor)).toBe(expected);
        });
      }
    }
  }

  it('treats expired as not open, and final statuses as dead ends', () => {
    expect(OPEN_STATUSES).not.toContain('expired');
    for (const from of ['approved', 'done', 'expired', 'cancelled'] as const) {
      for (const to of TASK_STATUSES) {
        for (const actor of ACTORS) expect(canMove(from, to, actor)).toBe(false);
      }
    }
  });

  it('every named move is one of the allowed moves', () => {
    for (const m of Object.values(STATUS_MOVES)) {
      for (const from of m.from) expect(allowed.has(`${from}>${m.to}:${m.actor}`)).toBe(true);
    }
  });
});

describe('calendar (brief 9.5)', () => {
  const cal: WorkCalendar = {
    timezone: 'Asia/Kolkata',
    workingDays: [1, 2, 3, 4, 5, 6],
    opensAt: '08:00',
    closesAt: '16:00',
    holidays: [{ start: '2026-10-02', end: '2026-10-02' }],
  };
  const rule = (o: Partial<DueRule> = {}): DueRule => ({
    dueType: 'end_of_day',
    dueTime: null,
    dueDate: null,
    repeat: 'none',
    repeatWeekdays: [],
    repeatMonthDay: null,
    repeatStartDate: '2026-09-28',
    repeatEndDate: null,
    closesAfterMinutes: null,
    ...o,
  });
  const early = new Date('2026-09-27T00:00:00Z');

  it('converts local times in the organisation’s zone', () => {
    expect(zonedInstant('2026-09-28', '16:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-09-28T10:30:00.000Z',
    );
    expect(zonedInstant('2026-03-29', '09:00', 'Europe/London').toISOString()).toBe(
      '2026-03-29T08:00:00.000Z',
    );
    expect(localDate(new Date('2026-09-27T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-09-28');
    expect(weekdayOf('2026-09-27')).toBe(0);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('puts "end of day" at the school’s closing time and fixed times where they are', () => {
    expect(dueAtFor(rule(), '2026-09-28', cal).toISOString()).toBe('2026-09-28T10:30:00.000Z');
    const timed = rule({ dueType: 'at_time', dueTime: '09:30' });
    expect(dueAtFor(timed, '2026-09-28', cal).toISOString()).toBe('2026-09-28T04:00:00.000Z');
    const late = { ...cal, closesAt: '18:00' };
    expect(dueAtFor(rule(), '2026-09-28', late).toISOString()).toBe('2026-09-28T12:30:00.000Z');
  });

  it('keeps closing separate from the deadline', () => {
    const [c] = planDates(
      rule({ closesAfterMinutes: 120 }),
      cal,
      '2026-09-28',
      '2026-09-28',
      early,
    );
    expect(c?.closesAt?.toISOString()).toBe('2026-09-28T12:30:00.000Z');
  });

  it('skips Sundays and holidays for repeating tasks', () => {
    const dates = planDates(rule({ repeat: 'daily' }), cal, '2026-09-26', '2026-10-05', early).map(
      (c) => c.serviceDate,
    );
    expect(dates).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-03',
      '2026-10-05',
    ]);
  });

  it('never plans a copy whose deadline has passed, and stops at the end date', () => {
    const now = new Date('2026-09-28T11:00:00Z'); // after 16:00 IST on the 28th
    const r = rule({ repeat: 'daily', repeatEndDate: '2026-09-30' });
    expect(planDates(r, cal, '2026-09-28', '2026-10-10', now).map((c) => c.serviceDate)).toEqual([
      '2026-09-29',
      '2026-09-30',
    ]);
  });

  it('handles weekly and monthly patterns, clamping to the month end', () => {
    const weekly = rule({ repeat: 'weekly', repeatWeekdays: [1, 4] });
    expect(
      planDates(weekly, cal, '2026-09-28', '2026-10-08', early).map((c) => c.serviceDate),
    ).toEqual(['2026-09-28', '2026-10-01', '2026-10-05', '2026-10-08']);
    const monthly = rule({ repeat: 'monthly', repeatMonthDay: 31, repeatStartDate: '2026-11-01' });
    expect(firstCopy(monthly, cal, '2026-11-01', early)?.serviceDate).toBe('2026-11-30');
  });

  it('gives a one-time task exactly its date, even far ahead', () => {
    const onDate = rule({ dueType: 'on_date', dueDate: '2027-03-15' });
    expect(firstCopy(onDate, cal, '2026-09-28', early)?.serviceDate).toBe('2027-03-15');
    expect(firstCopy(rule(), cal, '2026-09-28', early)?.serviceDate).toBe('2026-09-28');
  });

  it('gives every copy a service date equal to the local date of its deadline, across DST changes', () => {
    const deadlines: Partial<DueRule>[] = [
      { dueType: 'at_time', dueTime: '00:00' },
      { dueType: 'at_time', dueTime: '23:59' },
      { dueType: 'end_of_day' },
    ];
    const rules = deadlines.map((o) =>
      rule({ ...o, repeat: 'daily', repeatStartDate: '2026-01-01' }),
    );
    // Every day of the week, over both clock changes of 2026 in each zone.
    const ranges = [
      ['2026-03-01', '2026-04-05'],
      ['2026-10-20', '2026-11-05'],
    ] as const;
    const before = new Date('2026-01-01T00:00:00Z');
    for (const timezone of ['Asia/Kolkata', 'America/New_York', 'Europe/London']) {
      const zoned: WorkCalendar = {
        ...cal,
        timezone,
        workingDays: [0, 1, 2, 3, 4, 5, 6],
        holidays: [],
      };
      for (const r of rules) {
        for (const [from, to] of ranges) {
          const copies = planDates(r, zoned, from, to, before);
          expect(copies.length).toBeGreaterThan(0);
          for (const c of copies) expect(localDate(c.dueAt, timezone)).toBe(c.serviceDate);
        }
      }
    }
  });
});

describe('task input rules', () => {
  const me = '00000000-0000-7000-8000-000000000001';
  const other = '00000000-0000-7000-8000-000000000002';
  const role = '00000000-0000-7000-8000-000000000003';
  const base = { title: 'Mark attendance', target: { userIds: [me] } };

  it('fills defaults and requires a title and someone to do it', () => {
    const t = createTaskSchema.parse(base);
    expect(t.dueType).toBe('end_of_day');
    expect(t.needsApproval).toBe(false);
    expect(createTaskSchema.safeParse({ ...base, title: '  ' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'x', target: {} }).success).toBe(false);
  });

  it('checks due and repeat details', () => {
    const bad = (o: object) => createTaskSchema.safeParse({ ...base, ...o }).success;
    expect(bad({ dueType: 'at_time' })).toBe(false);
    expect(bad({ dueType: 'on_date' })).toBe(false);
    expect(bad({ dueType: 'on_date', dueDate: '2026-10-01', repeat: 'daily' })).toBe(false);
    expect(bad({ repeat: 'weekly' })).toBe(false);
    expect(bad({ repeat: 'monthly' })).toBe(false);
    expect(bad({ needsApproval: true, approverMode: 'named_user' })).toBe(false);
    expect(
      bad({ dueType: 'at_time', dueTime: '09:30', repeat: 'weekly', repeatWeekdays: [1] }),
    ).toBe(true);
  });

  it('allows a sub-task its own person only on a task for one named person (addition a)', () => {
    const sub = { title: 'Rehearsal schedule', assigneeUserId: other };
    expect(createTaskSchema.safeParse({ ...base, subtasks: [sub] }).success).toBe(true);
    const group = { title: 'x', target: { roleIds: [role] }, subtasks: [sub] };
    expect(createTaskSchema.safeParse(group).success).toBe(false);
    const two = { title: 'x', target: { userIds: [me, other] }, subtasks: [sub] };
    expect(createTaskSchema.safeParse(two).success).toBe(false);
  });

  it('includes new joiners by default only for groups', () => {
    expect(includesNewJoiners(createTaskSchema.parse(base).target)).toBe(false);
    const group = createTaskSchema.parse({ title: 'x', target: { roleIds: [role] } });
    expect(includesNewJoiners(group.target)).toBe(true);
  });

  it('validates the merged record on edit, not just the fragment', () => {
    const stored = createTaskSchema.parse(base);
    const patch = updateTaskSchema.parse({ dueType: 'at_time' });
    expect(taskRecordSchema.safeParse({ ...stored, ...patch }).success).toBe(false);
  });
});

describe('templates strip people and fixed dates (brief 9.10)', () => {
  it('drops the target, watchers, named approver, sub-task people and dates', () => {
    const t = templateInputSchema.parse({
      name: 'Safety',
      payload: {
        title: 'Classroom safety check',
        target: { userIds: [ids.teacherA] },
        watchers: [{ userId: 'x', access: 'edit' }],
        approverMode: 'named_user',
        approverUserId: '00000000-0000-7000-8000-000000000009',
        dueType: 'on_date',
        dueDate: '2026-10-01',
        repeatStartDate: '2026-10-01',
        repeatEndDate: '2026-12-01',
        subtasks: [{ title: 'Fire exit', assigneeUserId: '00000000-0000-7000-8000-000000000009' }],
      },
    });
    const p = t.payload as Record<string, unknown>;
    for (const k of [
      'target',
      'watchers',
      'approverUserId',
      'dueDate',
      'repeatStartDate',
      'repeatEndDate',
    ]) {
      expect(p).not.toHaveProperty(k);
    }
    expect(t.payload.approverMode).toBe('creator');
    expect(t.payload.subtasks).toEqual([{ title: 'Fire exit' }]);
  });
});

describe('custom lists as fields', () => {
  const list = { id: '0190f4a2-1111-7000-8000-000000000001', name: 'Area' };

  it('adds one tasks field per list, which field permissions then govern', () => {
    const reg = orgRegistry(registry, [list]);
    const key = listFieldKey(list.id);
    expect(isListFieldKey(key)).toBe(true);
    expect(reg.module('tasks').fields?.some((f) => f.key === key && f.label === 'Area')).toBe(true);
    expect(registry.module('tasks').fields?.some((f) => f.key === key)).toBe(false);
    const teacher = teacherCtx({ registry: reg });
    expect(
      fieldAccess(teacher, 'tasks', key, { subjectUserIds: [ids.teacherA], schoolIds: [] }),
    ).toBe('edit');
  });

  it('marks fill-in words in parent message previews', () => {
    expect(messageParts('Dear parent, {class_name} did {activity}. {unknown}')).toEqual([
      { text: 'Dear parent, ', word: false },
      { text: '{class_name}', word: true },
      { text: ' did ', word: false },
      { text: '{activity}', word: true },
      { text: '. {unknown}', word: false },
    ]);
  });
});

describe('participants: access to one record only', () => {
  const outsider = ctx({ userId: ids.deptHead, role: { ...deptHeadRole, modules: {} } });
  const withApprover = {
    subjectUserIds: [ids.otherTeacher],
    schoolIds: [ids.schoolGB],
    participants: [{ userId: ids.deptHead, actions: ['view'] }],
  };

  it('lets a named person see that record, and nothing more', () => {
    const principal = principalCtx({ userId: ids.deptHead });
    expect(can(principal, 'tasks', 'view', withApprover)).toBe(true);
    expect(can(principal, 'tasks', 'edit', withApprover)).toBe(false);
    const without = { subjectUserIds: [ids.otherTeacher], schoolIds: [ids.schoolGB] };
    expect(can(principal, 'tasks', 'view', without)).toBe(false);
    // Not a list scope: the same person's other records stay out of reach.
    const scope = reachScope(principal, 'tasks');
    expect(scopeMatches(scope, without, ids.deptHead)).toBe(false);
  });

  it('still needs a role (rule 1)', () => {
    const noRole = ctx({ userId: ids.deptHead, role: null });
    expect(can(noRole, 'tasks', 'view', withApprover)).toBe(false);
    expect(can(outsider, 'tasks', 'view', withApprover)).toBe(true);
    expect(createAccess(outsider).can('users', 'view')).toBe(false);
  });
});
