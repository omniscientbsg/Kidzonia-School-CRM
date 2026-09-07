// Every state change an occurrence can undergo. Routes stay thin; the rules
// (who may act, which transition is legal, what proof is required) live here so
// they cannot be bypassed by adding another endpoint later.
import { list, find, insert, update } from '../db.js'
import { buildOrgIndex, positionsOfUser, primaryPosition, canManagePosition, describePosition } from '../org/tree.js'
import { notifyUsers } from '../notify.js'
import { dispatchTask, notifySettings, notifyCompleted } from './notify.js'
import { MEDIA_MIME, OPEN_STATUSES, TERMINAL_STATUSES } from './model.js'
import { evaluateCondition, normalizeCompletionInput, systemSpec, answersAreTyped } from './conditions.js'
import { verifyInstance, latestVerification } from './verify.js'
import { runCompletionActions } from './actions.js'
import { placeLocks } from './lock.js'
import { startEscalation, clearEscalation } from './escalation.js'
import { fileDayEndReport } from './dayend.js'
import { instanceId } from './generate.js'
import { localDate } from './time.js'
import { shiftEndsAt } from '../org/hours.js'

export class TaskError extends Error {
  // `missing` names the question ids standing in the way. With one question the
  // code and the message said everything; with several, the client has no way
  // to put the error next to the right field without it.
  constructor(status, error, message, missing = []) {
    super(message || error)
    this.status = status
    this.error = error
    this.missing = missing
  }
}

const fail = (status, error, message, missing = []) => { throw new TaskError(status, error, message, missing) }

// ------------------------------------------------------------- authority ----
export const isAssignee = (user, inst) => inst.assigneeUserId === user.id

// Anyone above the assignee, plus whoever assigned it.
export function canManageInstance(user, inst, idx = buildOrgIndex()) {
  if (inst.assignedByUserId === user.id) return true
  const pos = idx.positionById.get(inst.assigneePositionId)
  if (!pos) return false
  return positionsOfUser(user, idx).some((m) => canManagePosition(m, pos, idx))
}

// Approval flows upward only: the named approver, or any ancestor of the
// assignee (recorded as an override so the audit shows who really decided).
export function approvalRight(user, inst, idx = buildOrgIndex()) {
  const mine = positionsOfUser(user, idx)
  if (mine.some((p) => p.id === inst.approverPositionId)) return { allowed: true, viaOverride: false }
  const pos = idx.positionById.get(inst.assigneePositionId)
  if (pos && mine.some((m) => canManagePosition(m, pos, idx))) return { allowed: true, viaOverride: true }
  return { allowed: false, viaOverride: false }
}

// --------------------------------------------------------------- helpers ----
const stamp = () => new Date().toISOString()

function assertStatus(inst, allowed) {
  if (!allowed.includes(inst.status)) {
    fail(409, 'bad_transition', `A task that is ${inst.status.replace(/_/g, ' ')} cannot do that`)
  }
}

function attachmentsOfRound(inst) {
  return list('taskAttachments', { instanceId: inst.id }).filter((a) => a.submissionRound === inst.submissionRound)
}

// --------------------------------------------------------- attachments ------
export function addAttachment(user, inst, mediaId) {
  if (!isAssignee(user, inst)) fail(403, 'not_assignee', 'Only the assignee can attach proof')
  assertStatus(inst, OPEN_STATUSES)
  const asset = find('mediaAssets', mediaId)
  if (!asset) fail(422, 'unknown_media', 'That upload could not be found')

  const allowed = inst.mediaTypes || []
  const kind = allowed.find((t) => MEDIA_MIME[t]?.(asset.mimetype))
  if (inst.requiresMedia && !kind) {
    fail(422, 'wrong_media_type', `This task accepts ${allowed.join(' / ')} only`)
  }
  const row = insert('taskAttachments', {
    instanceId: inst.id,
    mediaId,
    kind: kind || 'document',
    submissionRound: inst.submissionRound,
    uploadedByUserId: user.id,
    mimetype: asset.mimetype,
    size: asset.size,
    filename: asset.filename,
  }, user.id)
  update('taskInstances', inst.id, { attachmentIds: [...(inst.attachmentIds || []), row.id] }, user.id)
  return row
}

export function removeAttachment(user, inst, attachmentId) {
  if (!isAssignee(user, inst)) fail(403, 'not_assignee', 'Only the assignee can remove proof')
  assertStatus(inst, OPEN_STATUSES)
  const row = find('taskAttachments', attachmentId)
  if (!row || row.instanceId !== inst.id) fail(404, 'not_found', 'Attachment not found')
  update('taskAttachments', attachmentId, { deletedAt: stamp() }, user.id)
  update('taskInstances', inst.id, { attachmentIds: (inst.attachmentIds || []).filter((id) => id !== attachmentId) }, user.id)
  return { ok: true }
}

