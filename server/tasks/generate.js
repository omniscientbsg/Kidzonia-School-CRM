// Instance materialization. Lazy, deterministic and idempotent — there is no
// cron: every read that shows tasks calls syncTasks() first.
//
// The instance id is a hash of (task, position, occurrence date), so generating
// twice converges instead of duplicating, which a JSON store cannot enforce.
import { list, find, insert, update, hardDelete } from '../db.js'
import { buildOrgIndex, describePosition, branchIdOfNode } from '../org/tree.js'
import { resolveTargets } from './resolve.js'
import { occurrencesBetween } from './recurrence.js'
import { localToday, localDate, localDayStart, localDayEnd, addDays, maxDate, minDate, zonedToUtc, DEFAULT_TZ } from './time.js'
import { instanceId } from './ids.js'
import { parseClockTime, OPEN_STATUSES } from './model.js'
import { notifyAssigned, notifyOverdue, notifyExpired, sweepDueSoon, sweepBlockingEndOfDay } from './notify.js'
import { sweepModuleLinked } from './verify.js'
import { sweepEscalations } from './escalation.js'
import { syncDayEndTemplates, lapseStaleDayEnds } from './dayend.js'
import { shiftEndsAt, inServiceOn } from '../org/hours.js'

const HORIZON_DAYS = 7      // how far ahead recurring work is materialized
const BACKFILL_DAYS = 30    // how far back a dormant task may catch up

export { instanceId }

// Holidays come from the school calendar the rest of the app already uses
// (`events` of type 'holiday'), so nobody maintains a second list. Branch-less
// events count as group-wide closures.
export function holidayDatesFor(node, idx = buildOrgIndex()) {
  const branchId = branchIdOfNode(node, idx)
  const dates = new Set()
  for (const e of list('events', (x) => x.type === 'holiday')) {
    if (e.branchId && branchId && e.branchId !== branchId) continue
    if (e.date) dates.add(e.date)
    // multi-day closures (Diwali week, etc.)
    if (e.endDate && e.date) {
      for (let d = e.date; d <= e.endDate; d = addDays(d, 1)) dates.add(d)
    }
  }
  for (const d of node?.settings?.holidays || []) dates.add(d)
  return dates
}

// `ctx` carries the assignee's position and node, because "end of the day" means
// the end of THAT PERSON's working day. With nothing configured it falls back to
// the end of the local calendar day, which is exactly the old behaviour.
function dueWindow(task, tz, key, { pos = null, node = null } = {}) {
  const endOf = (dateStr) => shiftEndsAt(pos, node, tz, dateStr)

  // THE DEADLINE IS NOT THE CLOSING TIME. `dueAt` makes it late and still
  // submittable; `expiresAt` is when it stops being possible at all. They are
  // measured from the same place so any dueType gets a sane answer, and
  // `end_of_day` closes at the end of the CALENDAR day the deadline falls on —
  // not at the deadline itself, or a 16:00 shift end would go late and closed
  // in the same instant and the grace period would be nothing.
  const closesAt = (dueAt) => {
    const mode = task.expiry?.mode || 'never'
    if (mode === 'never' || !dueAt) return null
    const lastDay = localDate(tz, dueAt)
    if (mode === 'after_days') return localDayEnd(tz, addDays(lastDay, Number(task.expiry?.days) || 1))
    return localDayEnd(tz, lastDay)
  }
  const withExpiry = (w) => ({ ...w, expiresAt: closesAt(w.dueAt) })

  // A deadline with a clock on it is an explicit instruction and is NOT moved by
  // a shift: "by 3pm" means 3pm, whatever time that person normally leaves.
  if (task.dueType === 'at_time') {
    const at = parseClockTime(task.dueConfig?.time)
    if (at) return withExpiry({ startAt: localDayStart(tz, key), dueAt: zonedToUtc(tz, key, at.h, at.m).toISOString() })
    return withExpiry({ startAt: localDayStart(tz, key), dueAt: endOf(key) })
  }
  if (task.dueType === 'date_window') {
    return withExpiry({
      startAt: localDayStart(tz, task.dueConfig.startDate || key),
      dueAt: endOf(task.dueConfig.dueDate || key),
    })
  }
  if (task.dueType === 'n_days') {
    return withExpiry({ startAt: localDayStart(tz, key), dueAt: endOf(addDays(key, Number(task.dueConfig.days) || 1)) })
  }
  return withExpiry({ startAt: localDayStart(tz, key), dueAt: endOf(key) })   // end_of_day
}

