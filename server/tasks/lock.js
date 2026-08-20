// Record locks: keeping verified work verified.
//
// When a module-linked task completes, the state that satisfied it can still be
// edited afterwards — a register marked, the task ticked, then two children
// quietly switched to absent. A lock says: that record is now evidence, and
// changing it needs someone senior to agree.
//
// THE SHAPE OF THE COUPLING
//   * the owning module calls capabilities/taskLock.check() and nothing else
//   * this file registers itself as that provider
//   * what gets locked comes from the guard's own paramBinding, resolved with
//     the same machinery signals and actions use — the engine has no idea what
//     a section is
//
// AFTER AN AUTHORISED EDIT the task is re-verified through the push event the
// module already emits. If the edit invalidated the evidence the task is
// FLAGGED, never silently left looking complete.
import { list, find, insert, update } from '../db.js'
import { getGuard, getModule, resolveBinding } from '../capabilities/index.js'
import { registerLockProvider, refKey, refMatches } from '../capabilities/taskLock.js'
import { buildContext } from '../capabilities/context.js'
import { buildOrgIndex, canManagePosition, positionsOfUser, primaryPosition, approverPositionsFor } from '../org/tree.js'
import { dispatchTask } from './notify.js'

const stamp = () => new Date().toISOString()

// How long an approved re-edit stays usable. Bounded on BOTH axes: one edit, and
// one hour — an approval granted this morning must not sit open all term.
export const GRANT_MINUTES = 60
export const GRANT_MAX_EDITS = 1

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])

// ------------------------------------------------------------------ place ----
// Called when an occurrence reaches terminal completion.
export function placeLocks(inst, user = null) {
  const hooks = inst.lockOnComplete || []
  if (!hooks.length) return []

  const placed = []
  const ctx = buildContext(inst)
  for (const hook of hooks) {
    const guard = getGuard(hook.moduleKey, hook.guardKey)
    if (!guard) continue
    const { params } = resolveBinding(guard, hook.paramBinding, ctx)

    // a param may resolve to several values (a teacher with two registers), and
    // each one is its own record scope
    const spread = Object.entries(params).reduce((rows, [k, v]) => {
      const values = asArray(v)
      if (!values.length) return rows
      return rows.flatMap((row) => values.map((one) => ({ ...row, [k]: one })))
    }, [{}])

    for (const scope of spread) {
      const ref = { collection: guard.appliesTo.collection, ...scope }
      const key = refKey(ref)
      if (list('taskLocks', (l) => l.refKey === key && l.status === 'locked').length) continue
      const row = insert('taskLocks', {
        instanceId: inst.id,
        taskId: inst.taskId,
        moduleKey: hook.moduleKey,
        guardKey: hook.guardKey,
        collection: ref.collection,
        scope: ref,
        refKey: key,
        assigneeUserId: inst.assigneeUserId,
        assigneePositionId: inst.assigneePositionId,
        nodeId: inst.assigneeNodeId,
        branchId: inst.branchId || null,
        unlockBy: hook.unlockBy || 'ancestor_approval',
        status: 'locked',
        placedAt: stamp(),
        liftedAt: null,
      }, user?.id || null)

      insert('auditLog', {
        branchId: inst.branchId || null,
        userId: user?.id || null,
        action: 'lock.place',
        collection: 'taskLocks',
        recordId: row.id,
        before: null,
        after: { instanceId: inst.id, ref, moduleKey: hook.moduleKey, guardKey: hook.guardKey },
        reason: `Locked by “${inst.title}”`,
      })
      placed.push(row)
    }
  }
  return placed
}

export const activeLockFor = (moduleKey, ref) =>
  list('taskLocks', (l) => l.status === 'locked' && l.moduleKey === moduleKey && refMatches(l.scope, ref))[0] || null

