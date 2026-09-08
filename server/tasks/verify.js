// Module-linked verification: prefer push, guard with pull, store evidence.
//
// THREE LAYERS, and only one of them is trusted:
//   1. push   — the module emits (attendance.marked); we re-read the signal and
//               satisfy anything it unblocks. This is latency, not authority.
//   2. sweep  — syncTasks() re-reads open module-linked work, so a missed event,
//               a restart, or attendance marked BEFORE the task existed still
//               resolves without anybody doing anything.
//   3. pull   — submit re-reads the signal one last time and refuses if it is
//               false. Every path above can fail silently; this one cannot be
//               bypassed, which is what makes push safe to be best-effort.
//
// Every satisfied read writes a taskVerifications row: which records satisfied
// it, how many, a fingerprint of what was seen, and when. That row is the
// evidence, and it is mirrored into the audit log.
import { list, find, insert, update } from '../db.js'
import { readSignal, describeSignal, getSignal, CapabilityError, getModule, listModules } from '../capabilities/index.js'
import { on } from '../capabilities/bus.js'
import { buildContext, sectionsOfUser } from '../capabilities/context.js'
import { buildOrgIndex } from '../org/tree.js'
import { systemSpec } from './conditions.js'
import { locksMatching } from './lock.js'
import { dispatchTask } from './notify.js'
import { OPEN_STATUSES } from './model.js'
import { localToday, DEFAULT_TZ } from './time.js'

const stamp = () => new Date().toISOString()

// Kept under its old name: tasks.routes.js imports it. What it means now is
// "this occurrence has a system check" — true for mode 'system' AND for
// mode 'both', which is the widening the new shape is for.
export const isModuleLinked = (inst) => !!systemSpec(inst)

// Open module-linked occurrences, optionally narrowed to one module+signal.
function openLinked({ moduleKey = null, signalKey = null } = {}) {
  return list('taskInstances', (i) => {
    if (!OPEN_STATUSES.includes(i.status)) return false
    const ml = systemSpec(i)
    if (!ml) return false
    if (moduleKey && ml.moduleKey !== moduleKey) return false
    if (signalKey && ml.signalKey !== signalKey) return false
    return true
  })
}

// ------------------------------------------------------------------ evidence --
function recordVerification(inst, ml, result, source) {
  const row = insert('taskVerifications', {
    instanceId: inst.id,
    taskId: inst.taskId,
    round: inst.submissionRound || 1,
    moduleKey: ml.moduleKey,
    signalKey: ml.signalKey,
    satisfied: !!result.satisfied,
    evidence: result.evidence || null,
    message: result.message || null,
    source,                                   // 'push' | 'sweep' | 'pull'
    observedAt: stamp(),
    assigneeUserId: inst.assigneeUserId,
  }, null)

  // the evidence belongs in the immutable trail too, not only on the row that
  // can later be edited
  if (result.satisfied) {
    insert('auditLog', {
      branchId: inst.branchId || null,
      userId: null,
      action: 'instance.verified',
      collection: 'taskInstances',
      recordId: inst.id,
      before: null,
      after: {
        moduleKey: ml.moduleKey,
        signalKey: ml.signalKey,
        verificationId: row.id,
        recordIds: result.evidence?.recordIds || [],
        count: result.evidence?.count ?? null,
        checksum: result.evidence?.checksum || null,
        markedByUserId: result.evidence?.markedByUserId || null,
        markedAt: result.evidence?.markedAt || null,
        source,
      },
      reason: result.message || null,
    })
  }
  return row
}