// ------------------------------------------------------------ transitions ---
export function startWork(user, inst) {
  if (!isAssignee(user, inst)) fail(403, 'not_assignee', 'Only the assignee can start this task')
  assertStatus(inst, ['assigned', 'overdue', 'rejected'])
  return update('taskInstances', inst.id, { status: 'in_progress', startedAt: inst.startedAt || stamp() }, user.id)
}

// Record the assignee's answer / checklist / note without submitting. Kept
// separate so a half-filled form survives a refresh, and so the audit shows
// when the answer was given as distinct from when the work was submitted.
//
// A module_linked occurrence has no assignee-typed answer at all — the tick is
// read from the module — so this refuses rather than storing a fiction.
export function recordCompletion(user, inst, body = {}) {
  if (!isAssignee(user, inst)) fail(403, 'not_assignee', 'Only the assignee can answer this task')
  assertStatus(inst, ['assigned', 'in_progress', 'overdue', 'rejected'])
  // A pure system check has nothing for the assignee to type. A `both` task
  // does — it asks questions AND checks the system — so this is NOT the same
  // test as "does the pull guard run" further down.
  if (!answersAreTyped(inst)) {
    fail(422, 'derived_answer', 'This task is answered by the module, not by hand — do the work in the module and it ticks itself')
  }
  // MERGE, never replace. With one question a total replacement was safe;
  // with several, saving one answer would wipe the answers to the others.
  const { answers } = normalizeCompletionInput(inst, body)
  const completion = {
    answers: { ...(inst.completion?.answers || {}), ...answers },
    at: stamp(),
    byUserId: user.id,
  }
  return update('taskInstances', inst.id, { completion }, user.id)
}

export function submitWork(user, inst, { comment = null, completion = null } = {}) {
  if (!isAssignee(user, inst)) fail(403, 'not_assignee', 'Only the assignee can submit this task')
  assertStatus(inst, ['assigned', 'in_progress', 'overdue', 'rejected'])

  // the form may answer and submit in one go; either way the stored record is
  // what gets judged
  let current = inst
  if (completion && answersAreTyped(inst)) {
    current = recordCompletion(user, inst, completion)
  }

  // THE PULL GUARD. A module-linked task re-reads its signal here, live, every
  // time. Push and the sweep are latency optimisations; this is the check that
  // cannot be bypassed — a missed event, a stale flag or an edited register all
  // land here and stop the submit.
  if (systemSpec(current)) {
    verifyInstance(current, { source: 'pull' })
    current = find('taskInstances', current.id) || current
  }

  // How we know it is done. `verifiable: false` means we cannot judge yet —
  // that is a different answer from "no", and it says so.
  const verdict = evaluateCondition(current)
  if (!verdict.satisfied) {
    fail(422, verdict.code || 'condition_unmet', verdict.message, verdict.missing || [])
  }
  inst = current

  if (inst.requiresMedia) {
    const proof = attachmentsOfRound(inst)
    const need = inst.minAttachments || 1
    if (proof.length < need) {
      fail(422, 'proof_required', `Attach ${need} ${inst.mediaTypes.join(' / ')} file${need > 1 ? 's' : ''} before submitting`)
    }
  }

  const now = stamp()
  // Freeze the evidence that was true at the moment of submission. The live
  // signal can change afterwards — a register can be edited next week — and the
  // record of what we accepted, and when, must not change with it.
  const evidence = evidenceAtSubmission(inst)

  if (inst.requiresApproval) {
    let row = update('taskInstances', inst.id, { status: 'submitted', submittedAt: now, lastComment: comment, completionEvidence: evidence }, user.id)
    const idx = buildOrgIndex()
    // start the clock. Submitting already cleared this person's logout gate —
    // `submitted` is not an open status — so a slow chain above them is the
    // approver's problem from here on, never theirs.
    if (startEscalation(row, idx)) row = find('taskInstances', row.id) || row
    const approver = idx.positionById.get(row.approverPositionId)
    if (approver) {
      dispatchTask('submitted', {
        userIds: [approver.userId],
        title: 'Task awaiting your approval',
        body: `${user.name} submitted “${row.title}”`,
        instance: row,
        settings: notifySettings(idx.nodeById.get(inst.assigneeNodeId)),
      })
    }
    return row
  }
  const done = update('taskInstances', inst.id, { status: 'approved', submittedAt: now, completedAt: now, lastComment: comment, completionEvidence: evidence }, user.id)
  // side effects fire only here, at terminal completion — never on submit for
  // approval, because a bounce after telling the parents cannot be un-told
  runCompletionActions(done, user)
  // and the records this was verified against become evidence: editable only
  // with someone senior's agreement from here on
  placeLocks(done, user)
  // a day-end occurrence IS its report: completing it files the frozen roll-up
  // with the reporting manager
  fileDayEndReport(done, user)
  notifyCompleted(done)
  return find('taskInstances', done.id) || done
}

