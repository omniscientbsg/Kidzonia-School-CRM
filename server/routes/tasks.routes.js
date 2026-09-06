import { Router } from 'express'
import { list, find, insert, update } from '../db.js'
import { requireAuth, requirePermission, staffOnly } from '../auth.js'
import { auditOrg } from '../audit.js'
import {
  buildOrgIndex, positionsOfUser, primaryPosition, describePosition,
  canManagePosition, canManage, getAncestors, canAdministerNode,
} from '../org/tree.js'
import { normalizeTask, OPEN_STATUSES } from '../tasks/model.js'
import { evaluateCondition, describeCondition } from '../tasks/conditions.js'
import { describeActions } from '../tasks/actions.js'
import { catalogue, describeSignal } from '../capabilities/index.js'
import { activityCatalogue } from '../capabilities/activities.js'
import { verifyInstance, isModuleLinked } from '../tasks/verify.js'
import {
  canDecideLock, requestReEdit, decideReEdit, usableGrant, liftLock, GRANT_MINUTES,
} from '../tasks/lock.js'
import { normalizePolicy, describePolicy, policyFor } from '../tasks/escalation.js'
import { rollUp, inboxFor, isDayEnd, reportingUser } from '../tasks/dayend.js'
import { resolveTargets, previewTargets } from '../tasks/resolve.js'
import { syncTasks, generateForTask, applyTemplateEdit } from '../tasks/generate.js'
import { buildAnalytics } from '../tasks/analytics.js'
import { localToday, endOfWeek, DEFAULT_TZ } from '../tasks/time.js'
import { evaluate, recordRelease, isGatingNow } from '../tasks/gate.js'
import { DEFAULT_NOTIFY_SETTINGS, TASK_EVENTS, notifySettings, notifyAssigned, dispatchTask } from '../tasks/notify.js'
import {
  TaskError, startWork, submitWork, decide, deferInstance, cancelInstance,
  reassignInstance, addAttachment, removeAttachment, approvalRight,
  isAssignee, canManageInstance, selfDeferLimit, recordCompletion,
} from '../tasks/service.js'

const router = Router()
router.use(requireAuth, staffOnly)

// A task may be edited/cancelled by whoever created it, or by anyone above that
// creator — the same upward line that may approve its work.
function canEditTask(user, task, idx = buildOrgIndex()) {
  if (task.createdByUserId === user.id) return true
  const creatorPos = idx.positionById.get(task.createdByPositionId)
  return !!creatorPos && canManage(user, creatorPos, idx)
}

function decorate(task, idx = buildOrgIndex()) {
  const creator = idx.positionById.get(task.createdByPositionId)
  const approver = idx.positionById.get(task.approverPositionId)
  return {
    ...task,
    createdByName: find('users', task.createdByUserId)?.name || 'Unknown',
    createdByTier: creator ? describePosition(creator, idx).tier : null,
    approverName: approver ? describePosition(approver, idx).userName : null,
    categoryName: task.categoryId ? find('taskCategories', task.categoryId)?.name || null : null,
    // one sentence covering whichever nature this is, so every list can show
    // how the task is verified without knowing the shapes
    conditionSummary: describeCondition(task.completionCondition),
    actionSummary: describeActions(task.onComplete?.actions),
  }
}

// ============================================================================
// Categories
// ============================================================================
router.get('/task-categories', (req, res) => {
  res.json(list('taskCategories').sort((a, b) => a.name.localeCompare(b.name)))
})

router.post('/task-categories', requirePermission('tasks', 'create'), (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(422).json({ error: 'name is required' })
  const row = insert('taskCategories', { name, color: req.body.color || '#f4772e', active: true }, req.user.id)
  res.status(201).json(row)
})

// ============================================================================
// Capability registry — what other modules expose to the task engine. The
// create-task form renders its module / signal / action / lock pickers from
// this, so a new module appears in the UI without the form being touched.
// Declared before /tasks/:id so the literal path wins.
// ============================================================================
router.get('/tasks/capabilities', (req, res) => {
  // plus the module -> thing -> action catalogue, so the form can offer a check
  // against ANY module without one being hand-written for it
  const cat = catalogue()
  res.json({ ...cat, activities: activityCatalogue(cat.verifiable) })
})

// Plain-language preview of a binding, for the form: "completes when attendance
// is marked for the assignee's class on the task's date".
router.post('/tasks/capabilities/describe', (req, res) => {
  const { moduleKey, signalKey, paramBinding } = req.body || {}
  const phrase = describeSignal(moduleKey, signalKey, paramBinding || {})
  if (!phrase) return res.status(422).json({ error: 'unknown_signal', message: 'No such module signal' })
  res.json({ phrase, sentence: `Completes when ${phrase}` })
})

// ============================================================================
// The Today view — where a login lands. Today's work and anything left from
// before, grouped and prioritised, plus the two things that decide whether the
// person can go home: what is blocking sign-off, and the Day-End report.
// Declared before /tasks/:id so the literal path wins.
// ============================================================================
const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 }

router.get('/tasks/today', (req, res) => {
  syncTasks()
  const idx = buildOrgIndex()
  const primary = primaryPosition(req.user, idx)
  const tz = idx.nodeById.get(primary?.nodeId)?.timezone || DEFAULT_TZ
  const today = localToday(tz)

  const rows = list('taskInstances', { assigneeUserId: req.user.id }).map((i) => decorateInstance(i, idx, req.user))
  const open = rows.filter((i) => OPEN_STATUSES.includes(i.status))
  const dayEnd = open.find((i) => isDayEnd(i) && i.serviceDate === today) || null
  const work = open.filter((i) => !isDayEnd(i))

  // worst first: overdue before today's, urgent before normal, mandatory before
  // optional — the order someone should actually work in
  const rank = (i) => [
    i.serviceDate < today ? 0 : 1,
    i.isBlocking ? 0 : 1,
    PRIORITY_RANK[i.priority] ?? 2,
    i.dueAt || '',
  ]
  const byUrgency = (a, b) => {
    const [x, y] = [rank(a), rank(b)]
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1
    return 0
  }

  const gate = evaluate(req.user, idx)
  const overdue = work.filter((i) => i.status === 'overdue' || i.serviceDate < today).sort(byUrgency)
  const dueToday = work.filter((i) => i.serviceDate === today && i.status !== 'overdue').sort(byUrgency)
  const later = work.filter((i) => i.serviceDate > today).sort(byUrgency)

  res.json({
    today,
    timezone: tz,
    greetingName: req.user.name,
    overdue,
    dueToday,
    later,
    waiting: rows.filter((i) => i.status === 'submitted'),
    doneToday: rows.filter((i) => i.status === 'approved' && i.serviceDate === today).length,
    // the banner: exactly what the gate enforces, in the order to clear it
    signOff: {
      blocked: gate.blocked,
      armed: gate.armed,
      released: gate.released,
      release: gate.release,
      items: gate.instances,
      count: gate.instances.length,
    },
    dayEnd: dayEnd
      ? { instanceId: dayEnd.id, status: dayEnd.status, dueAt: dayEnd.dueAt, submitted: false }
      : { instanceId: null, submitted: !!list('dayEndReports', (r) => r.byUserId === req.user.id && r.date === today).length },
    reportsWaiting: inboxFor(req.user, { date: today, idx }).received,
  })
})

