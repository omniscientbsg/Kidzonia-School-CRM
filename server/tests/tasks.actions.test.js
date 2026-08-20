import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'
const DAYCARE_SECTION = 'sec-jh-daycare-a'

// Gayatri Nair keeps the day-care group (users.classTeacherOf -> cls-jh-daycare).
// Her three children each have one guardian account.
async function daycareGuardians() {
  const { getDb } = await import('../db.js')
  const db = getDb()
  const kids = db.enrolments.filter((e) => e.sectionId === DAYCARE_SECTION && !e.leftAt).map((e) => e.studentId)
  const users = db.guardianStudentLinks
    .filter((l) => kids.includes(l.studentId))
    .map((l) => db.guardians.find((g) => g.id === l.guardianId)?.userId)
    .filter(Boolean)
  return { kids, guardianUserIds: [...new Set(users)] }
}

async function parentMessages(guardianUserIds) {
  const { getDb } = await import('../db.js')
  return getDb().notifications.filter((n) => guardianUserIds.includes(n.userId) && n.type === 'daycare')
}

const lunchTask = (extra = {}) => ({
  title: 'Day-care lunch served',
  target: { kind: 'position', positionIds: ['pos-gayatri'] },
  priority: 'high',
  completionCondition: {
    nature: 'mcq',
    mcq: {
      question: 'Did you give food to the day-care children?',
      // BOTH answers finish the task — the food not arriving is a fact worth
      // recording. Only Yes tells the parents.
      options: [{ value: 'yes', label: 'Yes', accepts: true }, { value: 'no', label: 'No', accepts: true }],
      requiredAnswer: 'yes',
      requireMedia: true,
    },
  },
  onComplete: {
    actions: [{
      moduleKey: 'daycare', actionKey: 'notifyParents',
      paramBinding: { sectionId: { source: 'assignee.section' }, date: { source: 'instance.serviceDate' } },
      when: { answer: 'yes' },
    }],
  },
  ...extra,
})

