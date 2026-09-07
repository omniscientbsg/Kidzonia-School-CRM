// The Day-End report, modelled as a task rather than as a parallel feature.
//
// Doing it this way gets recurrence, holidays, timezone-correct deadlines, the
// logout gate, notifications, audit and the dashboards for free — a separate
// report system would need its own copy of every one of them.
//
// WHAT IT IS: one daily blocking occurrence per active position, whose
// completion IS the submission. The body is an auto-rolled summary of that
// person's day plus their own notes, and it lands with their immediate ancestor.
//
// DELIBERATE DESIGN CALLS, because the obvious versions are traps:
//   * The report is NOT gated on the rest of the day's work being finished.
//     That would duplicate the logout gate and deadlock the moment one task is
//     stuck in someone else's approval queue. It is ordered last instead.
//   * The roll-up is a SNAPSHOT taken at submission, not a live query. The
//     report has to say what was true when they signed off, permanently.
//   * Approval is off by default. The ancestor is a RECIPIENT; making it an
//     approval would put a fresh daily obligation on every manager.
import { list, find, insert, update } from '../db.js'
import { buildOrgIndex, describePosition, approverPositionsFor } from '../org/tree.js'
import { localToday, localDate, DEFAULT_TZ } from './time.js'
import { OPEN_STATUSES } from './model.js'
import { dispatchTask, notifySettings } from './notify.js'
import { isGatingNow } from './gate.js'
import { DEFAULT_PRIORITY_ID } from './priorities.js'

export const DAY_END_KEY = 'day_end_report'

const stamp = () => new Date().toISOString()

// ------------------------------------------------------------- the template --
// One template per node, so a school can turn it off, change the wording, or
// keep its own working week without touching anyone else's.
export function ensureDayEndTemplate(node, idx = buildOrgIndex()) {
  const systemKey = `${DAY_END_KEY}:${node.id}`
  const existing = list('tasks', (t) => t.systemKey === systemKey)[0]
  if (existing) return existing
  // OPT-IN, not opt-out. A daily mandatory report for a part-timer with nothing
  // on their plate is noise, and it would hold their logout for no reason — so
  // a school turns it on deliberately, per node.
  if (node.settings?.dayEndReport !== true) return null

  // aimed at every active position in the node itself
  const positions = idx.positions.filter((p) => p.nodeId === node.id && p.userId)
  if (!positions.length) return null

  return insert('tasks', {
    title: 'Submit Day-End Report',
    description: 'A short account of your day: what got done, what is still open, and anything your reporting manager should know.',
    origin: 'automated',
    systemKey,
    // Named people, refreshed by syncDayEndTemplates below — that rewrite IS the
    // joiner mechanism here, which is why followJoiners is false: the list is
    // maintained deliberately rather than recomputed from the tree at generation
    // time. nodeIds is kept for provenance; named people win in resolveTargets.
    target: {
      kind: 'position', kindNote: 'system',
      nodeIds: [node.id], levelIds: [], levelId: null,
      positionIds: positions.map((p) => p.id), userIds: [], excludePositionIds: [],
      includeSubtree: false, followJoiners: false,
    },
    priority: DEFAULT_PRIORITY_ID,
    categoryId: null,
    dueType: 'end_of_day',
    dueConfig: { startDate: null, dueDate: null, days: null },
    recurrence: {
      freq: 'daily', byWeekday: [], dayOfMonth: null, interval: 1,
      startDate: localToday(node.timezone || DEFAULT_TZ), endDate: null, count: null,
      skipNonWorkingDays: true,
    },
    requiresApproval: false,
    approverPositionId: null,
    requiresMedia: false,
    mediaTypes: [],
    minAttachments: 0,
    isBlocking: true,
    // it is the LAST thing anyone does, so it sorts to the bottom of the gate
    // and of My Tasks. A hard dependency on the others would deadlock.
    gateOrder: 100,
    status: 'active',
    academicYearId: null,
    completionCondition: {
      nature: 'custom',
      mcq: null,
      moduleLinked: null,
      custom: {
        statement: 'Your day, summarised for your reporting manager.',
        checklist: [],
        requireNote: true,
        noteLabel: 'Anything your manager should know?',
        submitPayload: 'day_end_report',
      },
      derivedFrom: null,
    },
    onComplete: { actions: [] },
    lockOnComplete: [],
    escalationPolicyId: null,
    createdByUserId: null,
    createdByPositionId: null,
    createdAtNodeId: node.id,
    lastGeneratedThrough: null,
  }, null)
}

