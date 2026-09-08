import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday } from '../tasks/time.js'
import { slaDeadline, describePolicy, normalizePolicy } from '../tasks/escalation.js'
import { localDate } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

// Anjali (teacher) -> Lakshmi (principal) -> Prakash (owner) -> Meera (HQ).
// Escalation must walk exactly that line and no other.
test('approval escalation climbs the ancestor chain on the clock', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const meera = await login('superadmin@kidzonia.com')
  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)

  const policyRes = await api('POST', '/api/escalation-policies', {
    token: lakshmi,
    body: {
      name: 'Standard approvals',
      stages: [
        { resolver: 'named', slaMinutes: 120 },
        { resolver: 'next_ancestor', slaMinutes: 240 },
        { resolver: 'node_admin', slaMinutes: 480 },
      ],
      onFinalBreach: 'raise_task',
      skipNonWorkingDays: false,
    },
  })
  assert.equal(policyRes.status, 201, JSON.stringify(policyRes.data))
  const policyId = policyRes.data.id

  const makeSubmitted = async () => {
    const created = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Weekly display board',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        recurrence: { freq: 'none', startDate: today },
        requiresApproval: true,
        escalationPolicyId: policyId,
      },
    })
    const id = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: lakshmi })).data[0].id
    await api('POST', `/api/task-instances/${id}/submit`, { token: anjali })
    return id
  }
  // wind a submitted occurrence's SLA into the past, the way the clock would
  const expire = async (id) => {
    const { getDb } = await import('../db.js')
    const inst = getDb().taskInstances.find((i) => i.id === id)
    inst.escalation.dueBy = new Date(Date.now() - 60000).toISOString()
    return inst
  }
  const load = async (id, token = lakshmi) => (await api('GET', `/api/task-instances/${id}`, { token })).data

  let instId = null

  await t.test('submitting starts the clock at stage 1', async () => {
    instId = await makeSubmitted()
    const inst = await load(instId)
    assert.equal(inst.status, 'submitted')
    assert.equal(inst.escalation.stage, 1)
    assert.equal(inst.escalation.stageCount, 3)
    assert.equal(inst.escalation.policyName, 'Standard approvals')
    assert.ok(Date.parse(inst.escalation.dueBy) > Date.now(), 'the deadline is ahead of us')

    const view = await api('GET', `/api/task-instances/${instId}/escalation`, { token: lakshmi })
    assert.equal(view.data.currentApproverName, 'Lakshmi Devi', 'it starts with the named approver')
    assert.match(view.data.policy.summary, /starts with the named approver for 2 h/)
  })

  await t.test('THE INVARIANT: the junior is not re-trapped, whatever the chain does', async () => {
    // submitted is not an open status, so the gate was clear the moment she sent it
    const gate = await api('GET', '/api/tasks/logout-check', { token: anjali })
    assert.equal(gate.data.blocked, false)

    await expire(instId)
    await api('GET', '/api/tasks/my', { token: anjali })   // any read runs the sweep

    const after = await api('GET', '/api/tasks/logout-check', { token: anjali })
    assert.equal(after.data.blocked, false, 'a slow approver must never cost the junior their sign-off')
    const inst = await load(instId)
    assert.equal(inst.status, 'submitted', 'escalation never writes an open status back')
  })

  await t.test('a breach moves the approval to the next ancestor, and says so', async () => {
    const inst = await load(instId)
    assert.equal(inst.escalation.stage, 2)
    const view = await api('GET', `/api/task-instances/${instId}/escalation`, { token: lakshmi })
    assert.equal(view.data.currentApproverName, 'Prakash Reddy', 'one hop up the chain, not a jump to HQ')

    const entry = inst.escalation.history[0]
    assert.equal(entry.fromName, 'Lakshmi Devi')
    assert.equal(entry.toName, 'Prakash Reddy')
    assert.equal(entry.resolver, 'next_ancestor')
    assert.ok(entry.breachedAt)
  })

  await t.test('the approval itself moved — the inbox and the permission follow', async () => {
    const prakash = await login('prakash.reddy@kidzonia.com')
    const inbox = (await api('GET', '/api/tasks/approvals', { token: prakash })).data
    assert.ok(inbox.some((r) => r.id === instId), 'it is now in his inbox')

    // and both sides were told
    const note = (await api('GET', '/api/notifications', { token: prakash })).data
      .find((n) => n.event === 'escalated' && /escalated to you/.test(n.title))
    assert.ok(note)
    const passed = (await api('GET', '/api/notifications', { token: lakshmi })).data
      .find((n) => n.event === 'escalated' && /passed you by/.test(n.title))
    assert.ok(passed, 'the person who sat on it is told too')
  })

  await t.test('every stage transition is audited', async () => {
    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    const rows = audit.filter((a) => a.action === 'approval.escalated' && a.recordId === instId)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].before.stage, 1)
    assert.equal(rows[0].after.stage, 2)
    assert.match(rows[0].reason, /SLA breached at/)
  })

  await t.test('it keeps climbing, then stops at the top', async () => {
    await expire(instId)
    await api('GET', '/api/tasks/my', { token: anjali })
    let inst = await load(instId)
    assert.equal(inst.escalation.stage, 3)
    const atTop = await api('GET', `/api/task-instances/${instId}/escalation`, { token: meera })
    assert.equal(atTop.data.currentApproverName, 'Meera Krishnan')

    // one more breach and the ladder is exhausted
    await expire(instId)
    await api('GET', '/api/tasks/my', { token: anjali })
    inst = await load(instId)
    assert.equal(inst.escalation.exhausted, true)
    assert.equal(inst.status, 'submitted', 'still nobody has decided — it is not auto-approved by default')

    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    assert.ok(audit.some((a) => a.action === 'approval.escalation_exhausted' && a.recordId === instId))
    assert.ok((await api('GET', '/api/notifications', { token: meera })).data.some((n) => n.event === 'sla_breach'))
  })

  await t.test('INACTION HAS TEETH: the breach becomes the approver’s own blocking task', async () => {
    const hers = (await api('GET', '/api/tasks/my', { token: meera })).data
    const all = [...hers.overdue, ...hers.dueToday, ...hers.thisWeek, ...hers.upcoming]
    const chase = all.find((i) => /Overdue approval/.test(i.title))
    assert.ok(chase, 'the person holding it now owes a task of their own')
    assert.equal(chase.isBlocking, true)
    assert.equal(chase.completionCondition.mode, 'system')
    assert.equal(chase.completionCondition.system.moduleKey, 'tasks')

    // it cannot be ticked by hand — it clears when they actually decide
    const byHand = await api('POST', `/api/task-instances/${chase.id}/answer`, { token: meera, body: { answer: 'yes' } })
    assert.equal(byHand.status, 422)
    const early = await api('POST', `/api/task-instances/${chase.id}/submit`, { token: meera })
    assert.equal(early.status, 422)
    assert.match(early.data.message, /still waiting on your decision/)

    // deciding the original approval clears the chase task by itself
    await api('POST', `/api/task-instances/${instId}/approve`, { token: meera, body: { comment: 'Fine' } })
    await api('GET', '/api/tasks/my', { token: meera })
    const cleared = (await api('GET', `/api/task-instances/${chase.id}`, { token: meera })).data
    assert.equal(cleared.condition.satisfied, true, 'the signal it is bound to is now true')
    const done = await api('POST', `/api/task-instances/${chase.id}/submit`, { token: meera })
    assert.equal(done.data.status, 'approved')
  })

  await t.test('a decision stops the clock and hands the ladder back', async () => {
    const inst = await load(instId)
    assert.equal(inst.status, 'approved')
    assert.ok(inst.escalation.closedAt)
    assert.equal(inst.escalation.closedReason, 'approved')
    assert.equal(inst.approverPositionId, 'pos-lakshmi', 'the next round starts from the bottom of the ladder again')
  })

  await t.test('sending work back also stops the clock', async () => {
    const id = await makeSubmitted()
    await expire(id)
    await api('GET', '/api/tasks/my', { token: anjali })
    assert.equal((await load(id)).escalation.stage, 2)

    const prakash = await login('prakash.reddy@kidzonia.com')
    await api('POST', `/api/task-instances/${id}/reject`, { token: prakash, body: { comment: 'Redo the border' } })
    const inst = await load(id)
    assert.equal(inst.status, 'in_progress')
    assert.ok(inst.escalation.closedAt)
    assert.equal(inst.escalation.closedReason, 'sent_back')

    // and it does not keep climbing once it is back with her
    await api('GET', '/api/tasks/my', { token: anjali })
    assert.equal((await load(id)).escalation.stage, 2, 'no further stages after the clock stopped')
  })
})