test('ACCEPTANCE: the day-care lunch task tells parents exactly once, and only on Yes', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const sudhir = await login('sudhir.kukreja@kidzonia.com')
  const gayatri = await login('gayatri.nair@kidzonia.com')
  const today = localToday(TZ)
  const { kids, guardianUserIds } = await daycareGuardians()

  const make = async (body) => {
    const res = await api('POST', '/api/tasks', { token: sudhir, body: { recurrence: { freq: 'none', startDate: today }, ...body } })
    assert.equal(res.status, 201, JSON.stringify(res.data))
    return {
      task: res.data,
      instanceId: (await api('GET', `/api/task-instances?taskId=${res.data.id}`, { token: sudhir })).data[0].id,
    }
  }
  // proof is required, so every completion needs a photo attached
  const attachPhoto = async (instanceId) => {
    const { getDb, insert } = await import('../db.js')
    const asset = insert('mediaAssets', { filename: 'lunch.jpg', mimetype: 'image/jpeg', size: 1024, path: 'x' }, 'u-gayatri')
    const res = await api('POST', `/api/task-instances/${instanceId}/attachments`, { token: gayatri, body: { mediaId: asset.id } })
    assert.equal(res.status, 200, JSON.stringify(res.data))
    return getDb()
  }

  assert.ok(kids.length >= 1 && guardianUserIds.length >= 1, 'the fixture needs day-care children with guardians')

  await t.test('the task is automated, MCQ, and says what it will do on completion', async () => {
    const { task } = await make(lunchTask({ recurrence: { freq: 'daily', startDate: today } }))
    assert.equal(task.origin, 'automated', 'daily recurrence -> automated origin')
    assert.equal(task.completionCondition.nature, 'mcq', 'nature is independent of that')
    assert.equal(task.requiresMedia, true, 'requireMedia on the MCQ drives the existing proof rule')
    assert.deepEqual(task.actionSummary, ['Tell parents their child was fed — only when the answer is “yes”'])
  })

  let yesInstance = null

  await t.test('YES notifies the right parents, exactly once', async () => {
    const before = (await parentMessages(guardianUserIds)).length
    const { instanceId } = await make(lunchTask())
    yesInstance = instanceId
    await attachPhoto(instanceId)

    const done = await api('POST', `/api/task-instances/${instanceId}/submit`, {
      token: gayatri, body: { completion: { answer: 'yes' } },
    })
    assert.equal(done.status, 200, JSON.stringify(done.data))
    assert.equal(done.data.status, 'approved')

    const after = await parentMessages(guardianUserIds)
    assert.equal(after.length - before, kids.length, 'one message per child, to their guardians')

    const fresh = after.slice(-kids.length)
    assert.ok(fresh.every((n) => guardianUserIds.includes(n.userId)), 'only day-care parents')
    assert.ok(fresh.some((n) => /has had lunch/.test(n.title)))
    assert.ok(fresh.every((n) => n.refType === 'taskInstance' && n.refId === instanceId), 'traceable back to the task')

    // it went through the app's own notification layer, so the per-channel log
    // recorded it like every other message
    const { getDb } = await import('../db.js')
    const log = getDb().notificationLog.filter((l) => fresh.some((n) => n.id === l.notificationId))
    assert.ok(log.length > fresh.length, 'stubbed channels are logged too')

    const result = done.data.actionResults.find((r) => r.key === 'daycare.notifyParents')
    assert.equal(result.status, 'sent')
    assert.equal(result.recipients.length, guardianUserIds.length)
  })

  await t.test('re-submitting cannot notify a second time', async () => {
    const before = (await parentMessages(guardianUserIds)).length

    // the task is terminal, so the API refuses outright
    const again = await api('POST', `/api/task-instances/${yesInstance}/submit`, { token: gayatri })
    assert.equal(again.status, 409)

    // and even calling the runner directly a second time is a no-op — the claim
    // in taskActionRuns is what stops it, not the status check
    const { getDb, find } = await import('../db.js')
    const { runCompletionActions } = await import('../tasks/actions.js')
    const results = runCompletionActions(find('taskInstances', yesInstance), { id: 'u-gayatri' })
    assert.equal(results[0].status, 'skipped')
    assert.equal(results[0].reason, 'already_run')
    assert.equal((await parentMessages(guardianUserIds)).length, before, 'no second message')

    const runs = getDb().taskActionRuns.filter((r) => r.instanceId === yesInstance)
    assert.equal(runs.length, 1, 'exactly one run row')
  })

  await t.test('an approval bounce does not re-notify', async () => {
    const before = (await parentMessages(guardianUserIds)).length
    const { instanceId } = await make(lunchTask({ requiresApproval: true }))
    await attachPhoto(instanceId)

    // submit -> nothing fires yet: parents must not hear about work that can
    // still be sent back
    await api('POST', `/api/task-instances/${instanceId}/submit`, { token: gayatri, body: { completion: { answer: 'yes' } } })
    assert.equal((await parentMessages(guardianUserIds)).length, before, 'submitted is not completed')

    await api('POST', `/api/task-instances/${instanceId}/reject`, { token: sudhir, body: { comment: 'Photo is of the empty tray' } })
    assert.equal((await parentMessages(guardianUserIds)).length, before)

    // second round: fresh proof and a fresh answer
    await attachPhoto(instanceId)
    await api('POST', `/api/task-instances/${instanceId}/submit`, { token: gayatri, body: { completion: { answer: 'yes' } } })
    const approved = await api('POST', `/api/task-instances/${instanceId}/approve`, { token: sudhir })
    assert.equal(approved.data.status, 'approved')

    const after = (await parentMessages(guardianUserIds)).length
    assert.equal(after - before, kids.length, 'told once, on the round that was actually approved')

    const { getDb } = await import('../db.js')
    assert.equal(getDb().taskActionRuns.filter((r) => r.instanceId === instanceId).length, 1)
  })

  await t.test('NO completes the task and tells nobody', async () => {
    const before = (await parentMessages(guardianUserIds)).length
    const { instanceId } = await make(lunchTask())
    await attachPhoto(instanceId)

    const done = await api('POST', `/api/task-instances/${instanceId}/submit`, {
      token: gayatri, body: { completion: { answer: 'no' } },
    })
    assert.equal(done.status, 200)
    assert.equal(done.data.status, 'approved', 'No still finishes the task — it is a record, not a gate')
    assert.equal((await parentMessages(guardianUserIds)).length, before, 'and nobody was told the children were fed')

    const result = done.data.actionResults.find((r) => r.key === 'daycare.notifyParents')
    assert.equal(result.status, 'skipped')
    assert.equal(result.reason, 'answer_did_not_match')

    // the skip is RECORDED, not silent: this is the answer to "why weren't the
    // parents told on Tuesday?"
    const { getDb } = await import('../db.js')
    const run = getDb().taskActionRuns.filter((r) => r.instanceId === instanceId)[0]
    assert.equal(run.status, 'skipped')
    assert.equal(run.expectedAnswer, 'yes')
    assert.equal(run.actualAnswer, 'no')
    assert.deepEqual(run.recipients, [])
  })

  await t.test('the action and its recipients are in the audit trail', async () => {
    const meera = await login('superadmin@kidzonia.com')
    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    const fired = audit.filter((a) => a.action === 'instance.action' && a.recordId === yesInstance)
    assert.equal(fired.length, 1)
    assert.equal(fired[0].after.key, 'daycare.notifyParents')
    assert.equal(fired[0].after.status, 'sent')
    assert.deepEqual([...fired[0].after.recipients].sort(), [...guardianUserIds].sort(), 'who was told, by name')
    assert.equal(fired[0].after.studentIds.length, kids.length)
    assert.match(fired[0].reason, /Told the parents of \d+ child/)
  })
})

