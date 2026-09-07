// When a person's working day actually ends.
//
// "By end of the day" used to mean 23:59 in the school's timezone for everyone.
// It now means the end of THAT PERSON's shift, because that is what the words
// mean to the person reading them. Resolution is always position → node →
// nothing, since one person can hold two positions at two schools with
// different weeks.
//
// Lives here rather than in tasks/time.js (which is deliberately dependency-free
// timezone maths, unit-tested on its own) and rather than in tasks/generate.js
// (because escalation needs the same resolver for the APPROVER's clock).
//
// Pure: takes the rows, never the ids, so it touches no database and can be
// tested against a literal.
import { weekdayOf, localDayEnd, zonedToUtc } from '../tasks/time.js'
import { parseClockTime } from '../tasks/model.js'

export const DEFAULT_WORK_WEEK = [1, 2, 3, 4, 5, 6]

export function workScheduleFor(pos, node) {
  return {
    workWeek: pos?.workWeek ?? node?.settings?.workWeek ?? null,
    hours: pos?.hours ?? node?.settings?.hours ?? null,
  }
}

// The instant this person's day closes on `dateStr`, in their school's zone.
//
// Falls back to the end of the local calendar day when nothing is configured,
// AND on a day with no shift at all. That fallback is not a convenience — it is
// forced by an invariant three things depend on:
//
//     localDate(tz, dueAt) === serviceDate
//
// The gate (gate.js), the day-end roll-up (dayend.js) and the end-of-day nudge
// (notify.js) all read it. Rolling to the next working day's shift end would put
// the deadline in a different local day and break all three.
export function shiftEndsAt(pos, node, tz, dateStr) {
  const { hours } = workScheduleFor(pos, node)
  const slot = hours?.[String(weekdayOf(dateStr))]
  const at = slot?.to ? parseClockTime(slot.to) : null
  if (!at) return localDayEnd(tz, dateStr)
  // :59.999 mirrors localDayEnd. "17:30" means up to and including 17:30:59.999,
  // so submitting at exactly 17:30:00 is not late — otherwise everyone whose
  // shift ends on the minute gets a one-minute-wide race against the clock.
  return zonedToUtc(tz, dateStr, at.h, at.m, 59, 999).toISOString()
}

// Does this person work that day? Used by the generator in place of the node's
// week, so a part-time teacher stops getting Wednesday occurrences.
export function worksOn(pos, node, dateStr) {
  const { workWeek } = workScheduleFor(pos, node)
  return !workWeek?.length || workWeek.includes(weekdayOf(dateStr))
}

// Is this position live on that date? `effectiveFrom`/`effectiveTo` bound a
// placement in time — somebody who starts next month should not collect
// occurrences this month, and somebody who left should stop collecting them
// without their past work disappearing.
export function inServiceOn(pos, dateStr) {
  if (!pos) return false
  if (pos.effectiveFrom && dateStr < pos.effectiveFrom) return false
  if (pos.effectiveTo && dateStr > pos.effectiveTo) return false
  return true
}