// -------------------------------------------------------------------- read --
// One live read of an occurrence's bound signal. Never throws for the caller:
// an unreadable signal is reported as "cannot judge", which is a different
// answer from "no".
export function verifyInstance(inst, { source = 'pull', persist = true } = {}) {
  const ml = systemSpec(inst)
  if (!ml) return { satisfied: true, verifiable: true, message: null }

  const signal = getSignal(ml.moduleKey, ml.signalKey)
  const phrase = describeSignal(ml.moduleKey, ml.signalKey, ml.paramBinding) || 'the linked module signal'
  let result
  try {
    result = readSignal(ml.moduleKey, ml.signalKey, ml.paramBinding, buildContext(inst))
  } catch (err) {
    if (err instanceof CapabilityError) {
      // not_yet_verifiable / unbound_params / unknown_signal — we cannot judge
      // the CODE is stored, not just the message: "we cannot judge this" has to
      // survive the round-trip, or the UI shows it as a plain "not done"
      const patch = { conditionMet: false, conditionCode: err.code, conditionCheckedAt: stamp(), conditionMessage: err.message }
      if (persist) update('taskInstances', inst.id, patch, null)
      return { satisfied: false, verifiable: false, code: err.code, message: err.message, phrase }
    }
    throw err
  }

  const cta = getModule(ml.moduleKey)?.cta || null
  const message = result.satisfied
    ? result.message || `Verified: ${phrase}`
    : result.message || `Not done yet — this completes when ${phrase}.`

  let verification = null
  if (persist) {
    // only write a row when the answer changed or it is satisfied: a sweep that
    // finds nothing new every 15 minutes should not fill the table
    const previous = latestVerification(inst.id, inst.submissionRound || 1)
    const changed = !previous || previous.satisfied !== !!result.satisfied
    if (result.satisfied || changed) verification = recordVerification(inst, ml, result, source)
    update('taskInstances', inst.id, {
      conditionMet: !!result.satisfied,
      conditionCode: result.satisfied ? null : 'module_not_done',
      conditionMetAt: result.satisfied ? (inst.conditionMet ? inst.conditionMetAt : stamp()) : null,
      conditionCheckedAt: stamp(),
      conditionMessage: message,
      verificationId: verification?.id || (result.satisfied ? previous?.id : null) || null,
    }, null)
  }

  return {
    satisfied: !!result.satisfied,
    verifiable: signal?.implemented !== false,
    message,
    phrase,
    cta,
    evidence: result.evidence || null,
    verificationId: verification?.id || null,
  }
}

export function latestVerification(instanceId, round = null) {
  const rows = list('taskVerifications', (v) => v.instanceId === instanceId && (round == null || v.round === round))
  return rows.sort((a, b) => (a.observedAt || '').localeCompare(b.observedAt || ''))[rows.length - 1] || null
}

// ---------------------------------------------------------------- recheck ----
// A completed task whose evidence has just been edited. We re-read the signal;
// if it no longer holds, the task is FLAGGED — never left quietly looking
// complete, and never silently reopened either, because the edit was authorised
// by someone senior and re-trapping the assignee for it would be wrong.
export function recheckCompleted(moduleKey, ref, { authorised = false } = {}) {
  const flagged = []
  for (const lock of locksMatching(moduleKey, ref)) {
    const inst = find('taskInstances', lock.instanceId)
    const ml = inst ? systemSpec(inst) : null
    if (!ml) continue
    const result = verifyInstance(inst, { source: 'recheck', persist: false })

    const was = inst.completionEvidence?.checksum || null
    const now = result.evidence?.checksum || null
    const moved = !!was && !!now && was !== now

    recordVerification(inst, ml, { satisfied: result.satisfied, evidence: result.evidence, message: result.message }, 'recheck')

    // WHAT COUNTS AS INVALIDATED
    //   * the signal no longer holds            -> always a flag
    //   * the evidence moved with nobody's leave -> a flag; that is exactly the
    //     silent drift the checksum exists to catch
    //   * the evidence moved under an approved re-edit -> NOT a flag. Somebody
    //     with authority looked at it and said yes; flagging every authorised
    //     correction would make the flag mean nothing.
    const broken = !result.satisfied || (moved && !authorised)

    if (!broken) {
      const patch = {}
      if (inst.verificationBroken) Object.assign(patch, { verificationBroken: false, verificationBrokenAt: null, verificationBrokenReason: null })
      if (moved) {
        // not a problem, but not nothing either: the record of what we accepted
        // stays frozen, and we note that it was revised with permission
        Object.assign(patch, { evidenceRevisedAt: stamp(), evidenceRevisedChecksum: now })
        insert('auditLog', {
          branchId: inst.branchId || null,
          userId: null,
          action: 'instance.evidence_revised',
          collection: 'taskInstances',
          recordId: inst.id,
          before: { checksum: was },
          after: { checksum: now, ref, authorised: true },
          reason: 'Records changed under an approved re-edit; the task still verifies.',
        })
      }
      if (Object.keys(patch).length) update('taskInstances', inst.id, patch, null)
      continue
    }

    const reason = result.satisfied
      ? 'The records were edited after this task was verified against them, without an approved re-edit.'
      : result.message || 'The records no longer satisfy this task.'
    const row = update('taskInstances', inst.id, {
      verificationBroken: true,
      verificationBrokenAt: stamp(),
      verificationBrokenReason: reason,
      verificationBrokenChecksum: now,
    }, null)

    insert('auditLog', {
      branchId: inst.branchId || null,
      userId: null,
      action: 'instance.verification_broken',
      collection: 'taskInstances',
      recordId: inst.id,
      before: { checksum: was, satisfied: true },
      after: { checksum: now, satisfied: result.satisfied, ref, authorised },
      reason,
    })

    // whoever owns the outcome hears about it: the approver line and the
    // assigner, not just the person whose register moved
    const idx = buildOrgIndex()
    const approver = idx.positionById.get(inst.approverPositionId)
    dispatchTask('verification_broken', {
      userIds: [approver?.userId, inst.assignedByUserId, inst.assigneeUserId],
      title: 'A completed task no longer matches its records',
      body: `“${inst.title}” (${inst.serviceDate}) was verified against ${lock.collection} that have since been edited. ${reason}`,
      instance: row,
    })
    flagged.push(row)
  }
  return flagged
}