// Refresh the target list so somebody who joined today gets a report tonight.
export function syncDayEndTemplates(idx = buildOrgIndex()) {
  const made = []
  for (const node of list('orgNodes', (n) => n.active !== false && n.settings?.dayEndReport === true)) {
    const positions = idx.positions.filter((p) => p.nodeId === node.id && p.userId)
    if (!positions.length) continue
    const created = ensureDayEndTemplate(node, idx)
    if (created) { made.push(created); continue }
    const systemKey = `${DAY_END_KEY}:${node.id}`
    const task = list('tasks', (t) => t.systemKey === systemKey)[0]
    if (!task) continue
    const want = positions.map((p) => p.id).sort()
    const have = [...(task.target.positionIds || [])].sort()
    if (want.join(',') !== have.join(',')) {
      update('tasks', task.id, { target: { ...task.target, positionIds: want } }, null)
    }
  }
  return made
}

// --------------------------------------------------------------- the roll-up --
// Everything that person owed for that local day. Cancelled work is excluded —
// it was withdrawn, not left undone.
export function rollUp(userId, date, idx = buildOrgIndex()) {
  const rows = list('taskInstances', (i) =>
    i.assigneeUserId === userId &&
    i.status !== 'cancelled' &&
    !i.systemKeyOwner &&
    localDate(i.tz || DEFAULT_TZ, i.dueAt || `${i.serviceDate}T00:00:00Z`) <= date &&
    i.serviceDate <= date)

  // the report itself never counts as part of the day it reports on
  const dayEndIds = new Set(list('tasks', (t) => (t.systemKey || '').startsWith(DAY_END_KEY)).map((t) => t.id))
  const mine = rows.filter((i) => !dayEndIds.has(i.taskId))

  const completed = mine.filter((i) => i.status === 'approved' && localDate(i.tz || DEFAULT_TZ, i.completedAt || i.dueAt) === date)
  const awaiting = mine.filter((i) => i.status === 'submitted')
  const open = mine.filter((i) => OPEN_STATUSES.includes(i.status))
  const overdue = open.filter((i) => i.status === 'overdue' || i.serviceDate < date)
  const pending = open.filter((i) => !overdue.includes(i))
  const blocking = open.filter((i) => isGatingNow(i, idx))

  const brief = (i) => ({
    id: i.id, title: i.title, serviceDate: i.serviceDate, status: i.status,
    priority: i.priority, isBlocking: !!i.isBlocking,
  })
  return {
    date,
    counts: {
      completed: completed.length,
      pending: pending.length,
      overdue: overdue.length,
      awaitingApproval: awaiting.length,
      blockingOpen: blocking.length,
      total: mine.length,
    },
    completed: completed.map(brief),
    pending: pending.map(brief),
    overdue: overdue.map(brief),
    awaitingApproval: awaiting.map(brief),
  }
}

// Who the report goes to: the nearest ancestor. One person, not the whole line —
// this is a report, not an approval.
export function reportingUser(inst, idx = buildOrgIndex()) {
  const pos = idx.positionById.get(inst.assigneePositionId)
  if (!pos) return null
  const chain = approverPositionsFor(pos, idx)
    .filter((p) => p.userId && p.userId !== inst.assigneeUserId)
    .sort((a, b) => b.depth - a.depth || a.rank - b.rank)
  return chain[0] || null
}

export const isDayEnd = (inst) => {
  const task = find('tasks', inst.taskId)
  return !!task && (task.systemKey || '').startsWith(DAY_END_KEY)
}

// ------------------------------------------------------------------ deliver --
// Called when a day-end occurrence completes. Freezes the roll-up and files it
// with the reporting manager.
export function fileDayEndReport(inst, user, idx = buildOrgIndex()) {
  if (!isDayEnd(inst)) return null
  const existing = list('dayEndReports', { instanceId: inst.id })[0]
  if (existing) return existing

  const tz = inst.tz || DEFAULT_TZ
  const date = inst.serviceDate || localToday(tz)
  const summary = rollUp(inst.assigneeUserId, date, idx)
  const to = reportingUser(inst, idx)
  const described = to ? describePosition(to, idx) : null
  const mine = idx.positionById.get(inst.assigneePositionId)

  const row = insert('dayEndReports', {
    instanceId: inst.id,
    date,
    tz,
    byUserId: inst.assigneeUserId,
    byName: inst.assigneeName,
    byPositionId: inst.assigneePositionId,
    byTier: mine ? describePosition(mine, idx).tier : null,
    nodeId: inst.assigneeNodeId,
    nodeName: idx.nodeById.get(inst.assigneeNodeId)?.name || null,
    branchId: inst.branchId || null,
    toUserId: to?.userId || null,
    toName: described?.userName || null,
    toPositionId: to?.id || null,
    // frozen: the report says what was true at sign-off, for good
    summary,
    notes: inst.completion?.note || null,
    submittedAt: stamp(),
    readAt: null,
    acknowledgedAt: null,
    acknowledgedByUserId: null,
  }, user?.id || null)

  insert('auditLog', {
    branchId: inst.branchId || null,
    userId: user?.id || null,
    action: 'dayend.submit',
    collection: 'dayEndReports',
    recordId: row.id,
    before: null,
    after: { instanceId: inst.id, date, toUserId: to?.userId || null, counts: summary.counts },
    reason: null,
  })

  if (to?.userId) {
    const c = summary.counts
    dispatchTask('day_end', {
      userIds: [to.userId],
      title: `Day-end report from ${inst.assigneeName}`,
      body: `${c.completed} done, ${c.pending} still open, ${c.overdue} overdue${inst.completion?.note ? ` — “${inst.completion.note}”` : ''}`,
      instance: inst,
      meta: { refType: 'dayEndReport', refId: row.id },
      settings: notifySettings(idx.nodeById.get(inst.assigneeNodeId)),
    })
  }
  return row
}

