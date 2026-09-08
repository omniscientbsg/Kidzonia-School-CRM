// Approval escalation.
//
// A submitted task sits with one approver. If they do nothing, the work stalls
// and the person who did it has no way to move it — so an escalation policy
// walks the approval UP the ancestor chain on a clock.
//
// THE RULE THAT SHAPES EVERYTHING ELSE: a slow chain is the approver's problem,
// never the junior's. `submitted` is not an open status, so the logout gate is
// already clear the moment they submit, and nothing in here ever writes an open
// status back onto an occurrence. There is a test for exactly that.
//
// Escalation cannot leave the ancestor chain: every resolver picks from
// approverPositionsFor(), which is canManage() and nothing else.
//
// TIMING: there is no real cron. sweepEscalations() rides syncTasks(), which
// runs on the in-process scheduler AND lazily on every task read/login. A missed
// run escalates late, never twice — the stage number plus stageEnteredAt is a
// compare-and-set. TODO: move to a real scheduler in production; the lazy path
// should stay as the fallback.
import { list, find, insert, update } from '../db.js'
import {
  buildOrgIndex, approverPositionsFor, describePosition, canManagePosition,
} from '../org/tree.js'
import { dispatchTask, notifySettings } from './notify.js'
import { localDate, localToday, addDays, DEFAULT_TZ, weekdayOf, localDayStart } from './time.js'
import { LEGACY_PRIORITY_IDS } from './priorities.js'

const stamp = () => new Date().toISOString()

export const RESOLVERS = ['named', 'next_ancestor', 'tier', 'node_admin']
export const FINAL_BEHAVIOURS = ['notify_only', 'raise_task', 'auto_approve']

// ------------------------------------------------------------------ policy --
export function normalizePolicy(body = {}, { existing = null } = {}) {
  const errors = []
  const src = { ...existing, ...body }
  const name = String(src.name || '').trim()
  if (!name) errors.push('name is required')

  const stages = (Array.isArray(src.stages) ? src.stages : []).map((s, i) => {
    const resolver = RESOLVERS.includes(s.resolver) ? s.resolver : 'next_ancestor'
    const slaMinutes = Number(s.slaMinutes)
    if (!Number.isInteger(slaMinutes) || slaMinutes < 1) errors.push(`stage ${i + 1} needs a whole number of SLA minutes`)
    if (resolver === 'tier' && !s.levelId) errors.push(`stage ${i + 1} names a tier but no level`)
    return {
      seq: i + 1,
      resolver,
      levelId: resolver === 'tier' ? s.levelId : null,
      slaMinutes: Number.isInteger(slaMinutes) && slaMinutes > 0 ? slaMinutes : 60,
      label: String(s.label || '').trim() || null,
    }
  })
  if (!stages.length) errors.push('a policy needs at least one stage')

  const onFinalBreach = FINAL_BEHAVIOURS.includes(src.onFinalBreach) ? src.onFinalBreach : 'notify_only'

  return {
    policy: {
      name,
      description: String(src.description || '').trim(),
      nodeId: src.nodeId || null,
      stages,
      // Deliberately NOT the default. An approval nobody made destroys the
      // meaning of every approval in the audit log; it is available per policy
      // for a school that genuinely wants it.
      onFinalBreach,
      skipNonWorkingDays: src.skipNonWorkingDays !== false,
      active: src.active !== false,
    },
    errors,
  }
}

// task -> category -> nothing. First one that names a policy wins.
export function policyFor(inst) {
  const task = find('tasks', inst.taskId)
  const direct = inst.escalationPolicyId || task?.escalationPolicyId
  if (direct) return find('escalationPolicies', direct) || null
  const categoryId = task?.categoryId
  if (!categoryId) return null
  const cat = find('taskCategories', categoryId)
  return cat?.escalationPolicyId ? find('escalationPolicies', cat.escalationPolicyId) || null : null
}

// ------------------------------------------------------------------ timing --
// SLA is elapsed minutes, but a deadline that lands on a day the school is shut
// is pushed to the start of the next working day. Counting a Sunday against a
// principal's response time would make every Monday morning look like a breach.
export function slaDeadline(fromIso, minutes, { tz = DEFAULT_TZ, workWeek = null, holidays = null } = {}) {
  const raw = new Date(Date.parse(fromIso) + minutes * 60000)
  if (!workWeek && !holidays) return raw.toISOString()
  const working = (dateStr) => {
    if (holidays?.has?.(dateStr)) return false
    if (!workWeek?.length) return true
    return workWeek.includes(weekdayOf(dateStr))
  }
  let day = localDate(tz, raw)
  if (working(day)) return raw.toISOString()
  let guard = 0
  while (!working(day) && guard++ < 14) day = addDays(day, 1)
  return localDayStart(tz, day)
}