// ============================================================================
// Day-End reports
// ============================================================================
// What today looks like right now, so the form is filled in before they type.
router.get('/tasks/day-end/preview', (req, res) => {
  syncTasks()
  const idx = buildOrgIndex()
  const primary = primaryPosition(req.user, idx)
  const tz = idx.nodeById.get(primary?.nodeId)?.timezone || DEFAULT_TZ
  const date = req.query.date || localToday(tz)
  const to = primary ? reportingUser({ assigneePositionId: primary.id, assigneeUserId: req.user.id }, idx) : null
  const open = list('taskInstances', (i) => i.assigneeUserId === req.user.id && OPEN_STATUSES.includes(i.status))
  const instance = open.find((i) => isDayEnd(i) && i.serviceDate === date) || null
  res.json({
    date,
    timezone: tz,
    summary: rollUp(req.user.id, date, idx),
    reportsTo: to ? { userId: to.userId, name: find('users', to.userId)?.name || null, tier: describePosition(to, idx).tier } : null,
    instanceId: instance?.id || null,
    alreadySubmitted: !!list('dayEndReports', (r) => r.byUserId === req.user.id && r.date === date).length,
  })
})

// The received-reports inbox for a reporting manager.
router.get('/tasks/day-end/received', (req, res) => {
  syncTasks()
  const idx = buildOrgIndex()
  const primary = primaryPosition(req.user, idx)
  const tz = idx.nodeById.get(primary?.nodeId)?.timezone || DEFAULT_TZ
  res.json(inboxFor(req.user, { date: req.query.date || localToday(tz), idx }))
})

