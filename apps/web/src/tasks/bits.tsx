import { STATUS_LABEL, isFinished, localDate } from '@kidzonia/shared';
import type { Category, Priority, Progress, TaskStatus } from '@kidzonia/shared';
import { IconCheck, IconFlag, IconLock } from '@tabler/icons-react';
import { serverNow } from '../lib/clock';
import { Avatar } from '../ui/Avatar';

/** The status chip, in the demo's colours. */
export function StatusChip({ status }: { status: TaskStatus }) {
  return <span className={`chip st-${status}`}>{STATUS_LABEL[status]}</span>;
}

/** The round marker at the start of a task row. */
export function StatusRing({ status }: { status: TaskStatus }) {
  const done = isFinished(status);
  return (
    <span className={`ring st-${status}`} aria-hidden="true">
      {done && <IconCheck size={14} stroke={3} />}
    </span>
  );
}

export function CategoryTag({ category }: { category: Category | null | undefined }) {
  if (!category) return null;
  return (
    <span className="tag">
      <i className="dot" style={{ background: category.color }} />
      {category.name}
    </span>
  );
}

export function PriorityTag({ priority }: { priority: Priority | null | undefined }) {
  if (!priority) return null;
  return (
    // The colour goes on the flag only: a chosen colour as text can fail contrast (in dark mode especially).
    <span className="tag prio">
      <IconFlag size={14} aria-hidden="true" style={{ color: priority.color }} />
      {priority.name}
    </span>
  );
}

export function LockChip({ short = false }: { short?: boolean }) {
  return (
    <span className="chip lock">
      <IconLock size={12} aria-hidden="true" />
      {short ? 'Before logout' : 'Submit before logout'}
    </span>
  );
}

/** "7 of 10 done" with the demo's bar: green-ish at 75%+, amber at 50%+, red below. */
export function ProgressBar({ progress, width = 70 }: { progress: Progress; width?: number }) {
  const done = progress.done + progress.submitted;
  const pct = progress.total ? Math.round((done / progress.total) * 100) : 0;
  const cls = pct >= 75 ? '' : pct >= 50 ? 'warn' : 'bad';
  return (
    <>
      <span className="small muted">
        {done} of {progress.total}
      </span>
      <span
        className={`bar ${cls}`}
        style={{ width }}
        role="img"
        aria-label={`${String(done)} of ${String(progress.total)} done or submitted`}
      >
        <i style={{ width: `${String(pct)}%` }} />
      </span>
    </>
  );
}

const dayFormat = (tz: string) =>
  new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: tz,
  });
const timeFormat = (tz: string) =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz });

/** "9:30 am" in the organisation's time zone. */
export function clockTime(iso: string, tz: string): string {
  return timeFormat(tz).format(new Date(iso)).toLowerCase().replace(/\s+/g, ' ');
}

/** "HH:MM" → "1:00 pm". */
export function wallTime(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${String(hour)}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

export function dayLabel(date: string, today: string, tz: string): string {
  if (date === today) return 'Today';
  return dayFormat(tz).format(new Date(`${date}T12:00:00Z`));
}

/** Today in the organisation, by the server's clock (not the device's). */
export const todayIn = (tz: string) => localDate(serverNow(), tz);

/** When a copy is due, e.g. "Today, 9:30 am" or "Wed, 30 Sep, end of day". */
export function copyDue(
  c: { serviceDate: string; dueAt?: string | undefined; dueType?: string | undefined },
  tz: string,
): string | null {
  if (!c.dueAt) return null;
  const day = dayLabel(c.serviceDate, todayIn(tz), tz);
  return c.dueType === 'end_of_day' ? `${day}, end of day` : `${day}, ${clockTime(c.dueAt, tz)}`;
}

/** When a task is due, as a rule (for Assigned by me and the drawer). */
export function taskDue(
  t: {
    dueType?: string | undefined;
    dueTime?: string | null | undefined;
    dueDate?: string | null | undefined;
  },
  tz: string,
): string | null {
  if (!t.dueType) return null;
  if (t.dueType === 'on_date' && t.dueDate) {
    const day = dayLabel(t.dueDate, todayIn(tz), tz);
    return t.dueTime ? `${day}, ${wallTime(t.dueTime)}` : day;
  }
  if (t.dueType === 'at_time' && t.dueTime) return wallTime(t.dueTime);
  return 'End of day';
}

export function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function PersonCell({
  person,
  sub,
}: {
  person: {
    fullName: string;
    jobTitle?: string | null;
    schoolName?: string | null;
    photoUrl?: string | null | undefined;
  };
  sub?: string;
}) {
  const detail = sub ?? [person.jobTitle, person.schoolName].filter(Boolean).join(', ');
  return (
    <span className="person">
      <Avatar name={person.fullName} photoUrl={person.photoUrl} size="sm" />
      <span>
        <b>{person.fullName}</b>
        {detail && <span>{detail}</span>}
      </span>
    </span>
  );
}
