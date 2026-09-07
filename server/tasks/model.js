// Shape + validation for task templates. Kept separate from the routes so the
// same rules apply wherever a task is written (routes, seed, future importers).
import { list } from '../db.js'
import { normalizeCompletion, NATURES, ORIGINS } from './conditions.js'
import { targetSpec, deriveKind, defaultFollowJoiners } from './resolve.js'
import { priorityIdOf } from './priorities.js'

export { NATURES, ORIGINS }

// Kept for the legacy strings a pre-V11 caller may still send. The stored value
// is now an id into `taskPriorities`; priorityIdOf() accepts either.
export const PRIORITIES = ['low', 'normal', 'high', 'urgent']
// `at_time` is a deadline with a clock on it — "by 3pm", in the school's own
// timezone. Everything downstream already works off the resulting instant
// (overdue, the countdown, the escalation SLA), so only generation changes.
// The logout gate deliberately keeps its own rule: mandatory work blocks once
// its DAY has ended, not at 3:01pm, so nobody is locked out mid-afternoon.
export const DUE_TYPES = ['end_of_day', 'at_time', 'date_window', 'n_days']
export const RECURRENCE_FREQS = ['none', 'daily', 'weekdays', 'weekly', 'monthly']
export const TARGET_KINDS = ['position', 'user', 'node', 'node_level', 'downline']
export const MEDIA_TYPES = ['photo', 'document', 'video']

export const MEDIA_MIME = {
  photo: (m) => m.startsWith('image/'),
  video: (m) => m.startsWith('video/'),
  document: (m) => /pdf|word|excel|powerpoint|spreadsheet|document|presentation|text\/|csv|officedocument|opendocument/i.test(m),
}

export const TASK_STATUSES = ['active', 'paused', 'cancelled']

export const INSTANCE_STATUSES = [
  'assigned', 'in_progress', 'submitted', 'approved', 'rejected', 'overdue', 'cancelled', 'deferred',
]
// statuses that still need work from the assignee
export const OPEN_STATUSES = ['assigned', 'in_progress', 'rejected', 'overdue']
export const TERMINAL_STATUSES = ['approved', 'cancelled']

const isoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const isClockTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)

// "15:30" -> { h: 15, m: 30 }
export function parseClockTime(v) {
  if (!isClockTime(v)) return null
  const [h, m] = v.split(':').map(Number)
  return { h, m }
}