// ------------------------------------------------------------------- lapse ----
// A day-end report is an account of ONE day. Once that day is over it cannot be
// written honestly, and leaving it open means every person accrues another
// blocking task every night until the list is meaningless.
//
// So it lapses: the occurrence is closed, and a report is filed marked `missed`
// carrying the roll-up of the day they did not account for. Nobody is held at
// the door for a day they cannot re-live, and nothing is swept under the carpet
// — the manager's inbox shows the gap.
export function lapseStaleDayEnds(idx = buildOrgIndex()) {
  const lapsed = []
  for (const inst of list('taskInstances', (i) => OPEN_STATUSES.includes(i.status))) {
    if (!isDayEnd(inst)) continue
    const tz = inst.tz || DEFAULT_TZ
    if (inst.serviceDate >= localToday(tz)) continue          // today's still counts

    const row = update('taskInstances', inst.id, {
      status: 'cancelled',
      cancelReason: 'missed',
      completedAt: null,
    }, null)

    if (!list('dayEndReports', { instanceId: inst.id }).length) {
      const to = reportingUser(inst, idx)
      const mine = idx.positionById.get(inst.assigneePositionId)
      insert('dayEndReports', {
        instanceId: inst.id,
        date: inst.serviceDate,
        tz,
        missed: true,
        byUserId: inst.assigneeUserId,
        byName: inst.assigneeName,
        byPositionId: inst.assigneePositionId,
        byTier: mine ? describePosition(mine, idx).tier : null,
        nodeId: inst.assigneeNodeId,
        nodeName: idx.nodeById.get(inst.assigneeNodeId)?.name || null,
        branchId: inst.branchId || null,
        toUserId: to?.userId || null,
        toName: to ? describePosition(to, idx).userName : null,
        toPositionId: to?.id || null,
        summary: rollUp(inst.assigneeUserId, inst.serviceDate, idx),
        notes: null,
        submittedAt: null,
        readAt: null,
        acknowledgedAt: null,
        acknowledgedByUserId: null,
      }, null)

      insert('auditLog', {
        branchId: inst.branchId || null,
        userId: null,
        action: 'dayend.missed',
        collection: 'taskInstances',
        recordId: inst.id,
        before: { status: inst.status },
        after: { status: 'cancelled', date: inst.serviceDate, byUserId: inst.assigneeUserId },
        reason: 'The day ended without a report',
      })
    }
    lapsed.push(row)
  }
  return lapsed
}

// ------------------------------------------------------------------- inbox ----
// Today's reports from everyone below me, with the roll-up across them.
export function inboxFor(user, { date = null, idx = buildOrgIndex() } = {}) {
  const rows = list('dayEndReports', (r) => r.toUserId === user.id && (!date || r.date === date))
    .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''))

  const filedRows = rows.filter((r) => !r.missed)

  const totals = filedRows.reduce((acc, r) => {
    acc.completed += r.summary?.counts?.completed || 0
    acc.pending += r.summary?.counts?.pending || 0
    acc.overdue += r.summary?.counts?.overdue || 0
    acc.awaitingApproval += r.summary?.counts?.awaitingApproval || 0
    return acc
  }, { completed: 0, pending: 0, overdue: 0, awaitingApproval: 0 })

  // who owed one today and has not filed it — the half a list of received
  // reports cannot show you
  const day = date || localToday(DEFAULT_TZ)
  const filed = new Set(rows.map((r) => r.byUserId))
  const outstanding = list('taskInstances', (i) => i.serviceDate === day && OPEN_STATUSES.includes(i.status))
    .filter((i) => isDayEnd(i))
    .map((i) => ({ userId: i.assigneeUserId, name: i.assigneeName, instanceId: i.id, positionId: i.assigneePositionId }))
    .filter((p) => !filed.has(p.userId))
    .filter((p) => {
      const pos = idx.positionById.get(p.positionId)
      const to = pos ? reportingUser({ assigneePositionId: pos.id, assigneeUserId: p.userId }, idx) : null
      return to?.userId === user.id
    })

  // Days that lapsed without a report, most recent first. Kept separate from
  // `reports` so a gap never reads as a submission.
  const missedRecent = list('dayEndReports', (r) => r.toUserId === user.id && r.missed)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 20)

  return {
    date: day,
    reports: filedRows,
    totals,
    outstanding,
    missed: missedRecent,
    received: filedRows.length,
  }
}