// Generate everything due up to `through` for one task. Returns created rows.
export function generateForTask(task, idx = buildOrgIndex(), { through = null } = {}) {
  if (task.status !== 'active') return []
  const creator = find('users', task.createdByUserId)
  if (!creator && !task.systemKey) return []

  // A SYSTEM task is raised by the engine, not by a person, and it is routinely
  // aimed UPWARDS — an overdue-approval chaser lands on the manager who is
  // sitting on it, who is above whoever nominally created the original work.
  // Running it through the downline filter would silently generate nothing.
  const allowed = task.systemKey
    ? (task.target?.positionIds || []).map((id) => idx.positionById.get(id)).filter(Boolean)
    // targets are re-resolved per run, so a teacher who joined this week starts
    // receiving today's occurrences without the template being touched
    : resolveTargets(task.target, creator, idx).allowed
  if (!allowed.length) return []

  const created = []
  const existing = new Set(list('taskInstances', { taskId: task.id }).map((i) => i.id))
  const anchor = (task.createdAt || new Date().toISOString()).slice(0, 10)
  // read the watermark ONCE: bumping it inside the loop would starve every
  // assignee after the first of their earlier occurrences
  const watermarkBefore = task.lastGeneratedThrough
  let watermarkAfter = watermarkBefore

  for (const pos of allowed) {
    const described = describePosition(pos, idx)
    const node = idx.nodeById.get(pos.nodeId)
    const tz = node?.timezone || DEFAULT_TZ
    const today = localToday(tz)
    const horizon = through || addDays(today, HORIZON_DAYS)

    // one-off tasks always materialize from their own start date; recurring ones
    // never backfill more than BACKFILL_DAYS, so a dormant template cannot
    // suddenly spawn a year of history
    const from = task.recurrence.freq === 'none'
      ? (task.recurrence.startDate || task.dueConfig?.startDate || anchor)
      : maxDate(watermarkBefore, addDays(today, -BACKFILL_DAYS), task.recurrence.startDate || anchor)
    const to = minDate(horizon, task.recurrence.endDate || horizon)
    if (!from || !to || from > to) continue

    const keys = occurrencesBetween(task.recurrence, from, to, {
      // the PERSON's week, falling back to the school's — so a part-time teacher
      // stops collecting Wednesday occurrences
      workWeek: pos.workWeek ?? node?.settings?.workWeek,
      holidays: task.recurrence?.skipNonWorkingDays ? holidayDatesFor(node, idx) : null,
      anchor: task.dueConfig?.startDate || anchor,
    })

    for (const key of keys) {
      // a placement bounded in time collects nothing outside it: somebody who
      // starts next month should not be handed this month's work, and somebody
      // who has left should stop collecting it without their past work vanishing
      if (!inServiceOn(pos, key)) continue
      const id = instanceId(task.id, pos.id, key)
      if (existing.has(id)) continue
      const { startAt, dueAt, expiresAt } = dueWindow(task, tz, key, { pos, node })
      const row = insert('taskInstances', {
        id,
        taskId: task.id,
        occurrenceKey: key,
        serviceDate: key,
        assigneePositionId: pos.id,
        assigneeUserId: pos.userId,
        assigneeNodeId: pos.nodeId,
        assignedByUserId: task.createdByUserId,
        assignedByPositionId: task.createdByPositionId,
        approverPositionId: task.approverPositionId,
        status: 'assigned',
        tz,
        startAt,
        dueAt,
        // when it stops being possible at all. null = never, which is what
        // every task said before expiry existed.
        expiresAt,
        expiredAt: null,
        startedAt: null,
        submittedAt: null,
        decidedAt: null,
        completedAt: null,
        overdueAt: null,
        submissionRound: 1,
        rejectionCount: 0,
        lastComment: null,
        attachmentIds: [],
        // snapshot: editing the template later must not rewrite history
        title: task.title,
        origin: task.origin,
        // the occurrence is judged against the condition that was live when it
        // was created, never the one the template carries today
        completionCondition: task.completionCondition,
        onComplete: task.onComplete,
        lockOnComplete: task.lockOnComplete,
        completion: null,
        conditionMet: false,
        verificationBroken: false,
        dueType: task.dueType,
        dueConfig: task.dueConfig,
        expiry: task.expiry,
        priority: task.priority,
        tagIds: task.tagIds || [],
        isBlocking: task.isBlocking,
        gateOrder: task.gateOrder ?? 0,
        requiresApproval: task.requiresApproval,
        requiresMedia: task.requiresMedia,
        mediaTypes: task.mediaTypes,
        minAttachments: task.minAttachments,
        academicYearId: task.academicYearId,
        branchId: branchIdOfNode(node, idx),
        deferredTo: null,
        deferredByPositionId: null,
        deferReason: null,
        cancelReason: null,
        assigneeName: described.userName,
      }, task.createdByUserId)
      existing.add(id)
      created.push(row)
    }

    watermarkAfter = maxDate(watermarkAfter, to)
  }
  if (watermarkAfter && watermarkAfter !== watermarkBefore) {
    update('tasks', task.id, { lastGeneratedThrough: watermarkAfter }, task.createdByUserId)
  }
  return created
}

