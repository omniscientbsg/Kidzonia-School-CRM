import { describe, expect, it } from 'vitest';
import { answerProblems, dayEndFormInputSchema, missingRequired } from '../src/schemas/dayend.js';
import type { Question } from '../src/schemas/dayend.js';
import { isNotificationEvent, NOTIFICATION_EVENTS } from '../src/notifications.js';
import { blocksLogoutNow, completionOf, deferRange } from '../src/tasks/index.js';
import type { BlockingCopy } from '../src/tasks/index.js';

describe('the logout block window (brief 9.7, addition a)', () => {
  const deadline = new Date('2026-09-28T10:30:00Z'); // 16:00 in Kolkata
  const copy = (o: Partial<BlockingCopy> = {}): BlockingCopy => ({
    serviceDate: '2026-09-28',
    dueAt: deadline,
    status: 'todo',
    blocksLogout: true,
    ...o,
  });
  const at = (minutesFromDeadline: number) =>
    new Date(deadline.getTime() + minutesFromDeadline * 60_000);
  const none = new Set<string>();

  it('doesn’t block just before the window opens', () => {
    expect(blocksLogoutNow(copy(), '2026-09-28', at(-121), 120, none)).toBe(false);
  });
  it('blocks from the start of the window, inside it and after the deadline', () => {
    expect(blocksLogoutNow(copy(), '2026-09-28', at(-120), 120, none)).toBe(true);
    expect(blocksLogoutNow(copy(), '2026-09-28', at(-30), 120, none)).toBe(true);
    expect(blocksLogoutNow(copy(), '2026-09-28', at(45), 120, none)).toBe(true);
    expect(blocksLogoutNow(copy({ status: 'overdue' }), '2026-09-28', at(45), 120, none)).toBe(
      true,
    );
  });
  it('with 0 minutes, blocks only once the deadline has arrived', () => {
    expect(blocksLogoutNow(copy(), '2026-09-28', at(-1), 0, none)).toBe(false);
    expect(blocksLogoutNow(copy(), '2026-09-28', at(0), 0, none)).toBe(true);
  });
  it('ends at submit, not approval', () => {
    for (const status of ['submitted', 'approved', 'done', 'expired', 'cancelled'] as const) {
      expect(blocksLogoutNow(copy({ status }), '2026-09-28', at(45), 120, none)).toBe(false);
    }
  });
  it('always blocks open work from an earlier day, until that date is released', () => {
    const old = copy({ serviceDate: '2026-09-25' });
    expect(blocksLogoutNow(old, '2026-09-28', at(-600), 120, none)).toBe(true);
    expect(blocksLogoutNow(old, '2026-09-28', at(-600), 120, new Set(['2026-09-25']))).toBe(false);
  });
  it('never blocks for a later day or a copy that doesn’t block', () => {
    expect(
      blocksLogoutNow(copy({ serviceDate: '2026-09-29' }), '2026-09-28', at(45), 120, none),
    ).toBe(false);
    expect(blocksLogoutNow(copy({ blocksLogout: false }), '2026-09-28', at(45), 120, none)).toBe(
      false,
    );
  });
});

describe('completion', () => {
  it('leaves closed and cancelled copies out of every total', () => {
    expect(
      completionOf([
        { status: 'done' },
        { status: 'approved' },
        { status: 'submitted' },
        { status: 'overdue' },
        { status: 'todo' },
        { status: 'expired' },
        { status: 'cancelled' },
      ]),
    ).toEqual({ total: 5, done: 2, submitted: 1, overdue: 1 });
  });
});

describe('deferring', () => {
  it('runs from tomorrow up to the limit', () => {
    expect(deferRange('2026-09-28', 14)).toEqual({ from: '2026-09-29', to: '2026-10-12' });
  });
});

describe('day-end forms and answers (brief 9.11)', () => {
  const questions: Question[] = [
    {
      id: 'q1',
      text: 'Every child went home with a known guardian?',
      type: 'yes_no',
      required: true,
      options: [],
    },
    { id: 'q2', text: 'Children present', type: 'number', required: true, options: [] },
    { id: 'q3', text: 'Concerns', type: 'short_text', required: false, options: [] },
    { id: 'q4', text: 'Mood', type: 'pick_one', required: false, options: ['Calm', 'Busy'] },
    { id: 'q5', text: 'Checks', type: 'checklist', required: false, options: ['Lights', 'Doors'] },
  ];

  it('checks answers against each question', () => {
    expect(
      answerProblems(questions, { q1: true, q2: 12, q3: 'None', q4: 'Calm', q5: ['Doors'] }),
    ).toEqual({});
    expect(
      Object.keys(
        answerProblems(questions, { q1: 'yes', q2: 'x', q4: 'Loud', q5: ['Roof'], q9: 1 }),
      ),
    ).toEqual(['q1', 'q2', 'q4', 'q5', 'q9']);
  });

  it('knows which required questions are still unanswered', () => {
    expect(missingRequired(questions, null).map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(missingRequired(questions, { q1: false, q2: 0 })).toEqual([]);
    expect(missingRequired(questions, { q1: true, q2: null }).map((q) => q.id)).toEqual(['q2']);
  });

  it('needs choices for pick-one and checklist questions, and unique ids', () => {
    const base = { name: 'Teacher day-end', roleIds: ['00000000-0000-7000-8000-000000000001'] };
    const bad = dayEndFormInputSchema.safeParse({
      ...base,
      questions: [{ id: 'a', text: 'Pick', type: 'pick_one', required: true, options: ['Only'] }],
    });
    expect(bad.success).toBe(false);
    const dup = dayEndFormInputSchema.safeParse({
      ...base,
      questions: [
        { id: 'a', text: 'One', type: 'yes_no', required: true },
        { id: 'a', text: 'Two', type: 'yes_no', required: true },
      ],
    });
    expect(dup.success).toBe(false);
  });
});

describe('notification events (brief 10.1)', () => {
  it('lists exactly the brief’s events', () => {
    expect(Object.keys(NOTIFICATION_EVENTS)).toEqual([
      'task_assigned',
      'task_due_soon',
      'task_overdue',
      'task_submitted',
      'task_approved',
      'task_sent_back',
      'logout_release_requested',
      'released_for_today',
      'watcher_added',
      'user_waiting_for_role',
      'field_change_needs_approval',
    ]);
    expect(isNotificationEvent('task_exploded')).toBe(false);
  });
});