router.get('/tasks/day-end/:id', (req, res) => {
  const row = find('dayEndReports', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const idx = buildOrgIndex()
  const mine = positionsOfUser(req.user, idx)
  const pos = idx.positionById.get(row.byPositionId)
  const visible = row.toUserId === req.user.id || row.byUserId === req.user.id ||
    (!!pos && mine.some((m) => canManagePosition(m, pos, idx)))
  if (!visible) return res.status(404).json({ error: 'Not found' })
  if (row.toUserId === req.user.id && !row.readAt) update('dayEndReports', row.id, { readAt: new Date().toISOString() }, req.user.id)
  res.json(find('dayEndReports', row.id))
})

// "Seen it." Not an approval — a report does not need a verdict, but a manager
// wants a way to say they have read it, and the sender wants to know.
router.post('/tasks/day-end/:id/acknowledge', (req, res) => {
  const idx = buildOrgIndex()
  const row = find('dayEndReports', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (row.toUserId !== req.user.id) {
    return res.status(403).json({ error: 'not_recipient', message: 'Only the reporting manager can acknowledge this' })
  }
  const saved = update('dayEndReports', row.id, {
    acknowledgedAt: new Date().toISOString(),
    acknowledgedByUserId: req.user.id,
    acknowledgeComment: req.body?.comment || null,
  }, req.user.id)
  auditOrg(req, 'dayend.acknowledge', 'dayEndReports', row.id, {
    after: saved, reason: req.body?.comment || null, positionId: primaryPosition(req.user, idx)?.id,
  })
  dispatchTask('day_end', {
    userIds: [row.byUserId],
    title: `${req.user.name} read your day-end report`,
    body: req.body?.comment || 'No comment left.',
    meta: { refType: 'dayEndReport', refId: row.id },
  })
  res.json(saved)
})

// ============================================================================
// Escalation policies. An ordered ladder of approvers with an SLA per rung;
// every rung is resolved through canManage, so escalation can never leave the
// ancestor chain. Declared before /tasks/:id so the literal path wins.
// ============================================================================
router.get('/escalation-policies', (req, res) => {
  const rows = list('escalationPolicies').map((p) => ({ ...p, summary: describePolicy(p) }))
  res.json(rows.sort((a, b) => a.name.localeCompare(b.name)))
})

router.post('/escalation-policies', requirePermission('tasks', 'create'), (req, res) => {
  const idx = buildOrgIndex()
  const { policy, errors } = normalizePolicy(req.body)
  if (errors.length) return res.status(422).json({ error: 'invalid_policy', message: errors[0], errors })
  if (policy.nodeId && !canAdministerNode(req.user, policy.nodeId, idx)) {
    return res.status(403).json({ error: 'not_admin', message: 'You cannot set policy for that node' })
  }
  const row = insert('escalationPolicies', policy, req.user.id)
  auditOrg(req, 'escalation.policy.create', 'escalationPolicies', row.id, { after: row, positionId: primaryPosition(req.user, idx)?.id })
  res.status(201).json({ ...row, summary: describePolicy(row) })
})

router.put('/escalation-policies/:id', requirePermission('tasks', 'edit'), (req, res) => {
  const idx = buildOrgIndex()
  const existing = find('escalationPolicies', req.params.id)
  if (!existing) return res.status(404).json({ error: 'Not found' })
  if (existing.nodeId && !canAdministerNode(req.user, existing.nodeId, idx)) return res.status(403).json({ error: 'not_admin' })
  const { policy, errors } = normalizePolicy(req.body, { existing })
  if (errors.length) return res.status(422).json({ error: 'invalid_policy', message: errors[0], errors })
  const row = update('escalationPolicies', existing.id, policy, req.user.id)
  // in-flight approvals keep the ladder they started on; the stage they are on
  // was already resolved and re-pointing it mid-flight would move an approval
  // out from under whoever is holding it
  auditOrg(req, 'escalation.policy.update', 'escalationPolicies', row.id, { before: existing, after: row, positionId: primaryPosition(req.user, idx)?.id })
  res.json({ ...row, summary: describePolicy(row) })
})

// Default policy for a whole category — the "attach a default per category" half.
router.put('/task-categories/:id/escalation', requirePermission('tasks', 'edit'), (req, res) => {
  const idx = buildOrgIndex()
  const cat = find('taskCategories', req.params.id)
  if (!cat) return res.status(404).json({ error: 'Not found' })
  const policyId = req.body?.escalationPolicyId || null
  if (policyId && !find('escalationPolicies', policyId)) return res.status(422).json({ error: 'unknown_policy' })
  const row = update('taskCategories', cat.id, { escalationPolicyId: policyId }, req.user.id)
  auditOrg(req, 'escalation.category_default', 'taskCategories', cat.id, {
    before: { escalationPolicyId: cat.escalationPolicyId || null }, after: { escalationPolicyId: policyId },
    positionId: primaryPosition(req.user, idx)?.id,
  })
  res.json(row)
})

// What would happen to this occurrence, and what already has.
router.get('/task-instances/:id/escalation', (req, res) => {
  const idx = buildOrgIndex()
  const inst = find('taskInstances', req.params.id)
  if (!inst) return res.status(404).json({ error: 'Not found' })
  if (!visibleInstance(req.user, inst, idx, positionsOfUser(req.user, idx))) return res.status(404).json({ error: 'Not found' })
  const policy = policyFor(inst)
  res.json({
    policy: policy ? { ...policy, summary: describePolicy(policy) } : null,
    escalation: inst.escalation || null,
    currentApproverName: inst.escalation
      ? describePosition(idx.positionById.get(inst.escalation.currentApproverPositionId), idx)?.userName || null
      : null,
  })
})

// ============================================================================
// Record locks. A completed module-linked task turns the records it was
// verified against into evidence; changing them needs someone above the
// assignee to agree, and that approval is good for ONE edit within an hour.
// ============================================================================
function decorateLock(lock, user, idx = buildOrgIndex()) {
  const inst = find('taskInstances', lock.instanceId)
  const requests = list('taskLockRequests', { lockId: lock.id })
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  return {
    ...lock,
    taskTitle: inst?.title || null,
    serviceDate: inst?.serviceDate || null,
    assigneeName: find('users', lock.assigneeUserId)?.name || null,
    verificationBroken: !!inst?.verificationBroken,
    canDecide: canDecideLock(user, lock, idx),
    myGrant: usableGrant(lock.id, user.id) || null,
    requests,
  }
}

// What is locked in my world, and what is waiting on me.
router.get('/tasks/locks', (req, res) => {
  const idx = buildOrgIndex()
  const mine = positionsOfUser(req.user, idx)
  const rows = list('taskLocks', (l) => l.status === 'locked').filter((l) => {
    if (l.assigneeUserId === req.user.id) return true
    const pos = idx.positionById.get(l.assigneePositionId)
    return !!pos && mine.some((m) => canManagePosition(m, pos, idx))
  })
  res.json(rows.map((l) => decorateLock(l, req.user, idx)))
})

// "Ask someone above me to let me change this."
router.post('/tasks/locks/:id/request', (req, res) => {
  const idx = buildOrgIndex()
  const lock = find('taskLocks', req.params.id)
  if (!lock || lock.status !== 'locked') return res.status(404).json({ error: 'Not found' })
  const existing = list('taskLockRequests', (r) => r.lockId === lock.id && r.byUserId === req.user.id && r.status === 'pending')[0]
  if (existing) return res.status(409).json({ error: 'already_requested', message: 'Your request is already with them', request: existing })

  const row = requestReEdit(req.user, lock, { reason: req.body?.reason || null })
  auditOrg(req, 'lock.request', 'taskLockRequests', row.id, {
    after: { lockId: lock.id, ref: lock.scope, approvers: row.approverUserIds },
    reason: req.body?.reason || null,
    positionId: primaryPosition(req.user, idx)?.id,
  })
  if (!row.approverUserIds.length) {
    return res.status(201).json({ ...row, warning: 'Nobody sits above you in the org tree, so there is no one to approve this.' })
  }
  res.status(201).json(row)
})

// What I have been asked to approve.
router.get('/tasks/lock-requests', (req, res) => {
  const idx = buildOrgIndex()
  const decorateRequest = (r) => {
    const lock = find('taskLocks', r.lockId)
    const inst = find('taskInstances', r.instanceId)
    const { collection, ...keys } = r.scope || {}
    return {
      ...r,
      byName: find('users', r.byUserId)?.name || 'Someone',
      taskTitle: inst?.title || null,
      serviceDate: inst?.serviceDate || null,
      // "attendance for Jr KG A on 2026-08-19", in whatever keys the module used
      scopeLabel: `${collection || 'records'} · ${Object.values(keys).join(' · ')}`,
      canDecide: !!lock && canDecideLock(req.user, lock, idx),
      decidedByName: r.decidedByUserId ? find('users', r.decidedByUserId)?.name || null : null,
    }
  }
  const rows = list('taskLockRequests', (r) => {
    const lock = find('taskLocks', r.lockId)
    return !!lock && (canDecideLock(req.user, lock, idx) || r.byUserId === req.user.id)
  })
  const filtered = req.query.status ? rows.filter((r) => r.status === req.query.status) : rows
  res.json(filtered.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(decorateRequest))
})

router.post('/tasks/lock-requests/:id/decide', (req, res) => {
  const idx = buildOrgIndex()
  const request = find('taskLockRequests', req.params.id)
  if (!request) return res.status(404).json({ error: 'Not found' })
  if (request.status !== 'pending') return res.status(409).json({ error: 'already_decided', message: `That request is already ${request.status}` })
  const lock = find('taskLocks', request.lockId)
  if (!lock) return res.status(404).json({ error: 'Not found' })

  // authority over the PERSON whose work is locked — the same upward line that
  // could have approved the task itself
  if (!canDecideLock(req.user, lock, idx)) {
    return res.status(403).json({ error: 'not_approver', message: 'Only someone above the person whose work this belongs to can allow a re-edit' })
  }
  const decision = req.body?.decision === 'approved' ? 'approved' : 'rejected'
  if (decision === 'rejected' && !String(req.body?.comment || '').trim()) {
    return res.status(422).json({ error: 'reason_required', message: 'Say why — the person who asked will see this' })
  }

  const row = decideReEdit(req.user, request, decision, { comment: req.body?.comment || null })
  auditOrg(req, decision === 'approved' ? 'lock.approve' : 'lock.reject', 'taskLockRequests', row.id, {
    before: { status: 'pending' },
    after: { status: row.status, lockId: lock.id, ref: lock.scope, expiresAt: row.expiresAt, maxEdits: row.maxEdits },
    reason: req.body?.comment || null,
    positionId: primaryPosition(req.user, idx)?.id,
  })
  res.json({ ...row, grantMinutes: GRANT_MINUTES })
})

// Drop a lock entirely — for a record that should never have been locked.
router.post('/tasks/locks/:id/lift', (req, res) => {
  const idx = buildOrgIndex()
  const lock = find('taskLocks', req.params.id)
  if (!lock || lock.status !== 'locked') return res.status(404).json({ error: 'Not found' })
  if (!canDecideLock(req.user, lock, idx)) return res.status(403).json({ error: 'not_approver' })
  const reason = String(req.body?.reason || '').trim()
  if (!reason) return res.status(422).json({ error: 'reason_required', message: 'Say why this lock is being dropped' })
  const row = liftLock(lock, req.user, reason)
  auditOrg(req, 'lock.lift', 'taskLocks', lock.id, { before: lock, after: row, reason, positionId: primaryPosition(req.user, idx)?.id })
  res.json(row)
})

// ============================================================================
// Target preview — the assignment picker calls this on every change so the
// assigner sees exactly who will receive the task, and who was skipped.
// ============================================================================
router.post('/tasks/preview-targets', (req, res) => {
  const idx = buildOrgIndex()
  res.json(previewTargets(req.body?.target || req.body, req.user, idx))
})

// ============================================================================
// Templates
// ============================================================================
// A single pass over the occurrences, so the list can show progress per task
// without the client firing one request per row.
function progressByTask() {
  const map = new Map()
  for (const i of list('taskInstances')) {
    if (i.status === 'cancelled') continue
    const row = map.get(i.taskId) || { done: 0, total: 0, overdue: 0 }
    row.total++
    if (i.status === 'approved') row.done++
    if (i.status === 'overdue') row.overdue++
    map.set(i.taskId, row)
  }
  for (const row of map.values()) row.pct = row.total ? Math.round((row.done / row.total) * 100) : 0
  return map
}

router.get('/tasks', (req, res) => {
  const idx = buildOrgIndex()
  const progress = progressByTask()
  const mine = positionsOfUser(req.user, idx)
  let rows = list('tasks').filter((t) => {
    if (t.createdByUserId === req.user.id) return true
    const creatorPos = idx.positionById.get(t.createdByPositionId)
    return !!creatorPos && mine.some((m) => canManagePosition(m, creatorPos, idx))
  })
  if (req.query.status) rows = rows.filter((t) => t.status === req.query.status)
  if (req.query.academicYearId) rows = rows.filter((t) => t.academicYearId === req.query.academicYearId)
  if (req.query.categoryId) rows = rows.filter((t) => t.categoryId === req.query.categoryId)
  if (req.query.q) {
    const q = req.query.q.toLowerCase()
    rows = rows.filter((t) => t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q))
  }
  res.json(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((t) => ({ ...decorate(t, idx), progress: progress.get(t.id) || { done: 0, total: 0, overdue: 0, pct: 0 } })))
})

// My work, split the way the screen shows it. Declared before /tasks/:id so the
// literal path wins over the parameter.
router.get('/tasks/my', (req, res) => {
  syncTasks()
  const idx = buildOrgIndex()
  const primary = primaryPosition(req.user, idx)
  const tz = idx.nodeById.get(primary?.nodeId)?.timezone || DEFAULT_TZ
  const today = localToday(tz)
  const rows = list('taskInstances', { assigneeUserId: req.user.id }).map((i) => decorateInstance(i, idx, req.user))
  const open = rows.filter((i) => OPEN_STATUSES.includes(i.status))
  const weekEnd = endOfWeek(today)
  const byDate = (a, b) => a.serviceDate.localeCompare(b.serviceDate)
  res.json({
    today,
    weekEnd,
    timezone: tz,
    overdue: open.filter((i) => i.status === 'overdue' || i.serviceDate < today).sort(byDate),
    dueToday: open.filter((i) => i.serviceDate === today && i.status !== 'overdue'),
    // the rest of this calendar week, then everything beyond it
    thisWeek: open.filter((i) => i.serviceDate > today && i.serviceDate <= weekEnd).sort(byDate),
    upcoming: open.filter((i) => i.serviceDate > weekEnd).sort(byDate),
    deferred: rows.filter((i) => i.status === 'deferred').sort(byDate),
    waiting: rows.filter((i) => i.status === 'submitted'),
    doneToday: rows.filter((i) => i.status === 'approved' && i.serviceDate === today).length,
    blockingOpen: open.filter((i) => isGatingNow(i, idx)).length,   // exactly what the gate enforces
  })
})

// Dashboards. Scoping happens inside buildAnalytics against the org tree — a
// node filter can only narrow what the caller already sees, never widen it.
router.get('/tasks/analytics', (req, res) => {
  syncTasks()
  res.json(buildAnalytics(req.user, req.query))
})

// Everything waiting on MY decision. Also before /tasks/:id.
router.get('/tasks/approvals', (req, res) => {
  syncTasks()
  const idx = buildOrgIndex()
  const rows = list('taskInstances', { status: 'submitted' })
    .map((i) => ({ inst: i, right: approvalRight(req.user, i, idx) }))
    .filter(({ right }) => right.allowed)
    // the approver has to see what they are judging: this round's proof and the
    // assignee's note travel with the row
    .map(({ inst, right }) => ({
      ...decorateInstance(inst, idx, req.user),
      viaOverride: right.viaOverride,
      attachments: list('taskAttachments', { instanceId: inst.id }).filter((a) => a.submissionRound === inst.submissionRound),
      previousRounds: list('taskApprovals', { instanceId: inst.id }).length,
    }))
  res.json(rows.sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt))))
})

