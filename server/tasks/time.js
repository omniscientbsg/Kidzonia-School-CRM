// Timezone-correct day boundaries. "End of day" means the end of the SCHOOL's
// local day (node.timezone), not the server's and not the browser's, so a task
// due tonight in Hyderabad is due at 18:29Z regardless of where the API runs.
//
// No dependency: offsets are probed through Intl, per date, so DST is handled.

export const DEFAULT_TZ = 'Asia/Kolkata'

const PARTS = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }

function zoneParts(tz, date) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, ...PARTS })
  const out = {}
  for (const p of fmt.formatToParts(date)) if (p.type !== 'literal') out[p.type] = p.value
  return out
}

// minutes the zone is ahead of UTC at that instant (+330 for Asia/Kolkata)
function offsetMinutes(tz, date) {
  const p = zoneParts(tz, date)
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
  return (asUtc - (date.getTime() - date.getMilliseconds())) / 60000
}

// local wall-clock time in `tz` -> the UTC instant it refers to
export function zonedToUtc(tz, dateStr, h = 0, m = 0, s = 0, ms = 0) {
  const [Y, M, D] = dateStr.split('-').map(Number)
  const guess = Date.UTC(Y, M - 1, D, h, m, s, ms)
  const first = offsetMinutes(tz, new Date(guess))
  let ts = guess - first * 60000
  const second = offsetMinutes(tz, new Date(ts))
  if (second !== first) ts = guess - second * 60000    // we crossed a DST edge
  return new Date(ts)
}

export const localDayStart = (tz, dateStr) => zonedToUtc(tz, dateStr, 0, 0, 0, 0).toISOString()
export const localDayEnd = (tz, dateStr) => zonedToUtc(tz, dateStr, 23, 59, 59, 999).toISOString()

// the calendar date it currently is in `tz`
export function localDate(tz, at = new Date()) {
  const p = zoneParts(tz, at instanceof Date ? at : new Date(at))
  return `${p.year}-${p.month}-${p.day}`
}

export const localToday = (tz) => localDate(tz)

// ------------------------------------------------------- plain date maths ---
export function addDays(dateStr, n) {
  const [Y, M, D] = dateStr.split('-').map(Number)
  const d = new Date(Date.UTC(Y, M - 1, D + n))
  return d.toISOString().slice(0, 10)
}

export function addMonths(dateStr, n) {
  const [Y, M, D] = dateStr.split('-').map(Number)
  const target = new Date(Date.UTC(Y, M - 1 + n, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(D, lastDay)).padStart(2, '0')}`
}

// 0 = Sunday
export function weekdayOf(dateStr) {
  const [Y, M, D] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(Y, M - 1, D)).getUTCDay()
}

export function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

// End of the current school week (Sunday) for a local date. Used to split
// "this week" from "upcoming" the way a school actually talks about it.
export function endOfWeek(dateStr) {
  const dow = weekdayOf(dateStr)
  return addDays(dateStr, dow === 0 ? 0 : 7 - dow)
}

export const maxDate = (...ds) => ds.filter(Boolean).sort().slice(-1)[0] || null
export const minDate = (...ds) => ds.filter(Boolean).sort()[0] || null

// clamp a day-of-month to a month that is shorter (31 -> 30 -> 28/29)
export function clampDayOfMonth(year, monthIndex, day) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return Math.min(day, last)
}
