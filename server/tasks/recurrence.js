// Pure recurrence expansion: a rule + a window -> local calendar dates.
// Nothing here touches the database, so it is unit-testable on its own and the
// client can mirror it for the "next few occurrences" preview.
import { addDays, weekdayOf, daysBetween, clampDayOfMonth } from './time.js'

const MAX_ITER = 800   // ~2 years of daily scanning; guards against silly rules

// -> ['2026-08-08', '2026-08-10', …] between from..to (inclusive), in order
// `holidays` is a Set of YYYY-MM-DD; both it and workWeek only apply when the
// template opts in with skipNonWorkingDays.
export function occurrencesBetween(recurrence = {}, from, to, { workWeek = null, holidays = null, anchor = null } = {}) {
  const rec = { freq: 'none', interval: 1, byWeekday: [], dayOfMonth: null, count: null, ...recurrence }
  const start = rec.startDate || anchor || from
  const end = rec.endDate && rec.endDate < to ? rec.endDate : to
  if (!start || !end || start > end) return []

  if (rec.freq === 'none') {
    const only = start
    return only >= from && only <= end ? [only] : []
  }

  const hits = []
  let produced = 0
  let day = start
  for (let i = 0; i < MAX_ITER && day <= end; i++, day = addDays(day, 1)) {
    if (!matches(rec, start, day)) continue
    produced++
    if (rec.count && produced > rec.count) break
    if (day < from) continue
    if (rec.skipNonWorkingDays) {
      if (workWeek && !workWeek.includes(weekdayOf(day))) continue      // weekly closure
      if (holidays && holidays.has(day)) continue                       // school calendar
    }
    hits.push(day)
  }
  return hits
}

function matches(rec, start, day) {
  const interval = Math.max(1, Number(rec.interval) || 1)
  switch (rec.freq) {
    case 'daily':
      return daysBetween(start, day) % interval === 0
    case 'weekdays':
      return rec.byWeekday.includes(weekdayOf(day))
    case 'weekly': {
      if (!rec.byWeekday.includes(weekdayOf(day))) return false
      // count whole weeks from the first matching weekday on/after `start`
      const firstHit = firstWeekdayOnOrAfter(start, rec.byWeekday[0])
      if (day < firstHit) return false
      return Math.floor(daysBetween(firstHit, day) / 7) % interval === 0
    }
    case 'monthly': {
      const [Y, M, D] = day.split('-').map(Number)
      if (D !== clampDayOfMonth(Y, M - 1, rec.dayOfMonth)) return false
      const [sy, sm] = start.split('-').map(Number)
      const monthsApart = (Y - sy) * 12 + (M - sm)
      return monthsApart >= 0 && monthsApart % interval === 0
    }
    default:
      return false
  }
}

function firstWeekdayOnOrAfter(dateStr, weekday) {
  let d = dateStr
  for (let i = 0; i < 7; i++, d = addDays(d, 1)) if (weekdayOf(d) === weekday) return d
  return dateStr
}

// Human summary for cards and the task form.
export function describeRecurrence(rec = {}) {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const every = rec.interval > 1 ? `every ${rec.interval} ` : ''
  switch (rec.freq) {
    case 'daily': return rec.interval > 1 ? `Every ${rec.interval} days` : 'Every day'
    case 'weekdays': return `Weekly on ${(rec.byWeekday || []).map((d) => DAYS[d]).join(', ')}`
    case 'weekly': return `${every ? `Every ${rec.interval} weeks` : 'Weekly'} on ${DAYS[(rec.byWeekday || [])[0] ?? 1]}`
    case 'monthly': return `${every ? `Every ${rec.interval} months` : 'Monthly'} on day ${rec.dayOfMonth}`
    default: return 'One-off'
  }
}
