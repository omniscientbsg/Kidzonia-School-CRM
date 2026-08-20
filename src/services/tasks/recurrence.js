// Client MIRROR of server/tasks/recurrence.js — used for the "next few dates"
// hint in the task form. The server is still the one that materializes them.

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const FREQ_OPTIONS = [
  ['none', 'One-off'],
  ['daily', 'Every day'],
  ['weekdays', 'Specific weekdays'],
  ['weekly', 'Weekly'],
  ['monthly', 'Monthly'],
]

export function describeRecurrence(rec = {}) {
  const many = rec.interval > 1
  switch (rec.freq) {
    case 'daily': return many ? `Every ${rec.interval} days` : 'Every day'
    case 'weekdays': return `Weekly on ${(rec.byWeekday || []).map((d) => WEEKDAYS[d]).join(', ')}`
    case 'weekly': return `${many ? `Every ${rec.interval} weeks` : 'Weekly'} on ${WEEKDAYS[(rec.byWeekday || [])[0] ?? 1]}`
    case 'monthly': return `${many ? `Every ${rec.interval} months` : 'Monthly'} on day ${rec.dayOfMonth}`
    default: return 'One-off'
  }
}

const addDays = (d, n) => {
  const [Y, M, D] = d.split('-').map(Number)
  return new Date(Date.UTC(Y, M - 1, D + n)).toISOString().slice(0, 10)
}
const weekdayOf = (d) => {
  const [Y, M, D] = d.split('-').map(Number)
  return new Date(Date.UTC(Y, M - 1, D)).getUTCDay()
}

// first `limit` dates from `from` — preview only, no DST or work-week subtlety
export function nextOccurrences(rec = {}, from, limit = 5) {
  const start = rec.startDate || from
  if (rec.freq === 'none') return [start]
  const out = []
  let day = start
  for (let i = 0; i < 400 && out.length < limit; i++, day = addDays(day, 1)) {
    if (rec.endDate && day > rec.endDate) break
    const dow = weekdayOf(day)
    const interval = Math.max(1, Number(rec.interval) || 1)
    let hit = false
    if (rec.freq === 'daily') hit = true
    else if (rec.freq === 'weekdays') hit = (rec.byWeekday || []).includes(dow)
    else if (rec.freq === 'weekly') hit = (rec.byWeekday || [])[0] === dow
    else if (rec.freq === 'monthly') hit = Number(day.slice(8)) === Number(rec.dayOfMonth)
    if (!hit) continue
    if (rec.freq === 'daily' && interval > 1) {
      const diff = Math.round((Date.parse(day) - Date.parse(start)) / 86400000)
      if (diff % interval !== 0) continue
    }
    if (day >= from) out.push(day)
  }
  return out
}