// ============================================================================
// Notification settings + the send log.
// ============================================================================

// Lead times and per-event channels, per node. Inherited defaults are returned
// when a node has not overridden anything.
router.get('/tasks/notification-settings', (req, res) => {
  const idx = buildOrgIndex()
  const nodeId = req.query.nodeId || primaryPosition(req.user, idx)?.nodeId
  const node = idx.nodeById.get(nodeId)
  if (!node) return res.status(404).json({ error: 'Not found' })
  res.json({
    nodeId: node.id,
    nodeName: node.name,
    defaults: DEFAULT_NOTIFY_SETTINGS,
    settings: notifySettings(node),
    overridden: !!node.settings?.taskNotifications,
    events: TASK_EVENTS,
    canEdit: canAdministerNode(req.user, node, idx),
  })
})

router.put('/tasks/notification-settings', requirePermission('tasks', 'edit'), (req, res) => {
  const idx = buildOrgIndex()
  const nodeId = req.body?.nodeId || primaryPosition(req.user, idx)?.nodeId
  const node = idx.nodeById.get(nodeId)
  if (!node) return res.status(404).json({ error: 'Not found' })
  if (!canAdministerNode(req.user, node, idx)) {
    return res.status(403).json({ error: 'not_in_downline', message: 'You may only change settings for nodes below your own' })
  }
  const incoming = req.body?.settings || {}
  if (incoming.leadTimeHours !== undefined && !(Number(incoming.leadTimeHours) > 0)) {
    return res.status(422).json({ error: 'Lead time must be a positive number of hours' })
  }
  const merged = {
    ...notifySettings(node),
    ...incoming,
    channels: { ...notifySettings(node).channels, ...(incoming.channels || {}) },
  }
  const before = { ...node }
  const row = update('orgNodes', node.id, {
    settings: { ...node.settings, taskNotifications: merged },
  }, req.user.id)
  auditOrg(req, 'tasks.notification_settings', 'orgNodes', node.id, {
    before, after: row, positionId: primaryPosition(req.user, idx)?.id,
  })
  res.json({ nodeId: node.id, settings: merged })
})