// ---------------------------------------------------------------------------
test('on-complete actions: gating, failure and the registry contract', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const sudhir = await login('sudhir.kukreja@kidzonia.com')
  const today = localToday(TZ)

  await t.test('the action gate defaults to the accepting answer, not to "always"', async () => {
    const res = await api('POST', '/api/tasks', {
      token: sudhir,
      body: {
        title: 'Lunch, no explicit gate',
        target: { kind: 'position', positionIds: ['pos-gayatri'] },
        recurrence: { freq: 'none', startDate: today },
        completionCondition: {
          nature: 'mcq',
          mcq: { question: 'Fed?', options: [{ value: 'yes', label: 'Yes', accepts: true }, { value: 'no', label: 'No', accepts: true }], requiredAnswer: 'yes' },
        },
        // no `when` at all
        onComplete: { actions: [{ moduleKey: 'daycare', actionKey: 'notifyParents' }] },
      },
    })
    assert.equal(res.status, 201)
    // defaulting to "fire on any completion" would message parents after a No
    assert.deepEqual(res.data.onComplete.actions[0].when, { answer: 'yes' })
  })

  await t.test('a gate naming an answer that does not exist is refused', async () => {
    const res = await api('POST', '/api/tasks', {
      token: sudhir,
      body: {
        title: 'Lunch, impossible gate',
        target: { kind: 'position', positionIds: ['pos-gayatri'] },
        recurrence: { freq: 'none', startDate: today },
        completionCondition: { nature: 'mcq', mcq: { question: 'Fed?', requiredAnswer: 'yes' } },
        onComplete: { actions: [{ moduleKey: 'daycare', actionKey: 'notifyParents', when: { answer: 'perhaps' } }] },
      },
    })
    assert.equal(res.status, 422)
    assert.match(res.data.message, /not one of the answers/)
  })

  await t.test('the registry publishes the action, so the form gets it for free', async () => {
    const cat = (await api('GET', '/api/tasks/capabilities', { token: sudhir })).data
    const daycare = cat.modules.find((m) => m.key === 'daycare')
    assert.ok(daycare)
    const action = daycare.actions.find((a) => a.key === 'notifyParents')
    assert.equal(action.label, 'Tell parents their child was fed')
    assert.equal(action.implemented, true)
    assert.deepEqual(action.params.map((p) => [p.name, p.bind]), [['sectionId', 'assignee.section'], ['date', 'instance.serviceDate']])
  })

  await t.test('an action that finds nobody to tell is a recorded noop, not a failure', async () => {
    // Anjali keeps a classroom register, not a day-care group
    const lakshmi = await login('principal@kidzonia.com')
    const anjali = await login('teacher@kidzonia.com')
    const res = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Lunch, wrong person',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        recurrence: { freq: 'none', startDate: today },
        completionCondition: { nature: 'mcq', mcq: { question: 'Fed?', requiredAnswer: 'yes' } },
        onComplete: { actions: [{ moduleKey: 'daycare', actionKey: 'notifyParents' }] },
      },
    })
    const id = (await api('GET', `/api/task-instances?taskId=${res.data.id}`, { token: lakshmi })).data[0].id
    const done = await api('POST', `/api/task-instances/${id}/submit`, { token: anjali, body: { completion: { answer: 'yes' } } })

    // the WORK is done either way — a messaging problem must not un-complete it
    assert.equal(done.data.status, 'approved')
    const result = done.data.actionResults.find((r) => r.key === 'daycare.notifyParents')
    assert.ok(['noop', 'sent'].includes(result.status))
  })
})
