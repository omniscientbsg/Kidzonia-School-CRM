// Status vocabulary shared by every Tasks screen. Mirrors server/tasks/model.js.

export const OPEN_STATUSES = ['assigned', 'in_progress', 'rejected', 'overdue']

// Four words, not eight. The engine keeps all its states; a person reading a
// list only ever needs to know whose move it is.
export const STATUS_LABEL = {
  assigned: 'To do',
  in_progress: 'Doing',
  submitted: 'Waiting on manager',
  approved: 'Done',
  rejected: 'Sent back',
  overdue: 'Late',
  cancelled: 'Cancelled',
  deferred: 'Pushed',
}

export const STATUS_COLOR = {
  assigned: 'gray',
  in_progress: 'plum',
  submitted: 'yellow',
  approved: 'green',
  rejected: 'red',
  overdue: 'red',
  cancelled: 'gray',
  deferred: 'yellow',
}

export const PRIORITY_LABEL = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }
export const PRIORITY_COLOR = { low: 'gray', normal: '', high: 'orange', urgent: 'red' }

export const TARGET_KIND_LABEL = {
  position: 'Pick people',
  user: 'Pick people',
  node: 'Everyone at a school',
  node_level: 'Everyone with a job title (all teachers, all principals…)',
  downline: 'Everyone below me',
}

export const isOpen = (inst) => OPEN_STATUSES.includes(inst.status)

// Rejection hands work back as `in_progress` (it is live work again, and still
// blocks logout). The UI must not lose that it was sent back, so the pill is
// derived: in progress + an unresolved rejection reads "Sent back".
export function displayStatus(inst) {
  if (!inst) return null
  if (inst.status === 'in_progress' && inst.rejectionCount > 0 && !inst.submittedAt) return 'rejected'
  return inst.status
}

// One terminal state in the data, two words for it in the UI: work that needed
// a sign-off was "approved", work that did not was simply "completed".
export function statusLabel(inst) {
  if (inst?.status === 'approved') return inst.requiresApproval ? 'Signed off' : 'Done'
  return STATUS_LABEL[displayStatus(inst)] || inst?.status
}

export const statusColor = (inst) => STATUS_COLOR[displayStatus(inst)] || 'gray'

// Live time-left for an end-of-day task. Returns null when there is no useful
// countdown to show (already closed, or days away).
export function countdown(inst, now = Date.now()) {
  if (!inst?.dueAt || !OPEN_STATUSES.includes(inst.status)) return null
  const ms = Date.parse(inst.dueAt) - now
  if (ms > 24 * 3600000) return null
  if (ms <= 0) return { text: 'past due', urgent: true, expired: true }
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return {
    text: h > 0 ? `${h}h ${m}m left` : m > 0 ? `${m}m ${s}s left` : `${s}s left`,
    urgent: ms < 2 * 3600000,
    expired: false,
  }
}

// "Due today 6:00 pm" / "Due 12 Sep" — always rendered in the school's zone,
// never the browser's.
export function dueLabel(inst, today = null) {
  if (!inst?.dueAt) return '—'
  const tz = inst.tz || 'Asia/Kolkata'
  const d = new Date(inst.dueAt)
  const day = new Intl.DateTimeFormat('en-IN', { timeZone: tz, day: 'numeric', month: 'short' }).format(d)
  const time = new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
  const onDay = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
  if (today && onDay === today) return `Due today, ${time}`
  return `Due ${day}, ${time}`
}

export function daysLate(inst, today) {
  if (!inst?.serviceDate || !today || inst.serviceDate >= today) return 0
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${inst.serviceDate}T00:00:00Z`)) / 86400000)
}