// What satisfied a module-linked task, captured at submission time.
function evidenceAtSubmission(inst) {
  if (!systemSpec(inst)) return null
  const v = latestVerification(inst.id, inst.submissionRound || 1)
  if (!v?.satisfied) return null
  return {
    verificationId: v.id,
    moduleKey: v.moduleKey,
    signalKey: v.signalKey,
    recordIds: v.evidence?.recordIds || [],
    count: v.evidence?.count ?? null,
    checksum: v.evidence?.checksum || null,
    markedByUserId: v.evidence?.markedByUserId || null,
    markedAt: v.evidence?.markedAt || null,
    observedAt: v.observedAt,
    summary: v.message || null,
  }
}

export function decide(user, inst, decision, { comment = null } = {}) {
  const idx = buildOrgIndex()
  const right = approvalRight(user, inst, idx)
  if (!right.allowed) fail(403, 'not_approver', 'Only the approver or someone above the assignee can decide this')
  assertStatus(inst, ['submitted'])
  // sending work back without saying why is not a decision, it is a bounce
  if (decision === 'rejected' && !String(comment || '').trim()) {
    fail(422, 'reason_required', 'Say what needs fixing — the assignee sees this')
  }

  const now = stamp()
  const actorPos = primaryPosition(user, idx)
  insert('taskApprovals', {
    instanceId: inst.id,
    round: inst.submissionRound,
    decision,
    approverUserId: user.id,
    approverPositionId: actorPos?.id || null,
    comment,
    viaOverride: right.viaOverride,
    // carried onto the record because a rejection clears it from the instance —
    // without it, turnaround stats would silently ignore every rejection
    submittedAt: inst.submittedAt,
    decidedAt: now,
  }, user.id)

  const round = inst.submissionRound || 1
  const patch = decision === 'approved'
    ? { status: 'approved', decidedAt: now, completedAt: now, lastComment: comment }
    : {
        // Rejection hands the work straight back as live work — not a parked
        // "rejected" state. It stays open, so a mandatory task still blocks
        // logout until it is resubmitted AND approved.
        status: 'in_progress',
        decidedAt: now,
        lastComment: comment,
        rejectionCount: (inst.rejectionCount || 0) + 1,
        submissionRound: round + 1,                         // a new round needs fresh proof
        completion: null,                                   // and a fresh answer
        submittedAt: null,
        lastRejection: { at: now, by: user.id, byName: user.name, reason: comment, round },
      }
  let row = update('taskInstances', inst.id, patch, user.id)
  // a decision stops the clock either way
  if (row.escalation && !row.escalation.closedAt) {
    clearEscalation(row, decision === 'approved' ? 'approved' : 'sent_back')
    row = find('taskInstances', row.id) || row
  }
  const settings = notifySettings(idx.nodeById.get(inst.assigneeNodeId))
  dispatchTask(decision === 'approved' ? 'approved' : 'rejected', {
    userIds: [inst.assigneeUserId],
    title: decision === 'approved' ? 'Task approved' : 'Task sent back',
    body: `${user.name} ${decision === 'approved' ? 'approved' : 'rejected'} “${inst.title}”${comment ? `: ${comment}` : ''}`,
    instance: row,
    settings,
  })
  // the assigner gets the progress ping when it actually finishes
  if (decision === 'approved') {
    runCompletionActions(row, user)
    placeLocks(row, user)
    fileDayEndReport(row, user)
    notifyCompleted(row, idx)
    return find('taskInstances', row.id) || row
  }
  return row
}

// How far an assignee may push their OWN task: only within the completion
// window the template already granted them (an "N days to complete" task), and
// never a mandatory one — that would let anyone lift their own logout gate.
export function selfDeferLimit(inst) {
  if (inst.isBlocking) return null
  // dueType is snapshotted on new rows; fall back to the template for older ones
  const dueType = inst.dueType || find('tasks', inst.taskId)?.dueType
  if (dueType !== 'n_days') return null
  return localDate(inst.tz || 'Asia/Kolkata', inst.dueAt)      // last day of the granted window
}