// -------------------------------------------------------------------- push --
// Called when a module says something happened. The event tells us WHERE to
// look; the signal still decides whether the condition holds.
export function onModuleEvent(moduleKey, signalKey, payload = {}) {
  const touched = []
  const sectionId = payload.sectionId || null

  // an edit to already-verified records is the other half of this: completed
  // work is re-read and flagged if the change invalidated it
  if (payload.ref) recheckCompleted(moduleKey, payload.ref, { authorised: !!payload.authorised })
  for (const inst of openLinked({ moduleKey, signalKey })) {
    // cheap pre-filter so marking one register does not re-read every open task
    if (sectionId && !sectionsOfUser(inst.assigneeUserId).includes(sectionId)) continue
    if (payload.date && inst.serviceDate !== payload.date) {
      // the date may be bound to something other than the service date, so only
      // skip when we know it is the service date it is bound to
      const bound = systemSpec(inst)?.paramBinding?.date?.source
      if (!bound || bound === 'instance.serviceDate') continue
    }
    const before = !!inst.conditionMet
    const result = verifyInstance(inst, { source: 'push' })
    if (result.satisfied && !before) touched.push({ instanceId: inst.id, verificationId: result.verificationId })
  }
  return touched
}

// ------------------------------------------------------------------- sweep --
// Catch-up for everything push cannot cover: a missed event, a restarted
// process, or attendance that was marked before the task was even generated.
export function sweepModuleLinked() {
  const checked = []
  for (const inst of openLinked()) {
    if (inst.conditionMet) continue
    // Only work whose day has arrived — no point reading tomorrow's register.
    // serviceDate is a LOCAL date, so it has to be compared against today in the
    // same zone: `toISOString()` is UTC, and between 00:00 and 05:30 IST that is
    // still yesterday, which skipped every one of today's occurrences.
    if (inst.serviceDate > localToday(inst.tz || DEFAULT_TZ)) continue
    const result = verifyInstance(inst, { source: 'sweep' })
    if (result.satisfied) checked.push(inst.id)
  }
  return checked
}

// --------------------------------------------------------------- subscribe --
let subscribed = false

export function subscribeVerification() {
  if (subscribed) return []
  // Every signal that declares a push topic is wired automatically. A module
  // that ships an event needs no change here — the subscription is read off
  // the descriptor, same as everything else.
  const wired = []
  for (const mod of listModules()) {
    for (const [signalKey, sig] of Object.entries(mod.signals || {})) {
      if (!sig.event) continue
      on(sig.event, (payload) => onModuleEvent(mod.key, signalKey, payload))
      wired.push(sig.event)
    }
  }
  subscribed = true
  return wired
}