// Every send, including the mocked channels and anything suppressed by a user's
// own preferences. Scoped to the caller's downline.
router.get('/tasks/notification-log', (req, res) => {
  const idx = buildOrgIndex()
  const canSee = (userId) => {
    if (userId === req.user.id) return true
    const target = find('users', userId)
    return !!target && canManage(req.user, { userId }, idx)
  }
  const rows = list('notificationLog', (l) => !!l.event)
    .filter((l) => canSee(l.userId))
    .filter((l) => !req.query.event || l.event === req.query.event)
    .filter((l) => !req.query.channel || l.channel === req.query.channel)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, Number(req.query.limit) || 200)
    .map((l) => ({
      ...l,
      userName: find('users', l.userId)?.name || 'Unknown',
      notification: find('notifications', l.notificationId)?.title || null,
    }))
  res.json(rows)
})

// Per-person channel preferences — staff keep these on the user row.
router.get('/tasks/notification-prefs', (req, res) => {
  res.json(req.user.notificationPrefs || { inApp: true, push: true, sms: false, whatsapp: true, email: true })
})

router.put('/tasks/notification-prefs', (req, res) => {
  const prefs = { ...(req.user.notificationPrefs || {}), ...(req.body || {}) }
  update('users', req.user.id, { notificationPrefs: prefs }, req.user.id)
  res.json(prefs)
})

router.get('/tasks/:id', (req, res) => {
  const idx = buildOrgIndex()
  const task = find('tasks', req.params.id)
  if (!task) return res.status(404).json({ error: 'Not found' })
  const preview = previewTargets(task.target, req.user, idx)
  res.json({ ...decorate(task, idx), targets: preview, canEdit: canEditTask(req.user, task, idx) })
})

router.post('/tasks', requirePermission('tasks', 'create'), (req, res) => {
  const idx = buildOrgIndex()
  const actorPos = primaryPosition(req.user, idx)
  if (!actorPos) return res.status(403).json({ error: 'no_position', message: 'You are not placed in the org tree yet' })

  const { task, errors } = normalizeTask(req.body)
  if (errors.length) return res.status(422).json({ error: 'invalid_task', message: errors[0], errors })

  const { allowed, rejected } = resolveTargets(task.target, req.user, idx)
  if (rejected.length) {
    return res.status(403).json({ error: 'not_in_downline', message: `${rejected[0].userName} is not in your downline`, rejected })
  }
  if (!allowed.length) {
    return res.status(422).json({ error: 'no_targets', message: 'That target resolves to nobody below you' })
  }

  // the approver must be the assigner or someone above every assignee
  let approverPositionId = task.approverPositionId || actorPos.id
  if (approverPositionId !== actorPos.id) {
    const approver = idx.positionById.get(approverPositionId)
    const ok = approver && allowed.every((t) => canManagePosition(approver, t, idx))
    if (!ok) return res.status(422).json({ error: 'invalid_approver', message: 'The approver must sit above everyone assigned' })
  }
  if (actorPos.implicit) approverPositionId = null    // bootstrap super admin holds no real position

  const row = insert('tasks', {
    ...task,
    approverPositionId,
    createdByUserId: req.user.id,
    createdByPositionId: actorPos.implicit ? null : actorPos.id,
    createdAtNodeId: actorPos.nodeId,
    lastGeneratedThrough: null,
  }, req.user.id)

  // Materialize immediately: the assigner should see real work land on real
  // people, not a template that only becomes visible on someone's next read.
  const instances = generateForTask(row, buildOrgIndex(), {})
  if (instances.length) notifyAssigned(instances, buildOrgIndex())
  auditOrg(req, 'task.create', 'tasks', row.id, {
    after: { ...row, assignedTo: allowed.map((p) => p.id), instancesCreated: instances.length },
    positionId: actorPos.id,
  })
  res.status(201).json({
    ...decorate(row, idx),
    targets: previewTargets(row.target, req.user, idx),
    assignedCount: allowed.length,
    instancesCreated: instances.length,
    instances: instances.map((i) => decorateInstance(i, idx, req.user)),
  })
})

// Per-assignee rollup for the "Tasks I Assigned" tracking view.
router.get('/tasks/:id/progress', (req, res) => {
  syncTasks({ taskIds: [req.params.id] })
  const idx = buildOrgIndex()
  const task = find('tasks', req.params.id)
  if (!task) return res.status(404).json({ error: 'Not found' })

  const rows = list('taskInstances', { taskId: task.id })
  const mine = positionsOfUser(req.user, idx)
  if (!rows.some((i) => visibleInstance(req.user, i, idx, mine)) && !canEditTask(req.user, task, idx)) {
    return res.status(404).json({ error: 'Not found' })
  }

  const byAssignee = new Map()
  for (const i of rows) {
    const key = i.assigneePositionId
    if (!byAssignee.has(key)) {
      const pos = idx.positionById.get(key)
      const described = pos ? describePosition(pos, idx) : null
      byAssignee.set(key, {
        positionId: key,
        userId: i.assigneeUserId,
        userName: i.assigneeName || described?.userName || 'Unknown',
        tier: described?.tier || null,
        nodeName: described?.nodeName || idx.nodeById.get(i.assigneeNodeId)?.name || '',
        total: 0, done: 0, open: 0, overdue: 0, awaitingApproval: 0, cancelled: 0,
        latestStatus: null, latestServiceDate: null, lastActivityAt: null,
      })
    }
    const row = byAssignee.get(key)
    row.total++
    if (i.status === 'approved') row.done++
    else if (i.status === 'overdue') { row.overdue++; row.open++ }
    else if (i.status === 'submitted') row.awaitingApproval++
    else if (i.status === 'cancelled') row.cancelled++
    else if (OPEN_STATUSES.includes(i.status)) row.open++
    if (!row.latestServiceDate || i.serviceDate > row.latestServiceDate) {
      row.latestServiceDate = i.serviceDate
      row.latestStatus = i.status
    }
    const activity = i.completedAt || i.submittedAt || i.startedAt || i.updatedAt
    if (activity && (!row.lastActivityAt || activity > row.lastActivityAt)) row.lastActivityAt = activity
  }

  const people = [...byAssignee.values()]
    .map((p) => ({ ...p, pct: p.total ? Math.round((p.done / p.total) * 100) : 0 }))
    .sort((a, b) => a.pct - b.pct || b.overdue - a.overdue || a.userName.localeCompare(b.userName))

  res.json({
    task: decorate(task, idx),
    assignees: people.length,
    totals: rows.reduce((acc, i) => ({ ...acc, [i.status]: (acc[i.status] || 0) + 1 }), {}),
    completion: rows.length ? Math.round((rows.filter((i) => i.status === 'approved').length / rows.length) * 100) : 0,
    people,
  })
})