export function ensureInstances({ taskIds = null, through = null } = {}) {
  const idx = buildOrgIndex()
  const tasks = list('tasks', (t) => t.status === 'active' && (!taskIds || taskIds.includes(t.id)))
  const created = []
  for (const task of tasks) created.push(...generateForTask(task, idx, { through }))
  return created
}

// Lazy overdue sweep: anything still open past its due instant flips to overdue
// exactly once (overdueAt is the guard, so notifications fire only once).
// It closed. Guarded by `expiredAt` exactly the way refreshOverdue is guarded
// by `overdueAt`, so the notification fires once per occurrence and not on
// every sweep.
export function expireStale(now = new Date()) {
  const closed = []
  const idx = buildOrgIndex()
  for (const inst of list('taskInstances', (i) => OPEN_STATUSES.includes(i.status))) {
    if (!inst.expiresAt || inst.expiredAt) continue
    if (new Date(inst.expiresAt) > now) continue
    const row = update('taskInstances', inst.id, { status: 'expired', expiredAt: now.toISOString() }, null)
    notifyExpired(row, idx)
    closed.push(row)
  }
  return closed
}

export function refreshOverdue(now = new Date()) {
  const flipped = []
  const idx = buildOrgIndex()
  for (const inst of list('taskInstances', (i) => i.status === 'assigned' || i.status === 'in_progress')) {
    if (!inst.dueAt || new Date(inst.dueAt) > now) continue
    const row = update('taskInstances', inst.id, { status: 'overdue', overdueAt: now.toISOString() }, null)
    // overdueAt is the guard, so this fires exactly once per occurrence
    notifyOverdue(row, idx)
    flipped.push(row)
  }
  return flipped
}

// ---------------------------------------------------------------------------
// Editing a template touches the FUTURE only.
//
// An occurrence is rewritable when it is still untouched (`assigned`) and its
// service date is later than today in its own timezone. Anything started,
// submitted, decided, deferred, cancelled — or simply belonging to a past day —
// is history and is left exactly as it was, because it records what the person
// was actually asked to do at the time.
// ---------------------------------------------------------------------------
const SNAPSHOT_FIELDS = ['title', 'dueType', 'dueConfig', 'expiry', 'priority', 'tagIds', 'isBlocking', 'gateOrder', 'requiresApproval', 'requiresMedia', 'mediaTypes', 'minAttachments', 'approverPositionId', 'academicYearId', 'origin', 'completionCondition', 'onComplete', 'lockOnComplete']

export function isRewritable(inst) {
  return inst.status === 'assigned' && inst.serviceDate > localToday(inst.tz || DEFAULT_TZ)
}

