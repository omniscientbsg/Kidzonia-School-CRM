/**
 * Dates for tasks (brief 9.5). Pure functions over plain "YYYY-MM-DD" dates
 * and "HH:MM" times, so they're easy to test and give the same answer on the
 * server and in the app.
 *
 * A copy's service date is the local date of its deadline in the person's
 * school (lesson from the old build: never let the two drift apart).
 */

export type IsoDate = string;

export interface WorkCalendar {
  /** IANA time zone of the organisation, e.g. "Asia/Kolkata". */
  timezone: string;
  /** Weekday numbers 0 (Sunday) to 6. */
  workingDays: readonly number[];
  opensAt: string;
  closesAt: string;
  /** Holidays that apply to this school, as inclusive date ranges. */
  holidays: readonly { start: IsoDate; end: IsoDate }[];
}

export interface DueRule {
  dueType: 'end_of_day' | 'at_time' | 'on_date';
  dueTime: string | null;
  dueDate: IsoDate | null;
  repeat: 'none' | 'daily' | 'weekly' | 'monthly';
  repeatWeekdays: readonly number[];
  repeatMonthDay: number | null;
  repeatStartDate: IsoDate;
  repeatEndDate: IsoDate | null;
  closesAfterMinutes: number | null;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(date: IsoDate): [number, number, number] {
  const m = DATE.exec(date);
  if (!m) throw new Error(`Not a date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0 (Sunday) to 6. */
export function weekdayOf(date: IsoDate): number {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function daysInMonth(date: IsoDate): number {
  const [y, m] = parts(date);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, f);
  }
  return f;
}

function zonedFields(instant: Date, timezone: string) {
  const out: Record<string, number> = {};
  for (const p of formatter(timezone).formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
}

/** The local calendar date of an instant in a time zone. */
export function localDate(instant: Date, timezone: string): IsoDate {
  const f = zonedFields(instant, timezone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(f.year)}-${pad(f.month)}-${pad(f.day)}`;
}

/** How far the zone is ahead of UTC at an instant, in milliseconds. */
function offsetAt(instant: Date, timezone: string): number {
  const f = zonedFields(instant, timezone);
  const asUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant a local date and "HH:MM" time happen in a time zone. */
export function zonedInstant(date: IsoDate, time: string, timezone: string): Date {
  const [y, m, d] = parts(date);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh ?? 0, mm ?? 0);
  // Guess with the offset at the wall time, then correct once for a DST edge.
  let at = wall - offsetAt(new Date(wall), timezone);
  at = wall - offsetAt(new Date(at), timezone);
  return new Date(at);
}

export function isHoliday(cal: WorkCalendar, date: IsoDate): boolean {
  return cal.holidays.some((h) => h.start <= date && date <= h.end);
}

export function isWorkingDay(cal: WorkCalendar, date: IsoDate): boolean {
  return cal.workingDays.includes(weekdayOf(date)) && !isHoliday(cal, date);
}

/** Whether a repeating rule falls on a date (before working days are applied). */
export function occursOn(rule: DueRule, date: IsoDate): boolean {
  switch (rule.repeat) {
    case 'none':
      return true;
    case 'daily':
      return true;
    case 'weekly':
      return rule.repeatWeekdays.includes(weekdayOf(date));
    case 'monthly': {
      const want = Math.min(rule.repeatMonthDay ?? 1, daysInMonth(date));
      return parts(date)[2] === want;
    }
  }
}

/**
 * The deadline of a copy on a service date. "End of day" is the closing time
 * of the person's own school; a fixed time is never moved.
 */
export function dueAtFor(rule: DueRule, date: IsoDate, cal: WorkCalendar): Date {
  const time = rule.dueType === 'end_of_day' ? cal.closesAt : (rule.dueTime ?? cal.closesAt);
  return zonedInstant(date, time, cal.timezone);
}

export function closesAtFor(rule: DueRule, dueAt: Date): Date | null {
  return rule.closesAfterMinutes === null
    ? null
    : new Date(dueAt.getTime() + rule.closesAfterMinutes * 60_000);
}

export interface PlannedCopy {
  serviceDate: IsoDate;
  dueAt: Date;
  closesAt: Date | null;
}

/**
 * Service dates for one person between `from` and `to` (inclusive), in order.
 * Repeating tasks skip non-working days and holidays of the person's school
 * and never plan a copy whose deadline has already passed. A one-time task has
 * exactly one date, chosen by the creator, and is never skipped.
 */
export function planDates(
  rule: DueRule,
  cal: WorkCalendar,
  from: IsoDate,
  to: IsoDate,
  now: Date,
): PlannedCopy[] {
  const make = (serviceDate: IsoDate): PlannedCopy => {
    const dueAt = dueAtFor(rule, serviceDate, cal);
    return { serviceDate, dueAt, closesAt: closesAtFor(rule, dueAt) };
  };
  if (rule.repeat === 'none') {
    const date = rule.dueType === 'on_date' && rule.dueDate ? rule.dueDate : rule.repeatStartDate;
    return date >= from && date <= to ? [make(date)] : [];
  }
  const out: PlannedCopy[] = [];
  let date = from < rule.repeatStartDate ? rule.repeatStartDate : from;
  while (date <= to && (rule.repeatEndDate === null || date <= rule.repeatEndDate)) {
    if (occursOn(rule, date) && isWorkingDay(cal, date)) {
      const copy = make(date);
      if (copy.dueAt > now) out.push(copy);
    }
    date = addDays(date, 1);
  }
  return out;
}

/** Enough days ahead to find the first copy of any rule (monthly needs two months). */
export const FIRST_COPY_WINDOW_DAYS = 62;

/** The first copy for one person, or null if the rule never lands in the window. */
export function firstCopy(
  rule: DueRule,
  cal: WorkCalendar,
  today: IsoDate,
  now: Date,
): PlannedCopy | null {
  if (rule.repeat === 'none')
    return planDates(rule, cal, '0000-01-01', '9999-12-31', now)[0] ?? null;
  return planDates(rule, cal, today, addDays(today, FIRST_COPY_WINDOW_DAYS), now)[0] ?? null;
}
