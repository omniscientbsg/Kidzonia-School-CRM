// On-complete actions: side effects a task fires when it finishes.
//
// IDEMPOTENCY IS THE WHOLE PROBLEM HERE. A task can reach "finished" more than
// once in a life — submit, bounced by the approver, resubmit, approve — and an
// action that talks to parents must not fire twice for one day's work. So every
// run is claimed in `taskActionRuns` under a key of (instance, module, action)
// BEFORE the side effect happens; a second attempt finds the claim and skips.
// The key deliberately excludes the submission round, because a second round is
// the same day's lunch, not a second lunch.
//
// Actions are fired only on TERMINAL completion — never on submit-for-approval.
// Telling parents their child was fed, and then having the approver send the
// task back, would be unfixable.
import { list, insert, update } from '../db.js'
import { runAction, getAction, CapabilityError } from '../capabilities/index.js'
import { buildContext } from '../capabilities/context.js'
import { answerValue, QID } from './conditions.js'

const stamp = () => new Date().toISOString()

export const actionKeyOf = (hook) => `${hook.moduleKey}.${hook.actionKey}`

export function previousRun(instanceId, hook) {
  return list('taskActionRuns', (r) => r.instanceId === instanceId && r.key === actionKeyOf(hook))[0] || null
}

// Does this completion match the condition the author attached to the action?
//
// `when` names the QUESTION as well as the answer. With answers keyed by
// question id, matching on the answer alone silently stopped matching — and
// this is the gate that stops parents being told "your child was fed" after
// an explicit No.
const answeredForHook = (inst, hook) => answerValue(inst, hook.when?.questionId || QID.answer)

export function actionApplies(inst, hook) {
  if (!hook.when) return true
  if (hook.when.answer != null) return (answeredForHook(inst, hook) || null) === hook.when.answer
  return true
}

// Fire everything this occurrence declared. Returns one result row per action,
// including the ones deliberately skipped — "we did not tell the parents,
// because she answered No" is an answer worth keeping.
export function runCompletionActions(inst, user = null) {
  const hooks = inst.onComplete?.actions || []
  if (!hooks.length) return []

  const results = []
  for (const hook of hooks) {
    const key = actionKeyOf(hook)

    const already = previousRun(inst.id, hook)
    if (already) {
      results.push({ key, status: 'skipped', reason: 'already_run', runId: already.id })
      continue
    }

    if (!actionApplies(inst, hook)) {
      // recorded, not silent: this is the audit answer to "why weren't parents told?"
      const row = insert('taskActionRuns', {
        instanceId: inst.id, taskId: inst.taskId, key,
        moduleKey: hook.moduleKey, actionKey: hook.actionKey,
        status: 'skipped', reason: 'answer_did_not_match',
        expectedAnswer: hook.when?.answer || null,
        actualAnswer: answeredForHook(inst, hook) || null,
        recipients: [], ranAt: stamp(), byUserId: user?.id || null,
      }, user?.id || null)
      results.push({ key, status: 'skipped', reason: 'answer_did_not_match', runId: row.id })
      continue
    }

    // CLAIM FIRST. Two concurrent approvals both reading "no previous run"
    // would otherwise both notify; the claim is written before the side effect
    // so the loser finds it.
    const claim = insert('taskActionRuns', {
      instanceId: inst.id, taskId: inst.taskId, key,
      moduleKey: hook.moduleKey, actionKey: hook.actionKey,
      status: 'running', reason: null,
      expectedAnswer: hook.when?.answer || null,
      actualAnswer: answeredForHook(inst, hook) || null,
      recipients: [], ranAt: stamp(), byUserId: user?.id || null,
    }, user?.id || null)

    let outcome
    try {
      outcome = runAction(hook.moduleKey, hook.actionKey, hook.paramBinding, {
        ...buildContext(inst),
        instanceId: inst.id,
        actorUserId: user?.id || null,
        // whatever the assigner configured for this task — the message parents
        // get, for one. The action never invents content of its own.
        config: hook.config || {},
      })
    } catch (err) {
      const failed = update('taskActionRuns', claim.id, {
        status: 'failed',
        reason: err instanceof CapabilityError ? err.code : 'error',
        message: err.message,
      }, user?.id || null)
      auditAction(inst, hook, failed, user)
      results.push({ key, status: 'failed', message: err.message, runId: claim.id })
      // `block` means a failed side effect should stop the completion; nothing
      // declares it yet, and warn is the safe default — the work IS done, and
      // failing to message parents must not un-do that
      if (hook.onFailure === 'block') throw err
      continue
    }

    const row = update('taskActionRuns', claim.id, {
      status: outcome?.ok === false ? 'noop' : 'sent',
      reason: outcome?.reason || null,
      recipients: outcome?.recipients || [],
      studentIds: outcome?.studentIds || [],
      notifications: outcome?.notifications ?? null,
      message: outcome?.summary || null,
    }, user?.id || null)

    auditAction(inst, hook, row, user)
    results.push({ key, status: row.status, recipients: row.recipients, summary: row.message, runId: row.id })
  }

  if (results.length) {
    update('taskInstances', inst.id, { actionResults: results }, user?.id || null)
  }
  return results
}

// The action and WHO it reached, in the immutable trail.
function auditAction(inst, hook, row, user) {
  insert('auditLog', {
    branchId: inst.branchId || null,
    userId: user?.id || null,
    action: 'instance.action',
    collection: 'taskInstances',
    recordId: inst.id,
    before: null,
    after: {
      key: actionKeyOf(hook),
      status: row.status,
      recipients: row.recipients || [],
      studentIds: row.studentIds || [],
      notifications: row.notifications ?? null,
      expectedAnswer: row.expectedAnswer || null,
      actualAnswer: row.actualAnswer || null,
      runId: row.id,
    },
    reason: row.message || row.reason || null,
  })
}

// Small helper for the UI / tests: what a template will do when it finishes.
export function describeActions(hooks = []) {
  return hooks.map((h) => {
    const found = getAction(h.moduleKey, h.actionKey)
    const label = found?.label || `${h.moduleKey}.${h.actionKey}`
    return h.when?.answer ? `${label} — only when the answer is “${h.when.answer}”` : label
  })
}
