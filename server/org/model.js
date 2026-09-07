// Shape + validation for an org position, in one place.
//
// The row used to be written out by hand in four: the create route, the bulk
// import, the synthetic super-admin position in tree.js, and the seed. They had
// already drifted — `title`, `isPrimary` and `startDate` were overridable in one
// and hardcoded in the other — and a new field added to one door would silently
// not persist through the others.
//
// Mirrors server/tasks/model.js: returns { position, errors }, never throws.
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]
const STATUSES = ['active', 'on_leave', 'left']

const isoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const isClock = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
const minutesOf = (v) => { const [h, m] = v.split(':').map(Number); return h * 60 + m }

// null means "inherit from the node". An empty array would mean "works no days",
// which is a different and almost never intended thing.
export function normalizeWorkWeek(v) {
  if (v === undefined || v === null) return null
  if (!Array.isArray(v)) return null
  const days = [...new Set(v.map(Number))].filter((d) => WEEKDAYS.includes(d)).sort((a, b) => a - b)
  return days.length ? days : null
}

// { '1': { from: '08:00', to: '16:00' }, … } — keyed by weekday number AS A
// STRING, because that is what survives JSON.stringify. Key it by number and
// every lookup silently misses.
export function normalizeHours(v, errors = []) {
  if (v === undefined || v === null) return null
  if (typeof v !== 'object' || Array.isArray(v)) return null
  const out = {}
  for (const day of WEEKDAYS) {
    const slot = v[String(day)] ?? v[day]
    if (!slot) continue
    const from = String(slot.from || '').trim()
    const to = String(slot.to || '').trim()
    if (!from && !to) continue
    if (!isClock(from) || !isClock(to)) {
      errors.push(`working hours for day ${day} need a start and an end as HH:MM`)
      continue
    }
    // A shift crossing midnight cannot be represented, and this is a real limit
    // of the model rather than an oversight: the engine relies on
    // localDate(tz, dueAt) === serviceDate, which the gate, the day-end roll-up
    // and the end-of-day nudge all read. A 22:00 -> 06:00 night shift would put
    // the deadline on the following day and break all three. Refuse it loudly
    // instead of storing something that quietly lands on the wrong date.
    if (minutesOf(to) <= minutesOf(from)) {
      errors.push(`working hours for day ${day} must end after they start — a shift crossing midnight cannot be stored`)
      continue
    }
    out[String(day)] = { from, to }
  }
  return Object.keys(out).length ? out : null
}

export function normalizeStatus(v) {
  return STATUSES.includes(v) ? v : 'active'
}

export { STATUSES as POSITION_STATUSES, WEEKDAYS }

// The fields a caller may set or change on an existing position. Kept separate
// from the full row so PUT can reuse exactly this list and nothing else.
export function normalizePositionPatch(body = {}) {
  const errors = []
  const patch = {}
  if (body.title !== undefined) patch.title = String(body.title || '').trim() || null
  if (body.isPrimary !== undefined) patch.isPrimary = !!body.isPrimary
  if (body.workWeek !== undefined) patch.workWeek = normalizeWorkWeek(body.workWeek)
  if (body.hours !== undefined) patch.hours = normalizeHours(body.hours, errors)
  if (body.status !== undefined) patch.status = normalizeStatus(body.status)
  if (body.effectiveFrom !== undefined) {
    if (body.effectiveFrom && !isoDate(body.effectiveFrom)) errors.push('effectiveFrom must be YYYY-MM-DD')
    else patch.effectiveFrom = body.effectiveFrom || null
  }
  if (body.effectiveTo !== undefined) {
    if (body.effectiveTo && !isoDate(body.effectiveTo)) errors.push('effectiveTo must be YYYY-MM-DD')
    else patch.effectiveTo = body.effectiveTo || null
  }
  const from = patch.effectiveFrom ?? body.effectiveFrom
  const to = patch.effectiveTo ?? body.effectiveTo
  if (from && to && to < from) errors.push('effectiveTo must be on or after effectiveFrom')
  return { patch, errors }
}

// A complete new row. `node` and `level` are the resolved rows, `held` is how
// many live positions this person already has (the first one is primary).
export function normalizePosition(body = {}, { node, level, held = 0 } = {}) {
  const { patch, errors } = normalizePositionPatch(body)
  const startDate = isoDate(body.startDate) ? body.startDate : new Date().toISOString().slice(0, 10)

  const position = {
    ...(body.id ? { id: body.id } : {}),
    userId: body.userId,
    nodeId: node?.id ?? body.nodeId,
    levelId: level?.id ?? body.levelId,
    title: patch.title ?? null,
    rank: level?.rank ?? 0,
    nodePath: node?.path ?? [],
    depth: node?.depth ?? 0,
    isPrimary: patch.isPrimary ?? held === 0,
    startDate,
    endDate: null,
    active: true,
    // ---- working pattern. NULL MEANS INHERIT from the node, deliberately:
    // copying the node's week down onto each position would freeze the fallback,
    // so changing the school's week would stop reaching anyone.
    workWeek: patch.workWeek ?? null,
    hours: patch.hours ?? null,
    // employment. `left` is what resolveTargets filters on; `on_leave` stays in
    // the org index on purpose — see server/org/tree.js.
    status: patch.status ?? 'active',
    effectiveFrom: patch.effectiveFrom ?? startDate,
    effectiveTo: patch.effectiveTo ?? null,
  }
  return { position, errors }
}