// A grant this person may still spend on this lock.
export function usableGrant(lockId, userId, now = Date.now()) {
  return list('taskLockRequests', (r) =>
    r.lockId === lockId &&
    r.status === 'approved' &&
    r.byUserId === userId &&
    (r.edits || 0) < (r.maxEdits || GRANT_MAX_EDITS) &&
    Date.parse(r.expiresAt) > now)[0] || null
}

// ----------------------------------------------------------------- provider --
// The single question the owning module asks.
function providerCheck(moduleKey, ref, ctx = {}) {
  const lock = activeLockFor(moduleKey, ref)
  if (!lock) return { locked: false, grant: null }

  const userId = ctx.user?.id || null
  const grant = userId ? usableGrant(lock.id, userId) : null

  if (grant) {
    if (ctx.peek) return { locked: false, grant, lockId: lock.id, willSpendGrant: true }
    // spend it here: check() is the only call the module makes, so this is the
    // only place we can know an authorised edit is happening
    const spent = update('taskLockRequests', grant.id, {
      edits: (grant.edits || 0) + 1,
      usedAt: stamp(),
      status: (grant.edits || 0) + 1 >= (grant.maxEdits || GRANT_MAX_EDITS) ? 'used' : 'approved',
    }, userId)
    insert('auditLog', {
      branchId: lock.branchId,
      userId,
      action: 'lock.edit',
      collection: 'taskLocks',
      recordId: lock.id,
      before: null,
      after: { ref, requestId: grant.id, approvedByUserId: grant.decidedByUserId, editsUsed: spent.edits, maxEdits: spent.maxEdits },
      reason: grant.reason || null,
    })
    return { locked: false, grant: spent, lockId: lock.id, spentGrant: true }
  }

  const instance = find('taskInstances', lock.instanceId)
  const mod = getModule(moduleKey)
  const guard = getGuard(lock.moduleKey, lock.guardKey)
  const pending = userId
    ? list('taskLockRequests', (r) => r.lockId === lock.id && r.byUserId === userId && r.status === 'pending')[0] || null
    : null

  const message = pending
    ? `This is locked by the completed task “${instance?.title || 'a task'}”. Your request to edit it is waiting for ${pending.approverNames?.join(' or ') || 'someone above you'}.`
    : `${guard?.label || 'This record'} is locked: “${instance?.title || 'a task'}” was completed against it on ${instance?.serviceDate || 'an earlier date'}. Ask someone above you to approve a re-edit and it unlocks for one change.`

  return {
    locked: true,
    lockId: lock.id,
    grant: null,
    instanceId: lock.instanceId,
    taskTitle: instance?.title || null,
    canRequest: !pending,
    pendingRequestId: pending?.id || null,
    message,
    response: {
      error: 'record_locked',
      message,
      lockId: lock.id,
      instanceId: lock.instanceId,
      canRequest: !pending,
      pendingRequestId: pending?.id || null,
      requestPath: '/tasks/locks/' + lock.id + '/request',
      module: mod?.label || moduleKey,
    },
  }
}

// exported so a test can put the real provider back after swapping it out
export const lockProvider = providerCheck

let registered = false
export function registerLocks({ force = false } = {}) {
  if (registered && !force) return
  registerLockProvider(providerCheck)
  registered = true
}

// ---------------------------------------------------------------- requests ----
// Who may decide: authority over the PERSON whose work is locked, which is the
// same upward line that could have approved the task itself. Deliberately not
// "authority over the requester" — otherwise a principal asking to fix her own
// school's register could never be approved by anyone sensible, and the
// assignee could never be told no by the person who actually owns the outcome.
export function canDecideLock(user, lock, idx = buildOrgIndex()) {
  if (!user || !lock) return false
  if (user.id === lock.assigneeUserId) return false          // never sign off your own
  const target = idx.positionById.get(lock.assigneePositionId)
  if (!target) return false
  return positionsOfUser(user, idx).some((m) => canManagePosition(m, target, idx))
}