router.put('/tasks/:id', requirePermission('tasks', 'edit'), (req, res) => {
  const idx = buildOrgIndex()
  const task = find('tasks', req.params.id)
  if (!task) return res.status(404).json({ error: 'Not found' })
  if (!canEditTask(req.user, task, idx)) return res.status(403).json({ error: 'not_in_downline', message: 'Only the assigner or someone above them can edit this task' })

  const { task: normalized, errors } = normalizeTask(req.body, { existing: task })
  if (errors.length) return res.status(422).json({ error: 'invalid_task', message: errors[0], errors })
  if (req.body.target) {
    const { rejected, allowed } = resolveTargets(normalized.target, req.user, idx)
    if (rejected.length) return res.status(403).json({ error: 'not_in_downline', message: `${rejected[0].userName} is not in your downline`, rejected })
    if (!allowed.length) return res.status(422).json({ error: 'no_targets', message: 'That target resolves to nobody below you' })
  }
  const before = { ...task }
  const row = update('tasks', task.id, normalized, req.user.id)
  // future, untouched occurrences follow the template; past and in-flight work
  // keeps the rules it was assigned under
  const propagation = applyTemplateEdit(row, req.user.id)
  auditOrg(req, 'task.update', 'tasks', task.id, {
    before, after: { ...row, propagation }, positionId: primaryPosition(req.user, idx)?.id,
  })
  res.json({ ...decorate(find('tasks', task.id) || row, idx), propagation })
})

// pause = stop generating new occurrences, leave existing ones alone
router.post('/tasks/:id/pause', requirePermission('tasks', 'edit'), (req, res) => {
  const idx = buildOrgIndex()
  const task = find('tasks', req.params.id)
  if (!task) return res.status(404).json({ error: 'Not found' })
  if (!canEditTask(req.user, task, idx)) return res.status(403).json({ error: 'not_in_downline' })
  const status = task.status === 'paused' ? 'active' : 'paused'
  const row = update('tasks', task.id, { status }, req.user.id)
  // pausing withdraws future occurrences nobody has touched; resuming puts them
  // back. Today and anything in flight are left alone either way.
  const propagation = applyTemplateEdit(row, req.user.id)
  auditOrg(req, status === 'paused' ? 'task.pause' : 'task.resume', 'tasks', task.id, {
    after: { ...row, propagation }, positionId: primaryPosition(req.user, idx)?.id,
  })
  res.json({ ...decorate(row, idx), propagation })
})

router.post('/tasks/:id/cancel', requirePermission('tasks', 'edit'), (req, res) => {
  const idx = buildOrgIndex()
  const task = find('tasks', req.params.id)
  if (!task) return res.status(404).json({ error: 'Not found' })
  if (!canEditTask(req.user, task, idx)) return res.status(403).json({ error: 'not_in_downline' })
  const before = { ...task }
  const row = update('tasks', task.id, { status: 'cancelled' }, req.user.id)
  // open occurrences die with the template; finished ones stay as history
  let cancelled = 0
  for (const inst of list('taskInstances', { taskId: task.id })) {
    if (['approved', 'cancelled'].includes(inst.status)) continue
    update('taskInstances', inst.id, { status: 'cancelled', cancelReason: req.body?.reason || 'Task cancelled' }, req.user.id)
    cancelled++
  }
  auditOrg(req, 'task.cancel', 'tasks', task.id, { before, after: row, reason: req.body?.reason || null, positionId: primaryPosition(req.user, idx)?.id })
  res.json({ ...decorate(row, idx), cancelledInstances: cancelled })
})

// ============================================================================
// Instances (occurrences). Generation is lazy: every read below materializes
// what is due first, so there is no scheduler to babysit.
// ============================================================================

// An occurrence is visible to its assignee, to whoever assigned it, and to
// anyone above the assignee — the same line that may approve it.
function visibleInstance(user, inst, idx, mine) {
  if (inst.assigneeUserId === user.id || inst.assignedByUserId === user.id) return true
  const pos = idx.positionById.get(inst.assigneePositionId)
  return !!pos && mine.some((m) => canManagePosition(m, pos, idx))
}

function decorateInstance(inst, idx = buildOrgIndex(), user = null) {
  const pos = idx.positionById.get(inst.assigneePositionId)
  const described = pos ? describePosition(pos, idx) : null
  const task = find('tasks', inst.taskId)
  // what THIS viewer may do — the same predicates the actions re-check
  const mineToDo = user ? isAssignee(user, inst) : false
  const manages = user ? canManageInstance(user, inst, idx) : false
  const approves = user ? approvalRight(user, inst, idx).allowed : false
  const open = OPEN_STATUSES.includes(inst.status)
  // an assignee may shuffle their own task only inside the completion window
  // the template granted them, and never a mandatory one
  const selfDeferTo = mineToDo ? selfDeferLimit(inst) : null
  // readiness, not permission: `can.submit` says the viewer is allowed to
  // submit, `condition` says whether the work would be accepted if they did
  const verdict = evaluateCondition(inst)
  const ml = inst.completionCondition?.nature === 'module_linked' ? inst.completionCondition.moduleLinked : null
  return {
    selfDeferLimit: selfDeferTo,
    condition: {
      ...verdict,
      summary: describeCondition(inst.completionCondition),
      nature: inst.completionCondition?.nature || 'custom',
      // The derived answer. Read-only by construction: its value is the signal,
      // and there is no endpoint that lets an assignee set it.
      derived: ml ? {
        question: ml.derivedMcq?.question || 'Done in the module?',
        value: verdict.satisfied ? 'yes' : null,
        readOnly: true,
        enabled: verdict.satisfied,
        checkedAt: inst.conditionCheckedAt || null,
        cta: verdict.cta || null,
      } : null,
      evidence: inst.completionEvidence || null,
      actions: describeActions(inst.onComplete?.actions),
    },
    actionResults: inst.actionResults || [],
    can: {
      start: mineToDo && ['assigned', 'overdue', 'rejected'].includes(inst.status),
      submit: mineToDo && open,
      answer: mineToDo && open && inst.completionCondition?.nature !== 'module_linked',
      decide: approves && inst.status === 'submitted',
      defer: open && (manages || (!!selfDeferTo && selfDeferTo > inst.serviceDate)),
      cancel: manages && !['approved', 'cancelled'].includes(inst.status),
      reassign: manages && !['approved', 'cancelled'].includes(inst.status),
    },
    ...inst,
    assigneeName: inst.assigneeName || described?.userName || find('users', inst.assigneeUserId)?.name || 'Unknown',
    assigneeTier: described?.tier || null,
    nodeName: described?.nodeName || idx.nodeById.get(inst.assigneeNodeId)?.name || '',
    assignedByName: find('users', inst.assignedByUserId)?.name || 'Unknown',
    categoryId: task?.categoryId || null,
    categoryName: task?.categoryId ? find('taskCategories', task.categoryId)?.name || null : null,
    // description and recurrence are genuinely NOT snapshotted, so the template
    // is the only source for them and a later edit legitimately shows through.
    description: task?.description || '',
    recurrence: task?.recurrence || null,
    // dueType IS snapshotted (generate.js), precisely so editing a template does
    // not retime work already issued. Reading the template here handed the client
    // a different value from the one selfDeferLimit() judges against.
    dueType: inst.dueType || task?.dueType || 'end_of_day',
  }
}