export function applyTemplateEdit(task, userId = null) {
  const idx = buildOrgIndex()
  const rows = list('taskInstances', { taskId: task.id })
  let updated = 0
  let removed = 0

  // 1. re-point the future occurrences that survive the edit
  for (const inst of rows) {
    if (!isRewritable(inst)) continue
    const patch = {}
    for (const f of SNAPSHOT_FIELDS) {
      if (JSON.stringify(inst[f]) !== JSON.stringify(task[f])) patch[f] = task[f]
    }
    // the occurrence knows whose it is; idx turns that back into the rows. A
    // position that has since been ended is absent from idx and falls back to
    // the end of the local day, which is the right answer — we cannot know a
    // departed person's shift.
    const ipos = idx.positionById.get(inst.assigneePositionId)
    const inode = idx.nodeById.get(inst.assigneeNodeId)
    const { startAt, dueAt, expiresAt } = dueWindow(task, inst.tz || DEFAULT_TZ, inst.occurrenceKey, { pos: ipos, node: inode })
    if (startAt !== inst.startAt) patch.startAt = startAt
    if (dueAt !== inst.dueAt) patch.dueAt = dueAt
    if (expiresAt !== inst.expiresAt) patch.expiresAt = expiresAt
    if (Object.keys(patch).length) { update('taskInstances', inst.id, patch, userId); updated++ }
  }

  // 2. drop future occurrences the new rule no longer schedules (a Mon/Wed/Fri
  //    task narrowed to Mondays, a shortened end date, a paused template…).
  //    Hard delete: these were never seen by anyone, and a tombstone would
  //    collide with the deterministic id if the rule is widened again.
  const { allowed } = resolveTargets(task.target, find('users', task.createdByUserId) || { id: task.createdByUserId }, idx)
  const stillTargeted = new Set(allowed.map((p) => p.id))
  const validKeys = new Map()
  for (const pos of allowed) {
    const node = idx.nodeById.get(pos.nodeId)
    const tz = node?.timezone || DEFAULT_TZ
    const today = localToday(tz)
    const keys = occurrencesBetween(task.recurrence, today, addDays(today, HORIZON_DAYS), {
      workWeek: pos.workWeek ?? node?.settings?.workWeek,
      holidays: task.recurrence?.skipNonWorkingDays ? holidayDatesFor(node, idx) : null,
      anchor: task.dueConfig?.startDate || (task.createdAt || '').slice(0, 10),
    })
    validKeys.set(pos.id, new Set(keys))
  }
  for (const inst of rows) {
    if (!isRewritable(inst)) continue
    const keys = validKeys.get(inst.assigneePositionId)
    const stillScheduled = task.status === 'active' && stillTargeted.has(inst.assigneePositionId) && keys?.has(inst.occurrenceKey)
    if (!stillScheduled) { hardDelete('taskInstances', inst.id); removed++ }
  }

  // 3. materialize anything the new rule adds. The watermark normally sits at
  //    the far end of the horizon, which would block regeneration of the days
  //    step 2 just withdrew — so wind it back to today first. Past days stay
  //    untouched because the floor is today, not today-30.
  update('tasks', task.id, { lastGeneratedThrough: minDate(task.lastGeneratedThrough, localToday(DEFAULT_TZ)) }, userId)
  const created = generateForTask(find('tasks', task.id) || task, buildOrgIndex(), {}).length
  return { updated, removed, created }
}

// Deferred work comes back on its own, the day it was moved to.
export function reviveDeferred() {
  const revived = []
  for (const inst of list('taskInstances', { status: 'deferred' })) {
    if (!inst.deferredTo || inst.deferredTo > localToday(inst.tz || DEFAULT_TZ)) continue
    revived.push(update('taskInstances', inst.id, { status: 'assigned', serviceDate: inst.deferredTo }, null))
  }
  return revived
}

// One call for every read path that shows task state.
export function syncTasks(opts = {}) {
  // a person placed in the tree today owes a day-end report tonight, and an
  // edited form has to reach the templates AND the future occurrences already
  // generated from them — each of which carries its own snapshot of the
  // condition, so a raw update() would stop at the template.
  const dayEnd = syncDayEndTemplates()
  for (const t of dayEnd.changed) applyTemplateEdit(t, null)
  const created = ensureInstances(opts)
  const revived = reviveDeferred()
  // yesterday's unwritten day-end report lapses rather than piling up — one
  // blocking task per person per night, forever, was the alternative
  const lapsed = lapseStaleDayEnds()
  const overdue = refreshOverdue()
  // AFTER refreshOverdue: if a process was down long enough for both thresholds
  // to pass, the occurrence went late and then closed, and the record should say
  // both happened rather than skipping straight to closed.
  const closed = expireStale()
  // time-driven notifications ride the same sweep as generation, so they work
  // whether the scheduler ran or a user simply opened a task screen
  const idx = buildOrgIndex()
  if (created.length) notifyAssigned(created, idx)
  const dueSoon = sweepDueSoon(Date.now(), idx)
  const blockingEod = sweepBlockingEndOfDay(Date.now(), idx)
  // catch-up for module-linked work: covers a missed push, a restarted process,
  // and the common case of the module being used BEFORE the task was generated
  const verified = sweepModuleLinked()
  // approval SLAs. TODO: a real scheduler should drive this; the lazy path
  // stays as the fallback for a process that was down.
  const escalated = sweepEscalations(Date.now(), idx)
  return {
    created: created.length,
    revived: revived.length,
    overdue: overdue.length,
    expired: closed.length,
    verified: verified.length,
    escalated: escalated.length,
    lapsed: lapsed.length,
    notified: { assigned: created.length ? 1 : 0, dueSoon: dueSoon.length, blockingEod: blockingEod.length },
  }
}