// ---------------------------------------------------------------------------
test('escalation policy: validation, defaults and the ancestor boundary', async (t) => {
  await startServer()
  t.after(stopServer)

  const lakshmi = await login('principal@kidzonia.com')

  await t.test('a policy needs stages, and each stage needs a real SLA', async () => {
    const noStages = await api('POST', '/api/escalation-policies', { token: lakshmi, body: { name: 'Empty', stages: [] } })
    assert.equal(noStages.status, 422)
    assert.match(noStages.data.message, /at least one stage/)

    const badSla = await api('POST', '/api/escalation-policies', {
      token: lakshmi, body: { name: 'Bad', stages: [{ resolver: 'next_ancestor', slaMinutes: 0 }] },
    })
    assert.equal(badSla.status, 422)

    const tierNoLevel = normalizePolicy({ name: 'T', stages: [{ resolver: 'tier', slaMinutes: 60 }] })
    assert.match(tierNoLevel.errors[0], /names a tier but no level/)
  })

  await t.test('auto-approve is never the default', async () => {
    const { policy } = normalizePolicy({ name: 'X', stages: [{ resolver: 'next_ancestor', slaMinutes: 60 }] })
    assert.equal(policy.onFinalBreach, 'notify_only')
    assert.match(describePolicy(policy), /then everyone above is told/)
  })

  await t.test('a category can carry the default policy', async () => {
    const p = await api('POST', '/api/escalation-policies', {
      token: lakshmi, body: { name: 'Compliance ladder', stages: [{ resolver: 'next_ancestor', slaMinutes: 30 }] },
    })
    const set = await api('PUT', '/api/task-categories/tcat-compliance/escalation', {
      token: lakshmi, body: { escalationPolicyId: p.data.id },
    })
    assert.equal(set.status, 200)
    assert.equal(set.data.escalationPolicyId, p.data.id)

    const bad = await api('PUT', '/api/task-categories/tcat-compliance/escalation', {
      token: lakshmi, body: { escalationPolicyId: 'nope' },
    })
    assert.equal(bad.status, 422)
  })

  await t.test('an SLA landing on a closed day waits for the next working morning', () => {
    // Sunday is day 0; a school working Mon-Sat has workWeek [1..6]
    const friday = '2026-08-21T09:00:00.000Z'
    const overSunday = slaDeadline(friday, 60 * 42, { tz: TZ, workWeek: [1, 2, 3, 4, 5, 6] })
    // judged in the SCHOOL's day, not UTC's — the raw deadline lands on Sunday
    // the 23rd in Kolkata, so it waits for Monday morning
    assert.equal(localDate(TZ, new Date(Date.parse(friday) + 60 * 42 * 60000)), '2026-08-23')
    assert.equal(localDate(TZ, overSunday), '2026-08-24', 'pushed to the next working morning')

    // with no working week configured the raw deadline stands
    const raw = slaDeadline(friday, 60, {})
    assert.equal(raw, new Date(Date.parse(friday) + 3600000).toISOString())
  })
})