router.get('/task-instances', (req, res) => {
  syncTasks()
  const idx = buildOrgIndex()
  const mine = positionsOfUser(req.user, idx)
  const scope = req.query.scope || 'all'

  let rows = list('taskInstances').filter((i) => visibleInstance(req.user, i, idx, mine))
  if (scope === 'mine') rows = rows.filter((i) => i.assigneeUserId === req.user.id)
  if (scope === 'assigned_by_me') rows = rows.filter((i) => i.assignedByUserId === req.user.id)
  if (scope === 'downline') rows = rows.filter((i) => i.assigneeUserId !== req.user.id)
  if (req.query.status) rows = rows.filter((i) => req.query.status.split(',').includes(i.status))
  if (req.query.open === 'true') rows = rows.filter((i) => OPEN_STATUSES.includes(i.status))
  if (req.query.taskId) rows = rows.filter((i) => i.taskId === req.query.taskId)
  if (req.query.nodeId) rows = rows.filter((i) => i.assigneeNodeId === req.query.nodeId)
  if (req.query.academicYearId) rows = rows.filter((i) => i.academicYearId === req.query.academicYearId)
  if (req.query.from) rows = rows.filter((i) => i.serviceDate >= req.query.from)
  if (req.query.to) rows = rows.filter((i) => i.serviceDate <= req.query.to)

  res.json(rows
    .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate) || a.assigneeName.localeCompare(b.assigneeName))
    .map((i) => decorateInstance(i, idx, req.user)))
})

router.get('/task-instances/:id', (req, res) => {
  const idx = buildOrgIndex()
  let inst = find('taskInstances', req.params.id)
  if (!inst) return res.status(404).json({ error: 'Not found' })
  if (!visibleInstance(req.user, inst, idx, positionsOfUser(req.user, idx))) return res.status(404).json({ error: 'Not found' })
  // opening a module-linked task re-reads its signal, so the page reflects what
  // is true right now rather than whatever the last push left behind
  if (isModuleLinked(inst) && OPEN_STATUSES.includes(inst.status)) {
    verifyInstance(inst, { source: 'pull' })
    inst = find('taskInstances', inst.id) || inst
  }
  res.json({
    ...decorateInstance(inst, idx, req.user),
    attachments: list('taskAttachments', { instanceId: inst.id }),
    approvals: list('taskApprovals', { instanceId: inst.id }),
    verifications: list('taskVerifications', { instanceId: inst.id })
      .sort((a, b) => (b.observedAt || '').localeCompare(a.observedAt || '')),
  })
})

router.get('/task-instances/:id/timeline', (req, res) => {
  const idx = buildOrgIndex()
  const inst = find('taskInstances', req.params.id)
  if (!inst) return res.status(404).json({ error: 'Not found' })
  if (!visibleInstance(req.user, inst, idx, positionsOfUser(req.user, idx))) return res.status(404).json({ error: 'Not found' })

  const events = list('auditLog', (a) => a.collection === 'taskInstances' && a.recordId === inst.id).map((a) => ({
    id: a.id,
    at: a.createdAt,
    action: a.action,
    userId: a.userId,
    userName: find('users', a.userId)?.name || 'System',
    reason: a.reason || null,
    positionId: a.positionId || null,
  }))
  const approvals = list('taskApprovals', { instanceId: inst.id }).map((a) => ({
    id: a.id,
    at: a.decidedAt,
    action: a.decision === 'approved' ? 'instance.approve' : 'instance.reject',
    userId: a.approverUserId,
    userName: find('users', a.approverUserId)?.name || 'Unknown',
    reason: a.comment,
    round: a.round,
    viaOverride: a.viaOverride,
  }))
  const attachments = list('taskAttachments', { instanceId: inst.id })
  // the assignment itself is derived from the row, not stored as its own audit
  // line — otherwise a daily task for 5 people writes 40 rows a week
  const assigned = {
    id: `assign-${inst.id}`,
    at: inst.createdAt,
    action: 'instance.assign',
    userId: inst.assignedByUserId,
    userName: find('users', inst.assignedByUserId)?.name || 'System',
    reason: `Assigned to ${inst.assigneeName} for ${inst.serviceDate}`,
    positionId: inst.assignedByPositionId,
  }
  res.json({
    events: [assigned, ...events, ...approvals].sort((a, b) => String(a.at).localeCompare(String(b.at))),
    approvals,
    attachments,
  })
})

// ---------------------------------------------------------------- actions ---
// Thin wrappers: all the rules live in tasks/service.js.
function action(handler) {
  return (req, res) => {
    const idx = buildOrgIndex()
    const inst = find('taskInstances', req.params.id)
    if (!inst) return res.status(404).json({ error: 'Not found' })
    if (!visibleInstance(req.user, inst, idx, positionsOfUser(req.user, idx))) return res.status(404).json({ error: 'Not found' })
    try {
      const before = { ...inst }
      const { row, audit } = handler(req, inst, idx)
      auditOrg(req, audit.action, 'taskInstances', inst.id, {
        before, after: row, reason: audit.reason || null, positionId: primaryPosition(req.user, idx)?.id,
      })
      res.json(decorateInstance(find('taskInstances', row.id) || row, idx, req.user))
    } catch (err) {
      if (err instanceof TaskError) return res.status(err.status).json({ error: err.error, message: err.message })
      throw err
    }
  }
}

router.post('/task-instances/:id/start', requirePermission('tasks', 'edit'), action((req, inst) => ({
  row: startWork(req.user, inst),
  audit: { action: 'instance.start' },
})))

// Record the answer / checklist / note without submitting.
router.post('/task-instances/:id/answer', requirePermission('tasks', 'edit'), action((req, inst) => ({
  row: recordCompletion(req.user, inst, req.body || {}),
  audit: { action: 'instance.answer', reason: req.body?.answer || req.body?.note || null },
})))

router.post('/task-instances/:id/submit', requirePermission('tasks', 'edit'), action((req, inst) => ({
  row: submitWork(req.user, inst, { comment: req.body?.comment || null, completion: req.body?.completion || null }),
  audit: { action: 'instance.submit', reason: req.body?.comment || null },
})))

router.post('/task-instances/:id/approve', requirePermission('tasks', 'edit'), action((req, inst) => ({
  row: decide(req.user, inst, 'approved', { comment: req.body?.comment || null }),
  audit: { action: 'instance.approve', reason: req.body?.comment || null },
})))

router.post('/task-instances/:id/reject', requirePermission('tasks', 'edit'), action((req, inst) => ({
  row: decide(req.user, inst, 'rejected', { comment: req.body?.comment || null }),
  audit: { action: 'instance.reject', reason: req.body?.comment || null },
})))

