import { localDate } from '@kidzonia/shared';
import type { IsoDate, WorkCalendar } from '@kidzonia/shared';
import type { ScopedTx } from '../../db/index.js';

export const toIsoDate = (d: Date): IsoDate => d.toISOString().slice(0, 10);
export const fromIsoDate = (d: IsoDate): Date => new Date(`${d}T00:00:00Z`);

export interface Calendars {
  timezone: string;
  /** Today in the organisation's time zone. */
  today: IsoDate;
  /** The working calendar of a school (null = head office, i.e. the organisation's). */
  forSchool(schoolId: string | null): WorkCalendar;
}

/**
 * Working days, hours and holidays for the organisation and every school, in
 * one go. One holiday list (lesson from the old build): a holiday with no
 * schools applies everywhere, otherwise only to the schools listed.
 */
export async function loadCalendars(
  tx: ScopedTx,
  now: Date,
  horizon: { from: IsoDate; to: IsoDate } | null = null,
): Promise<Calendars> {
  const [org, schools] = await Promise.all([
    tx.organisation.findFirstOrThrow({
      select: { timezone: true, workingDays: true, opensAt: true, closesAt: true },
    }),
    tx.school.findMany({
      where: { deletedAt: null },
      select: { id: true, workingDays: true, opensAt: true, closesAt: true },
    }),
  ]);
  const today = localDate(now, org.timezone);
  const from = horizon?.from ?? today;
  const holidays = await tx.holiday.findMany({
    where: {
      deletedAt: null,
      endDate: { gte: fromIsoDate(from) },
      ...(horizon ? { startDate: { lte: fromIsoDate(horizon.to) } } : {}),
    },
    select: { startDate: true, endDate: true, schools: { select: { schoolId: true } } },
  });

  const orgCalendar: WorkCalendar = {
    timezone: org.timezone,
    workingDays: org.workingDays,
    opensAt: org.opensAt,
    closesAt: org.closesAt,
    holidays: holidays
      .filter((h) => h.schools.length === 0)
      .map((h) => ({ start: toIsoDate(h.startDate), end: toIsoDate(h.endDate) })),
  };
  const bySchool = new Map<string, WorkCalendar>();
  for (const s of schools) {
    bySchool.set(s.id, {
      timezone: org.timezone,
      workingDays: s.workingDays.length > 0 ? s.workingDays : org.workingDays,
      opensAt: s.opensAt ?? org.opensAt,
      closesAt: s.closesAt ?? org.closesAt,
      holidays: holidays
        .filter((h) => h.schools.length === 0 || h.schools.some((x) => x.schoolId === s.id))
        .map((h) => ({ start: toIsoDate(h.startDate), end: toIsoDate(h.endDate) })),
    });
  }
  return {
    timezone: org.timezone,
    today,
    forSchool: (schoolId) => (schoolId ? (bySchool.get(schoolId) ?? orgCalendar) : orgCalendar),
  };
}