// Fills defaults and coerces types. Returns { task, errors } — never throws.
export function normalizeTask(body = {}, { existing = null } = {}) {
  const errors = []
  const src = { ...existing, ...body }

  const title = String(src.title || '').trim()
  if (!title) errors.push('title is required')

  // an id, or one of the four legacy strings, or nothing -> the default row
  const priority = priorityIdOf(src.priority)

  // Tags are a controlled list: anything not in the master is dropped rather
  // than stored, so the filter can never grow a value nobody can select.
  const known = new Set(list('taskTags', (t) => t.active !== false).map((t) => t.id))
  const tagIds = [...new Set((Array.isArray(src.tagIds) ? src.tagIds : []).map(String))].filter((id) => known.has(id))
  const dueType = DUE_TYPES.includes(src.dueType) ? src.dueType : 'end_of_day'

  const dueConfig = { startDate: null, dueDate: null, days: null, time: null, ...(src.dueConfig || {}) }
  if (dueType === 'at_time') {
    if (!isClockTime(dueConfig.time)) errors.push('give a time of day as HH:MM (24-hour)')
  }
  if (dueType === 'date_window') {
    if (!isoDate(dueConfig.startDate) || !isoDate(dueConfig.dueDate)) errors.push('date_window needs startDate and dueDate (YYYY-MM-DD)')
    else if (dueConfig.dueDate < dueConfig.startDate) errors.push('dueDate must be on or after startDate')
  }
  if (dueType === 'n_days') {
    const days = Number(dueConfig.days)
    if (!Number.isInteger(days) || days < 1) errors.push('n_days needs a whole number of days (>= 1)')
    else dueConfig.days = days
  }

  const rec = { freq: 'none', byWeekday: [], dayOfMonth: null, interval: 1, startDate: null, endDate: null, count: null, skipNonWorkingDays: false, ...(src.recurrence || {}) }
  if (!RECURRENCE_FREQS.includes(rec.freq)) errors.push(`recurrence.freq must be one of ${RECURRENCE_FREQS.join(', ')}`)
  rec.interval = Math.max(1, Number(rec.interval) || 1)
  if (rec.freq === 'weekdays') {
    rec.byWeekday = (rec.byWeekday || []).map(Number).filter((d) => d >= 0 && d <= 6)
    if (!rec.byWeekday.length) errors.push('weekday recurrence needs at least one weekday')
  }
  if (rec.freq === 'weekly') {
    const day = rec.byWeekday?.[0]
    if (day === undefined || day === null) errors.push('weekly recurrence needs a weekday')
    else rec.byWeekday = [Number(day)]
  }
  if (rec.freq === 'monthly') {
    const d = Number(rec.dayOfMonth)
    if (!Number.isInteger(d) || d < 1 || d > 31) errors.push('monthly recurrence needs dayOfMonth 1-31')
    else rec.dayOfMonth = d
  }
  if (rec.startDate && !isoDate(rec.startDate)) errors.push('recurrence.startDate must be YYYY-MM-DD')
  if (rec.endDate && !isoDate(rec.endDate)) errors.push('recurrence.endDate must be YYYY-MM-DD')
  if (rec.startDate && rec.endDate && rec.endDate < rec.startDate) errors.push('recurrence.endDate must be on or after startDate')
  // a recurring task with a fixed window would regenerate the same window forever
  if (rec.freq !== 'none' && dueType === 'date_window') errors.push('recurring tasks cannot use a fixed date window — use end of day or n days')

  // ONE SHAPE. Three independent lists that genuinely combine, minus anyone
  // named as an exclusion. targetSpec() reads either the new shape or a stored
  // pre-V10 `kind`, so an un-updated client keeps working.
  const spec = targetSpec(src.target)
  const target = {
    ...spec,
    // followJoiners replaces what `kind` used to encode. Left unset it defaults
    // to today's behaviour: frozen when people are named, live otherwise.
    followJoiners: src.target?.followJoiners ?? spec.followJoiners ?? defaultFollowJoiners(spec),
    // derived, display-only — AssignedByMe and the audit log read it; nothing
    // resolves off it any more
    kind: deriveKind(spec),
    // still written so anything reading the pre-multi-role field keeps working
    levelId: spec.levelIds[0] || null,
  }
  // The only way to target nobody is to name nothing at all, which is
  // `downline` — legal, and means "everyone below me".
  if (target.excludePositionIds.length && !target.positionIds.length && !target.userIds.length
      && !target.levelIds.length && !target.nodeIds.length) {
    errors.push('excluding people only makes sense once you have chosen who it is for')
  }

  // ---- axis 2: how completion is verified. Independent of the axis above:
  // any origin may carry any nature.
  // the hooks live beside the condition on the task, so they have to be handed
  // back in on edit or a title change would silently drop them
  const completion = normalizeCompletion({
    ...(src.completionCondition || {}),
    onComplete: src.onComplete,
    lockOnComplete: src.lockOnComplete,
  }, { defaults: src })
  errors.push(...completion.errors)

  const mediaTypes = (src.mediaTypes || ['photo', 'document']).filter((t) => MEDIA_TYPES.includes(t))
  // an MCQ that asks for proof sets the SAME media fields the rest of the
  // engine already enforces — there is no second media rule
  const requiresMedia = !!src.requiresMedia || completion.impliesMedia
  if (requiresMedia && !mediaTypes.length) errors.push('choose at least one allowed media type')

  // ---- axis 1: where the task came from. Recurrence implies automated unless
  // the caller (the seed, a system template) says otherwise.
  const origin = ORIGINS.includes(src.origin) ? src.origin : (rec.freq === 'none' ? 'manual' : 'automated')

  const task = {
    origin,
    systemKey: src.systemKey || null,
    // Where this sorts in the logout gate. The day-end report sets 100 so it
    // comes last; everything else is 0. It has to be carried through here or a
    // PUT on the template writes `undefined` over the value on every future
    // occurrence (it is in SNAPSHOT_FIELDS) and the report stops sorting last.
    gateOrder: Number.isFinite(Number(src.gateOrder)) ? Number(src.gateOrder) : 0,
    completionCondition: completion.condition,
    onComplete: completion.onComplete,
    lockOnComplete: completion.lockOnComplete,
    // Approval escalation policy. Null = the existing single-approver
    // behaviour; ordered ancestor stages arrive with the escalation slice.
    escalationPolicyId: src.escalationPolicyId || null,
    title,
    description: String(src.description || '').trim(),
    target,
    priority,
    tagIds,
    categoryId: src.categoryId || null,
    dueType,
    dueConfig,
    recurrence: rec,
    requiresApproval: !!src.requiresApproval,
    approverPositionId: src.approverPositionId || null,
    requiresMedia,
    mediaTypes,
    minAttachments: requiresMedia ? Math.max(1, Number(src.minAttachments) || 1) : 0,
    isBlocking: !!src.isBlocking,
    status: TASK_STATUSES.includes(src.status) ? src.status : 'active',
    academicYearId: src.academicYearId || null,
  }
  return { task, errors }
}