// ---------------------------------------------------------------- resolvers --
// Nearest first. Every entry is someone who canManage the assignee, so no
// resolver can reach outside the chain.
export function ancestorChain(inst, idx = buildOrgIndex()) {
  const target = idx.positionById.get(inst.assigneePositionId)
  if (!target) return []
  return approverPositionsFor(target, idx)
    .filter((p) => p.userId && p.userId !== inst.assigneeUserId)
    .sort((a, b) => b.depth - a.depth || a.rank - b.rank)
}

export function resolveStage(stage, inst, idx = buildOrgIndex(), currentPositionId = null) {
  const chain = ancestorChain(inst, idx)
  if (!chain.length) return null

  if (stage.resolver === 'named') {
    return idx.positionById.get(inst.approverPositionId) || chain[0]
  }
  if (stage.resolver === 'tier') {
    return chain.find((p) => p.levelId === stage.levelId) || null
  }
  if (stage.resolver === 'node_admin') {
    // the top of the chain: shallowest node, and among equals the one with the
    // most authority there. Taking the last of a nearest-first list would pick
    // whoever happens to sort last at HQ, not the person who actually runs it.
    return [...chain].sort((a, b) => a.depth - b.depth || a.rank - b.rank)[0] || null
  }
  // next_ancestor: strictly above whoever holds it now
  const current = idx.positionById.get(currentPositionId || inst.approverPositionId)
  if (!current) return chain[0]
  const above = chain.filter((p) => p.id !== current.id && canManagePosition(p, current, idx))
  return above[0] || null
}

// ------------------------------------------------------------------- start --
// Called when an occurrence is submitted for approval.
export function startEscalation(inst, idx = buildOrgIndex()) {
  const policy = policyFor(inst)
  if (!policy || !policy.active || !policy.stages.length) return null

  const node = idx.nodeById.get(inst.assigneeNodeId)
  const stage = policy.stages[0]
  const holder = resolveStage(stage, inst, idx, inst.approverPositionId) || idx.positionById.get(inst.approverPositionId)
  if (!holder) return null

  const escalation = {
    policyId: policy.id,
    policyName: policy.name,
    stage: 1,
    stageCount: policy.stages.length,
    resolver: stage.resolver,
    currentApproverPositionId: holder.id,
    originalApproverPositionId: inst.approverPositionId,
    stageEnteredAt: stamp(),
    // the SLA is the APPROVER's clock, not the assignee's — it measures how long
    // THEY had to decide, so it is their working week that counts
    dueBy: slaDeadline(inst.submittedAt || stamp(), stage.slaMinutes, {
      tz: inst.tz || node?.timezone || DEFAULT_TZ,
      workWeek: policy.skipNonWorkingDays
        ? (holder.workWeek ?? idx.nodeById.get(holder.nodeId)?.settings?.workWeek)
        : null,
      holidays: null,
    }),
    exhausted: false,
    history: [],
  }
  update('taskInstances', inst.id, { escalation, approverPositionId: holder.id }, null)
  return escalation
}

export function clearEscalation(inst, reason) {
  if (!inst.escalation) return null
  const done = { ...inst.escalation, closedAt: stamp(), closedReason: reason }
  return update('taskInstances', inst.id, {
    escalation: done,
    // hand the approval back to whoever the template named, so the next round
    // starts from the top of the ladder rather than where the last one ended
    approverPositionId: inst.escalation.originalApproverPositionId || inst.approverPositionId,
  }, null)
}

// ------------------------------------------------------------------- sweep --
export function sweepEscalations(now = Date.now(), idx = buildOrgIndex()) {
  const moved = []
  for (const inst of list('taskInstances', (i) => i.status === 'submitted' && i.escalation && !i.escalation.exhausted)) {
    let current = inst
    let guard = 0
    // catch up in one pass: a process that was down for a day should land on the
    // stage it would have reached, not one stage per sweep
    while (guard++ < 10) {
      const esc = current.escalation
      if (!esc || esc.exhausted || !esc.dueBy || Date.parse(esc.dueBy) > now) break
      const next = advance(current, idx, now)
      if (!next) break
      moved.push(next)
      current = find('taskInstances', current.id)
    }
  }
  return moved
}