// Every position that could decide this — the whole upward line, not one
// manager who might be away. Same predicate the task approval uses.
export function approversFor(lock, idx = buildOrgIndex()) {
  const target = idx.positionById.get(lock.assigneePositionId)
  if (!target) return []
  return approverPositionsFor(target, idx).filter((p) => p.userId && p.userId !== lock.assigneeUserId)
}

export function requestReEdit(user, lock, { reason = null } = {}) {
  const idx = buildOrgIndex()
  const approvers = approversFor(lock, idx)
  const row = insert('taskLockRequests', {
    lockId: lock.id,
    instanceId: lock.instanceId,
    moduleKey: lock.moduleKey,
    refKey: lock.refKey,
    scope: lock.scope,
    byUserId: user.id,
    byPositionId: primaryPosition(user, idx)?.id || null,
    reason: reason || null,
    status: 'pending',
    approverUserIds: approvers.map((p) => p.userId),
    approverNames: approvers.map((p) => find('users', p.userId)?.name).filter(Boolean),
    decidedByUserId: null,
    decidedByPositionId: null,
    decidedAt: null,
    decisionComment: null,
    expiresAt: null,
    edits: 0,
    maxEdits: GRANT_MAX_EDITS,
    usedAt: null,
  }, user.id)

  const instance = find('taskInstances', lock.instanceId)
  if (approvers.length) {
    dispatchTask('lock_request', {
      userIds: approvers.map((p) => p.userId),
      title: `${user.name} wants to change locked records`,
      body: `${user.name} is asking to edit ${lock.collection} that “${instance?.title || 'a completed task'}” was verified against${reason ? `: ${reason}` : ''}. Approving unlocks one edit for the next hour.`,
      instance,
      meta: { refType: 'taskLockRequest', refId: row.id },
    })
  }
  return row
}

export function decideReEdit(user, request, decision, { comment = null } = {}) {
  const idx = buildOrgIndex()
  const lock = find('taskLocks', request.lockId)
  const now = new Date()
  const patch = {
    status: decision === 'approved' ? 'approved' : 'rejected',
    decidedByUserId: user.id,
    decidedByPositionId: primaryPosition(user, idx)?.id || null,
    decidedAt: now.toISOString(),
    decisionComment: comment,
    expiresAt: decision === 'approved' ? new Date(now.getTime() + GRANT_MINUTES * 60000).toISOString() : null,
  }
  const row = update('taskLockRequests', request.id, patch, user.id)

  const instance = find('taskInstances', request.instanceId)
  dispatchTask(decision === 'approved' ? 'lock_approved' : 'lock_rejected', {
    userIds: [request.byUserId],
    title: decision === 'approved' ? 'Re-edit approved' : 'Re-edit refused',
    body: decision === 'approved'
      ? `${user.name} approved one edit to the locked ${lock?.collection || 'records'}. It is open for the next ${GRANT_MINUTES} minutes${comment ? ` — ${comment}` : ''}.`
      : `${user.name} refused the re-edit${comment ? `: ${comment}` : ''}.`,
    instance,
    meta: { refType: 'taskLockRequest', refId: row.id },
  })
  return row
}

// Every lock covering a record that just moved. The RE-VERIFICATION that
// follows lives in verify.js — this file only knows which tasks staked a claim
// on the record, not how to judge them.
export const locksMatching = (moduleKey, ref) =>
  list('taskLocks', (l) => l.status === 'locked' && l.moduleKey === moduleKey && refMatches(l.scope, ref))

export function liftLock(lock, user, reason) {
  const row = update('taskLocks', lock.id, { status: 'lifted', liftedAt: stamp(), liftedReason: reason }, user?.id || null)
  insert('auditLog', {
    branchId: lock.branchId, userId: user?.id || null,
    action: 'lock.lift', collection: 'taskLocks', recordId: lock.id,
    before: { status: 'locked' }, after: { status: 'lifted' }, reason,
  })
  return row
}