// Deferring moves the deadline (and, for blocking tasks, lifts today's logout
// gate). A manager may defer anyone below them to any later date; an assignee
// may only shuffle their own within the window above. Always needs a reason.
export function deferInstance(user, inst, { to, reason }) {
  const idx = buildOrgIndex()
  const manages = canManageInstance(user, inst, idx)
  const limit = isAssignee(user, inst) ? selfDeferLimit(inst) : null

  if (!manages && !limit) {
    fail(403, 'not_in_downline', inst.isBlocking
      ? 'A mandatory task can only be deferred by someone above you'
      : 'Only someone above the assignee can defer this')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to || '')) fail(422, 'invalid_date', 'Pick a date to defer to (YYYY-MM-DD)')
  if (to <= inst.serviceDate) fail(422, 'invalid_date', 'Defer to a later date than the current one')
  if (!manages && to > limit) {
    fail(422, 'outside_window', `You can move this within your completion window, up to ${limit}`)
  }
  if (!reason) fail(422, 'reason_required', 'A reason is required when deferring a task')
  assertStatus(inst, OPEN_STATUSES)

  const row = update('taskInstances', inst.id, {
    status: 'deferred',
    deferredTo: to,
    deferredByPositionId: primaryPosition(user, idx)?.id || null,
    deferReason: reason,
    // the new date's shift end, not 23:59 — otherwise deferring silently
    // undoes "end of their working day"
    dueAt: shiftEndsAt(idx.positionById.get(inst.assigneePositionId), idx.nodeById.get(inst.assigneeNodeId), inst.tz, to),
    overdueAt: null,
  }, user.id)
  notifyUsers([inst.assigneeUserId], {
    title: 'Task deferred',
    body: `${user.name} moved “${inst.title}” to ${to} — ${reason}`,
    type: 'task', refType: 'taskInstance', refId: inst.id,
  })
  return row
}

export function cancelInstance(user, inst, { reason = null } = {}) {
  const idx = buildOrgIndex()
  if (!canManageInstance(user, inst, idx)) fail(403, 'not_in_downline', 'Only someone above the assignee can cancel this')
  if (TERMINAL_STATUSES.includes(inst.status)) fail(409, 'bad_transition', 'That task is already finished')
  const row = update('taskInstances', inst.id, { status: 'cancelled', cancelReason: reason }, user.id)
  notifyUsers([inst.assigneeUserId], {
    title: 'Task cancelled',
    body: `${user.name} cancelled “${inst.title}”${reason ? ` — ${reason}` : ''}`,
    type: 'task', refType: 'taskInstance', refId: inst.id,
  })
  return row
}

// Hand an occurrence to someone else in the actor's downline. The original row
// is closed (never deleted) and a fresh one is opened for the new assignee, so
// the deterministic id of the old pairing stays claimed and generation cannot
// resurrect it.
export function reassignInstance(user, inst, { toPositionId, reason = null }) {
  const idx = buildOrgIndex()
  if (!canManageInstance(user, inst, idx)) fail(403, 'not_in_downline', 'Only someone above the assignee can reassign this')
  if (TERMINAL_STATUSES.includes(inst.status)) fail(409, 'bad_transition', 'That task is already finished')

  const target = idx.positionById.get(toPositionId)
  if (!target) fail(422, 'unknown_position', 'Unknown position')
  const mine = positionsOfUser(user, idx)
  if (!mine.some((m) => canManagePosition(m, target, idx))) fail(403, 'not_in_downline', 'That person is not in your downline')
  if (target.id === inst.assigneePositionId) fail(422, 'same_assignee', 'That task is already theirs')

  const described = describePosition(target, idx)
  cancelInstanceInternal(user, inst, `Reassigned to ${described.userName}${reason ? ` — ${reason}` : ''}`)

  const newId = instanceId(inst.taskId, target.id, inst.occurrenceKey)
  const existing = find('taskInstances', newId)
  const payload = {
    assigneePositionId: target.id,
    assigneeUserId: target.userId,
    assigneeNodeId: target.nodeId,
    assigneeName: described.userName,
    status: 'assigned',
    startedAt: null, submittedAt: null, decidedAt: null, completedAt: null, overdueAt: null,
    submissionRound: 1, rejectionCount: 0, lastComment: null, attachmentIds: [],
    cancelReason: null, deferredTo: null, deferReason: null, deferredByPositionId: null,
    reassignedFromInstanceId: inst.id,
  }
  const row = existing
    ? update('taskInstances', newId, payload, user.id)
    : insert('taskInstances', { ...inst, ...payload, id: newId, createdAt: undefined, createdBy: undefined }, user.id)

  notifyUsers([target.userId], {
    title: 'Task assigned to you',
    body: `${user.name} assigned you “${inst.title}” (due ${inst.serviceDate})`,
    type: 'task', refType: 'taskInstance', refId: row.id,
  })
  return row
}

function cancelInstanceInternal(user, inst, reason) {
  return update('taskInstances', inst.id, { status: 'cancelled', cancelReason: reason }, user.id)
}