router.post('/task-instances/:id/defer', requirePermission('tasks', 'edit'), action((req, inst) => ({
  row: deferInstance(req.user, inst, { to: req.body?.to, reason: req.body?.reason }),
  audit: { action: 'instance.defer', reason: req.body?.reason || null },
})))

router.post('/task-instances/:id/cancel', requirePermission('tasks', 'edit'), action((req, inst) => ({
  row: cancelInstance(req.user, inst, { reason: req.body?.reason || null }),
  audit: { action: 'instance.cancel', reason: req.body?.reason || null },
})))

router.post('/task-instances/:id/reassign', requirePermission('tasks', 'edit'), action((req, inst) => ({
  row: reassignInstance(req.user, inst, { toPositionId: req.body?.toPositionId, reason: req.body?.reason || null }),
  audit: { action: 'instance.reassign', reason: req.body?.reason || null },
})))

router.post('/task-instances/:id/attachments', requirePermission('tasks', 'edit'), action((req, inst) => {
  const row = addAttachment(req.user, inst, req.body?.mediaId)
  return { row: find('taskInstances', inst.id), audit: { action: 'instance.attach', reason: row.filename } }
}))

router.delete('/task-instances/:id/attachments/:attachmentId', requirePermission('tasks', 'edit'), action((req, inst) => {
  removeAttachment(req.user, inst, req.params.attachmentId)
  return { row: find('taskInstances', inst.id), audit: { action: 'instance.detach' } }
}))

// Explicit materialization — idempotent, used by tests, demos and the UI's
// "generate now" button. Never creates duplicates.
router.post('/tasks/generate', requirePermission('tasks', 'edit'), (req, res) => {
  const idx = buildOrgIndex()
  if (req.body?.taskId) {
    const task = find('tasks', req.body.taskId)
    if (!task) return res.status(404).json({ error: 'Not found' })
    if (!canEditTask(req.user, task, idx)) return res.status(403).json({ error: 'not_in_downline' })
    const created = generateForTask(task, idx, { through: req.body.through || null })
    return res.json({ created: created.length, instances: created.map((i) => decorateInstance(i, idx, req.user)) })
  }
  const result = syncTasks({ through: req.body?.through || null })
  res.json(result)
})

// ============================================================================
// Logout-gate safety valves.
//
// Nobody may be permanently trapped: a manager can release someone for the day,
// and the person can ask to be released if no manager has noticed. Both are
// audited, and a release is never silent.
// ============================================================================

// Who, in my downline, is stuck right now — the discoverable admin view.
router.get('/tasks/gate/blocked', (req, res) => {
  syncTasks()
  const idx = buildOrgIndex()
  const mine = positionsOfUser(req.user, idx)
  const seen = new Map()

  for (const inst of list('taskInstances', (i) => i.isBlocking && OPEN_STATUSES.includes(i.status))) {
    const pos = idx.positionById.get(inst.assigneePositionId)
    if (!pos || !mine.some((m) => canManagePosition(m, pos, idx))) continue
    if (seen.has(inst.assigneeUserId)) continue
    const user = find('users', inst.assigneeUserId)
    if (!user) continue
    const gate = evaluate(user, idx)
    if (!gate.blocked && !gate.released) continue
    const described = describePosition(pos, idx)
    seen.set(inst.assigneeUserId, {
      userId: user.id,
      userName: user.name,
      tier: described.tier,
      nodeName: described.nodeName,
      blocked: gate.blocked,
      armed: gate.armed,
      released: gate.released,
      release: gate.release,
      instances: gate.instances,
    })
  }
  res.json([...seen.values()].sort((a, b) => Number(b.armed) - Number(a.armed) || a.userName.localeCompare(b.userName)))
})

// An ancestor releases someone for today. The work stays on their list — this
// only lifts the door lock, and says who unlocked it and why.
router.post('/tasks/gate/release', requirePermission('tasks', 'edit'), (req, res) => {
  const idx = buildOrgIndex()
  const { userId, reason } = req.body || {}
  const target = find('users', userId)
  if (!target) return res.status(404).json({ error: 'Not found' })
  if (!String(reason || '').trim()) {
    return res.status(422).json({ error: 'reason_required', message: 'Say why you are releasing them — it goes in the audit log' })
  }
  if (!canManage(req.user, { userId }, idx)) {
    return res.status(403).json({ error: 'not_in_downline', message: 'Only someone above them can release them' })
  }

  const gate = evaluate(target, idx)
  const tz = gate.instances[0] ? (find('taskInstances', gate.instances[0].id)?.tz || DEFAULT_TZ) : DEFAULT_TZ
  const forDate = localToday(tz)
  const row = recordRelease({
    userId, byUser: req.user, byPositionId: primaryPosition(req.user, idx)?.id,
    reason: String(reason).trim(), forDate,
  })
  auditOrg(req, 'gate.override', 'users', userId, {
    after: { forDate, released: gate.instances.map((i) => i.id) },
    reason: String(reason).trim(),
    positionId: row.byPositionId,
  })
  dispatchTask('gate_released', {
    userIds: [userId],
    title: 'You can sign off',
    body: `${req.user.name} released you for today — ${String(reason).trim()}. The tasks are still on your list for tomorrow.`,
    meta: { refType: 'gate', refId: userId },
  })
  res.status(201).json({ ok: true, forDate, release: row, stillOutstanding: gate.instances.length })
})

// The person asks to be let out — sick, emergency, anything. Everyone above
// them is notified, so this never depends on one manager being at their desk.
router.post('/tasks/gate/request-release', (req, res) => {
  const idx = buildOrgIndex()
  const reason = String(req.body?.reason || '').trim()
  if (!reason) return res.status(422).json({ error: 'reason_required', message: 'Tell them what has come up' })

  const gate = evaluate(req.user, idx)
  if (!gate.blocked) return res.status(409).json({ error: 'not_blocked', message: 'Nothing is holding you — you can sign off' })

  const ancestors = getAncestors(req.user, idx)
  if (!ancestors.length) {
    return res.status(409).json({ error: 'no_manager', message: 'You have nobody above you in the org tree to ask' })
  }
  dispatchTask('gate_request', {
    userIds: [...new Set(ancestors.map((a) => a.userId))],
    title: `${req.user.name} is asking to sign off`,
    body: `${gate.instances.length} mandatory task${gate.instances.length > 1 ? 's' : ''} outstanding — "${reason}". Release or defer them from Tasks → Blocked.`,
    meta: { refType: 'gate', refId: req.user.id },
  })
  auditOrg(req, 'gate.release_requested', 'users', req.user.id, {
    after: { outstanding: gate.instances.map((i) => i.id) },
    reason,
    positionId: primaryPosition(req.user, idx)?.id,
  })
  res.status(201).json({ ok: true, notified: ancestors.map((a) => a.userName) })
})

export default router
