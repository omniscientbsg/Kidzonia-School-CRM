/**
 * Statuses of one person's copy of a task (brief 9.4), and the only moves
 * between them. The server enforces these with conditional updates; the app
 * uses the same table to decide which buttons to show.
 */

export const TASK_STATUSES = [
  'todo',
  'in_progress',
  'submitted',
  'approved',
  'done',
  'sent_back',
  'overdue',
  'expired',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  submitted: 'Waiting for approval',
  approved: 'Approved',
  done: 'Done',
  sent_back: 'Sent back',
  overdue: 'Overdue',
  expired: 'Closed',
  cancelled: 'Cancelled',
};

/** Still owed. `expired` is deliberately not open: it can no longer be done. */
export const OPEN_STATUSES = ['todo', 'in_progress', 'sent_back', 'overdue'] as const;
/** Finished work, counted as done in progress figures. */
export const FINISHED_STATUSES = ['approved', 'done'] as const;
/** Nothing more will happen to these. */
export const FINAL_STATUSES = ['approved', 'done', 'expired', 'cancelled'] as const;

export const isOpen = (s: TaskStatus): boolean => (OPEN_STATUSES as readonly string[]).includes(s);
export const isFinished = (s: TaskStatus): boolean =>
  (FINISHED_STATUSES as readonly string[]).includes(s);

/**
 * Who makes a move. `manager` is the task's creator or someone with edit
 * reach over the person; `system` is the Phase 4 background job.
 */
export type StatusActor = 'assignee' | 'approver' | 'manager' | 'system';

export interface StatusMove {
  from: readonly TaskStatus[];
  to: TaskStatus;
  actor: StatusActor;
}

const OPEN: readonly TaskStatus[] = OPEN_STATUSES;

export const STATUS_MOVES = {
  /** Automatic: the first tick, answer or file. */
  start: { from: ['todo'], to: 'in_progress', actor: 'assignee' },
  /** Needs approval. Sub-tasks and required answers are checked separately. */
  submit: { from: OPEN, to: 'submitted', actor: 'assignee' },
  /** No approval needed ("Mark as done"). */
  complete: { from: OPEN, to: 'done', actor: 'assignee' },
  approve: { from: ['submitted'], to: 'approved', actor: 'approver' },
  send_back: { from: ['submitted'], to: 'sent_back', actor: 'approver' },
  mark_overdue: { from: ['todo', 'in_progress', 'sent_back'], to: 'overdue', actor: 'system' },
  expire: { from: OPEN, to: 'expired', actor: 'system' },
  cancel: { from: [...OPEN, 'submitted'], to: 'cancelled', actor: 'manager' },
} as const satisfies Record<string, StatusMove>;

export type StatusMoveName = keyof typeof STATUS_MOVES;

/** Whether `actor` may move a copy from `from` to `to`. */
export function canMove(from: TaskStatus, to: TaskStatus, actor: StatusActor): boolean {
  return Object.values(STATUS_MOVES).some(
    (m: StatusMove) => m.to === to && m.actor === actor && m.from.includes(from),
  );
}

/** The statuses a named move may start from (used in conditional updates). */
export function movableFrom(move: StatusMoveName): readonly TaskStatus[] {
  return STATUS_MOVES[move].from;
}