function advance(inst, idx, now) {
  const policy = find('escalationPolicies', inst.escalation.policyId)
  if (!policy) return null
  const esc = inst.escalation
  const from = idx.positionById.get(esc.currentApproverPositionId)
  const nextStage = policy.stages[esc.stage]           // stages are 1-indexed by seq
  const node = idx.nodeById.get(inst.assigneeNodeId)

  // no stage left, or nobody above: the top of the chain
  const holder = nextStage ? resolveStage(nextStage, inst, idx, esc.currentApproverPositionId) : null
  if (!nextStage || !holder) return terminal(inst, policy, idx, now)

  const entry = {
    at: new Date(now).toISOString(),
    fromStage: esc.stage,
    toStage: esc.stage + 1,
    fromPositionId: from?.id || null,
    fromName: from ? describePosition(from, idx).userName : null,
    toPositionId: holder.id,
    toName: describePosition(holder, idx).userName,
    resolver: nextStage.resolver,
    breachedAt: esc.dueBy,
  }
  const escalation = {
    ...esc,
    stage: esc.stage + 1,
    resolver: nextStage.resolver,
    currentApproverPositionId: holder.id,
    stageEnteredAt: new Date(now).toISOString(),
    dueBy: slaDeadline(new Date(now).toISOString(), nextStage.slaMinutes, {
      tz: inst.tz || node?.timezone || DEFAULT_TZ,
      workWeek: policy.skipNonWorkingDays
        ? (holder.workWeek ?? idx.nodeById.get(holder.nodeId)?.settings?.workWeek)
        : null,
      holidays: null,
    }),
    history: [...(esc.history || []), entry],
  }

  // the approval itself moves, so the inbox, the permission check and the
  // dashboards all follow without knowing escalation exists
  const row = update('taskInstances', inst.id, { escalation, approverPositionId: holder.id }, null)
  auditEscalation(inst, entry, 'approval.escalated')
  notifyEscalation(row, entry, idx, node)
  return row
}

function terminal(inst, policy, idx, now) {
  const esc = inst.escalation
  const entry = {
    at: new Date(now).toISOString(),
    fromStage: esc.stage,
    toStage: esc.stage,
    terminal: true,
    behaviour: policy.onFinalBreach,
    breachedAt: esc.dueBy,
    fromPositionId: esc.currentApproverPositionId,
  }
  const escalation = { ...esc, exhausted: true, exhaustedAt: new Date(now).toISOString(), history: [...(esc.history || []), entry] }
  const row = update('taskInstances', inst.id, { escalation }, null)
  auditEscalation(inst, entry, 'approval.escalation_exhausted')

  const holder = idx.positionById.get(esc.currentApproverPositionId)
  const node = idx.nodeById.get(inst.assigneeNodeId)

  if (policy.onFinalBreach === 'auto_approve') {
    // opt-in only, and it is recorded as a decision nobody made
    insert('taskApprovals', {
      instanceId: inst.id,
      round: inst.submissionRound,
      decision: 'approved',
      approverUserId: null,
      approverPositionId: null,
      comment: `Auto-approved: no decision within the ${policy.name} policy`,
      viaOverride: true,
      viaEscalationTimeout: true,
      submittedAt: inst.submittedAt,
      decidedAt: new Date(now).toISOString(),
    }, null)
    const done = update('taskInstances', inst.id, {
      status: 'approved', decidedAt: new Date(now).toISOString(), completedAt: new Date(now).toISOString(),
    }, null)
    auditEscalation(inst, { ...entry, autoApproved: true }, 'approval.auto_approved')
    return done
  }

  dispatchTask('sla_breach', {
    userIds: [holder?.userId, inst.assignedByUserId].filter(Boolean),
    title: 'Approval overdue at the top of the chain',
    body: `“${inst.title}” (${inst.assigneeName}, ${inst.serviceDate}) has run out of escalation stages and is still waiting on a decision.`,
    instance: row,
    settings: notifySettings(node),
  })

  if (policy.onFinalBreach === 'raise_task' && holder) {
    raiseBreachTask(row, holder, policy)
  }
  return row
}

