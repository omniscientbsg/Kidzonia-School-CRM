// Instance materialization. Lazy, deterministic and idempotent — there is no
// cron: every read that shows tasks calls syncTasks() first.
//
// The instance id is a hash of (task, position, occurrence date), so generating
// twice converges instead of duplicating, which a JSON store cannot enforce.
import { list, find, insert, update, hardDelete } from '../db.js'
import { buildOrgIndex, describePosition, branchIdOfNode } from '../org/tree.js'
import { resolveTargets } from './resolve.js'
import { occurrencesBetween } from './recurrence.js'
import { localToday, localDayStart, localDayEnd, addDays, maxDate, minDate, zonedToUtc, DEFAULT_TZ } from './time.js'
import { instanceId } from './ids.js'
import { parseClockTime } from './model.js'
import { notifyAssigned, notifyOverdue, sweepDueSoon, sweepBlockingEndOfDay } from './notify.js'
import { sweepModuleLinked } from './verify.js'
import { sweepEscalations } from './escalation.js'
import { syncDayEndTemplates, lapseStaleDayEnds } from './dayend.js'

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

function dueWindow(task, tz, key) {
  // a deadline with a clock on it, in the school's timezone — "by 3pm on the
  // day this occurrence is for"
  if (task.dueType === 'at_time') {
    const at = parseClockTime(task.dueConfig?.time)
    if (at) return { startAt: localDayStart(tz, key), dueAt: zonedToUtc(tz, key, at.h, at.m).toISOString() }
    return { startAt: localDayStart(tz, key), dueAt: localDayEnd(tz, key) }
  }
  if (task.dueType === 'date_window') {
    return {
      startAt: localDayStart(tz, task.dueConfig.startDate || key),
      dueAt: localDayEnd(tz, task.dueConfig.dueDate || key),
    }
  }
  if (task.dueType === 'n_days') {
    return { startAt: localDayStart(tz, key), dueAt: localDayEnd(tz, addDays(key, Number(task.dueConfig.days) || 1)) }
  }
  return { startAt: localDayStart(tz, key), dueAt: localDayEnd(tz, key) }   // end_of_day
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
      workWeek: node?.settings?.workWeek,
      holidays: task.recurrence?.skipNonWorkingDays ? holidayDatesFor(node, idx) : null,
      anchor: task.dueConfig?.startDate || anchor,
    })

    for (const key of keys) {
      const id = instanceId(task.id, pos.id, key)
      if (existing.has(id)) continue
      const { startAt, dueAt } = dueWindow(task, tz, key)
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
const SNAPSHOT_FIELDS = ['title', 'dueType', 'dueConfig', 'priority', 'tagIds', 'isBlocking', 'gateOrder', 'requiresApproval', 'requiresMedia', 'mediaTypes', 'minAttachments', 'approverPositionId', 'academicYearId', 'origin', 'completionCondition', 'onComplete', 'lockOnComplete']

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
    const { startAt, dueAt } = dueWindow(task, inst.tz || DEFAULT_TZ, inst.occurrenceKey)
    if (startAt !== inst.startAt) patch.startAt = startAt
    if (dueAt !== inst.dueAt) patch.dueAt = dueAt
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
      workWeek: node?.settings?.workWeek,
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
  // a person placed in the tree today owes a day-end report tonight
  syncDayEndTemplates()
  const created = ensureInstances(opts)
  const revived = reviveDeferred()
  // yesterday's unwritten day-end report lapses rather than piling up — one
  // blocking task per person per night, forever, was the alternative
  const lapsed = lapseStaleDayEnds()
  const overdue = refreshOverdue()
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
    verified: verified.length,
    escalated: escalated.length,
    lapsed: lapsed.length,
    notified: { assigned: created.length ? 1 : 0, dueSoon: dueSoon.length, blockingEod: blockingEod.length },
  }
}