// Inaction with teeth: the breaching approver gets a MANDATORY task of their
// own. It is module-linked to the task engine's own signal, so deciding the
// original approval clears it — nobody has to remember to close it.
//
// Guards against the obvious failure mode: an SLA task never carries a policy of
// its own (no recursion), and it is releasable through the existing gate valves.
export function raiseBreachTask(inst, holder, policy) {
  const systemKey = `approval_sla_breach:${inst.id}`
  if (list('tasks', (t) => t.systemKey === systemKey).length) return null

  const task = insert('tasks', {
    title: `Overdue approval: ${inst.title}`,
    description: `${inst.assigneeName} submitted this on ${inst.serviceDate} and it has been waiting past every stage of the ${policy.name} policy. Approve or send it back.`,
    origin: 'automated',
    systemKey,
    // one named person, frozen: this chases a specific approver, not a role
    target: {
      kind: 'position', positionIds: [holder.id], userIds: [], nodeIds: [],
      levelIds: [], levelId: null, excludePositionIds: [],
      includeSubtree: false, followJoiners: false,
    },
    priority: LEGACY_PRIORITY_IDS.urgent,
    categoryId: null,
    dueType: 'end_of_day',
    dueConfig: { startDate: null, dueDate: null, days: null },
    recurrence: { freq: 'none', byWeekday: [], dayOfMonth: null, interval: 1, startDate: localToday(inst.tz || DEFAULT_TZ), endDate: null, count: null, skipNonWorkingDays: false },
    requiresApproval: false,
    approverPositionId: null,
    requiresMedia: false,
    mediaTypes: [],
    minAttachments: 0,
    isBlocking: true,
    status: 'active',
    academicYearId: inst.academicYearId || null,
    completionCondition: {
      mode: 'system',
      questions: [],
      system: {
        moduleKey: 'tasks',
        signalKey: 'approvalCleared',
        paramBinding: { instanceId: { source: 'literal', value: inst.id } },
        derivedMcq: { question: 'Decided?', readOnly: true },
        autoSubmit: true,
      },
      statement: null,
      proof: { required: false, types: null, min: null },
      derivedFrom: null,
    },
    onComplete: { actions: [] },
    lockOnComplete: [],
    escalationPolicyId: null,                 // never escalate an escalation
    createdByUserId: inst.assignedByUserId || null,
    createdByPositionId: null,
    createdAtNodeId: inst.assigneeNodeId,
    lastGeneratedThrough: null,
  }, null)

  insert('auditLog', {
    branchId: inst.branchId || null,
    userId: null,
    action: 'approval.sla_task_raised',
    collection: 'tasks',
    recordId: task.id,
    before: null,
    after: { instanceId: inst.id, approverPositionId: holder.id, approverUserId: holder.userId, policyId: policy.id },
    reason: `No decision within the ${policy.name} policy`,
  })
  return task
}

// ------------------------------------------------------------------- audit --
function auditEscalation(inst, entry, action) {
  insert('auditLog', {
    branchId: inst.branchId || null,
    userId: null,
    action,
    collection: 'taskInstances',
    recordId: inst.id,
    before: { stage: entry.fromStage, positionId: entry.fromPositionId },
    after: { stage: entry.toStage, positionId: entry.toPositionId || entry.fromPositionId, resolver: entry.resolver || null, terminal: !!entry.terminal, behaviour: entry.behaviour || null },
    reason: `SLA breached at ${entry.breachedAt}`,
  })
}

function notifyEscalation(inst, entry, idx, node) {
  const settings = notifySettings(node)
  const holder = idx.positionById.get(entry.toPositionId)
  if (holder?.userId) {
    dispatchTask('escalated', {
      userIds: [holder.userId],
      title: 'An approval has escalated to you',
      body: `${entry.fromName || 'Someone below you'} did not decide “${inst.title}” (${inst.assigneeName}) in time, so it is now yours.`,
      instance: inst,
      settings,
    })
  }
  const previous = idx.positionById.get(entry.fromPositionId)
  if (previous?.userId) {
    dispatchTask('escalated', {
      userIds: [previous.userId],
      title: 'An approval passed you by',
      body: `“${inst.title}” went past its ${entry.fromStage === 1 ? 'first' : `stage ${entry.fromStage}`} deadline and has gone up to ${entry.toName}.`,
      instance: inst,
      settings,
    })
  }
}

// What the UI shows on a policy.
export function describePolicy(policy) {
  if (!policy) return 'No escalation — it waits with the named approver.'
  const bits = policy.stages.map((s, i) => {
    const who = s.resolver === 'named' ? 'the named approver'
      : s.resolver === 'next_ancestor' ? 'the next person up'
        : s.resolver === 'node_admin' ? 'the top of the chain'
          : 'that tier'
    return `${i === 0 ? 'starts with' : 'then'} ${who} for ${humanMinutes(s.slaMinutes)}`
  })
  const end = policy.onFinalBreach === 'raise_task' ? 'then it becomes a mandatory task for whoever is holding it'
    : policy.onFinalBreach === 'auto_approve' ? 'then it is auto-approved'
      : 'then everyone above is told'
  return `${bits.join(', ')}, ${end}.`
}

export function humanMinutes(m) {
  if (m < 60) return `${m} min`
  if (m < 1440) return `${Math.round(m / 60)} h`
  return `${Math.round(m / 1440)} d`
}
