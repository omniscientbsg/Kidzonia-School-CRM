import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, getBaseUrl, api, login, clearSeededTasks } from './helpers.js'
import { localToday, addDays } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

// upload a tiny file through the existing /media endpoint
async function upload(token, { name = 'proof.png', type = 'image/png' } = {}) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array([1, 2, 3, 4])], { type }), name)
  const res = await fetch(`${getBaseUrl()}/api/media`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form })
  return (await res.json()).id
}

test('tasks: submit, proof, approval and overrides', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()   // demo board out of the way; these tests build their own

  const meera = await login('superadmin@kidzonia.com')
  const prakash = await login('prakash.reddy@kidzonia.com')
  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const kavya = await login('teacher2@kidzonia.com')
  const today = localToday(TZ)

  const withProof = await api('POST', '/api/tasks', {
    token: lakshmi,
    body: {
      title: 'Upload 3 classroom photos',
      target: { kind: 'position', positionIds: ['pos-anjali'] },
      dueType: 'end_of_day',
      recurrence: { freq: 'none', startDate: today },
      requiresApproval: true,
      requiresMedia: true,
      mediaTypes: ['photo'],
      minAttachments: 2,
    },
  })
  assert.equal(withProof.status, 201)
  const instId = (await api('GET', `/api/task-instances?taskId=${withProof.data.id}`, { token: lakshmi })).data[0].id

  await t.test('only the assignee can work on it', async () => {
    const byOther = await api('POST', `/api/task-instances/${instId}/start`, { token: kavya })
    assert.equal(byOther.status, 404)                     // not visible to a peer at all
    const byBoss = await api('POST', `/api/task-instances/${instId}/start`, { token: lakshmi })
    assert.equal(byBoss.status, 403)
    assert.equal(byBoss.data.error, 'not_assignee')

    const started = await api('POST', `/api/task-instances/${instId}/start`, { token: anjali })
    assert.equal(started.status, 200)
    assert.equal(started.data.status, 'in_progress')
    assert.ok(started.data.startedAt)
  })

  await t.test('proof rules are enforced server-side', async () => {
    const early = await api('POST', `/api/task-instances/${instId}/submit`, { token: anjali })
    assert.equal(early.status, 422)
    assert.equal(early.data.error, 'proof_required')

    const pdfId = await upload(anjali, { name: 'note.pdf', type: 'application/pdf' })
    const wrongType = await api('POST', `/api/task-instances/${instId}/attachments`, { token: anjali, body: { mediaId: pdfId } })
    assert.equal(wrongType.status, 422)
    assert.equal(wrongType.data.error, 'wrong_media_type')

    const a = await api('POST', `/api/task-instances/${instId}/attachments`, { token: anjali, body: { mediaId: await upload(anjali) } })
    assert.equal(a.status, 200)
    const stillShort = await api('POST', `/api/task-instances/${instId}/submit`, { token: anjali })
    assert.equal(stillShort.status, 422)                  // minAttachments is 2

    await api('POST', `/api/task-instances/${instId}/attachments`, { token: anjali, body: { mediaId: await upload(anjali) } })
    const submitted = await api('POST', `/api/task-instances/${instId}/submit`, { token: anjali, body: { comment: 'Morning circle time' } })
    assert.equal(submitted.status, 200)
    assert.equal(submitted.data.status, 'submitted')
  })

  await t.test('approval flows upward — assignee cannot approve their own work', async () => {
    const self = await api('POST', `/api/task-instances/${instId}/approve`, { token: anjali })
    assert.equal(self.status, 403)
    assert.equal(self.data.error, 'not_approver')

    const queue = await api('GET', '/api/tasks/approvals', { token: lakshmi })
    assert.equal(queue.data.length, 1)
    assert.equal(queue.data[0].id, instId)
    assert.equal(queue.data[0].viaOverride, false)

    // an ancestor above the assignee may also decide — recorded as an override
    const ownerQueue = await api('GET', '/api/tasks/approvals', { token: prakash })
    assert.equal(ownerQueue.data[0].viaOverride, true)

    const rejected = await api('POST', `/api/task-instances/${instId}/reject`, { token: lakshmi, body: { comment: 'Photos are blurry' } })
    assert.equal(rejected.status, 200)
    assert.equal(rejected.data.status, 'in_progress')     // sent back as live work
    assert.equal(rejected.data.rejectionCount, 1)
    assert.equal(rejected.data.submissionRound, 2)

    // round 2 needs fresh proof: the old round's files no longer count
    const shortAgain = await api('POST', `/api/task-instances/${instId}/submit`, { token: anjali })
    assert.equal(shortAgain.status, 422)
    await api('POST', `/api/task-instances/${instId}/attachments`, { token: anjali, body: { mediaId: await upload(anjali) } })
    await api('POST', `/api/task-instances/${instId}/attachments`, { token: anjali, body: { mediaId: await upload(anjali) } })
    const resubmitted = await api('POST', `/api/task-instances/${instId}/submit`, { token: anjali, body: { comment: 'Retaken' } })
    assert.equal(resubmitted.status, 200)

    const approved = await api('POST', `/api/task-instances/${instId}/approve`, { token: prakash, body: { comment: 'Much better' } })
    assert.equal(approved.status, 200)
    assert.equal(approved.data.status, 'approved')
    assert.ok(approved.data.completedAt)

    const twice = await api('POST', `/api/task-instances/${instId}/approve`, { token: lakshmi })
    assert.equal(twice.status, 409)
    assert.equal(twice.data.error, 'bad_transition')
  })

  await t.test('the timeline is the audit log, in order', async () => {
    const { data } = await api('GET', `/api/task-instances/${instId}/timeline`, { token: lakshmi })
    const actions = data.events.map((e) => e.action)
    assert.deepEqual(actions.filter((a) => a.startsWith('instance.')).slice(0, 4), ['instance.assign', 'instance.start', 'instance.attach', 'instance.attach'])
    assert.ok(actions.includes('instance.submit'))
    assert.ok(actions.includes('instance.reject'))
    assert.ok(actions.includes('instance.approve'))
    assert.equal(data.approvals.length, 2)
    assert.equal(data.approvals[1].viaOverride, true)      // owner approved, not the named approver
    assert.equal(data.attachments.length, 4)               // both rounds are kept
    const sorted = [...data.events].sort((a, b) => String(a.at).localeCompare(String(b.at)))
    assert.deepEqual(data.events.map((e) => e.id), sorted.map((e) => e.id))
  })

  await t.test('notifications reach the right person at each step', async () => {
    const teacherNotifs = (await api('GET', '/api/notifications', { token: anjali })).data
    assert.ok(teacherNotifs.some((n) => n.title === 'Task sent back'))
    assert.ok(teacherNotifs.some((n) => n.title === 'Task approved'))
    const principalNotifs = (await api('GET', '/api/notifications', { token: lakshmi })).data
    assert.ok(principalNotifs.some((n) => n.title === 'Task awaiting your approval'))
  })

  await t.test('defer needs a reason and moves the deadline', async () => {
    const chore = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Stock-take the art cupboard',
        target: { kind: 'position', positionIds: ['pos-kavya'] },
        recurrence: { freq: 'none', startDate: today },
      },
    })
    const id = (await api('GET', `/api/task-instances?taskId=${chore.data.id}`, { token: lakshmi })).data[0].id

    const noReason = await api('POST', `/api/task-instances/${id}/defer`, { token: lakshmi, body: { to: addDays(today, 2) } })
    assert.equal(noReason.status, 422)
    assert.equal(noReason.data.error, 'reason_required')

    const byAssignee = await api('POST', `/api/task-instances/${id}/defer`, { token: kavya, body: { to: addDays(today, 2), reason: 'Busy' } })
    assert.equal(byAssignee.status, 403)                   // you cannot defer your own work

    const deferred = await api('POST', `/api/task-instances/${id}/defer`, { token: lakshmi, body: { to: addDays(today, 2), reason: 'Store room locked' } })
    assert.equal(deferred.status, 200)
    assert.equal(deferred.data.status, 'deferred')
    assert.equal(deferred.data.deferredTo, addDays(today, 2))
    assert.equal(deferred.data.dueAt, `${addDays(today, 2)}T18:29:59.999Z`)

    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    assert.ok(audit.some((a) => a.action === 'instance.defer' && a.reason === 'Store room locked'))
  })

  await t.test('reassign closes the old row and opens one for the new person', async () => {
    const chore = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Escort the bus queue',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        recurrence: { freq: 'none', startDate: today },
      },
    })
    const id = (await api('GET', `/api/task-instances?taskId=${chore.data.id}`, { token: lakshmi })).data[0].id

    const outOfReach = await api('POST', `/api/task-instances/${id}/reassign`, { token: lakshmi, body: { toPositionId: 'pos-divya' } })
    assert.equal(outOfReach.status, 403)

    const moved = await api('POST', `/api/task-instances/${id}/reassign`, { token: lakshmi, body: { toPositionId: 'pos-kavya', reason: 'Anjali on leave' } })
    assert.equal(moved.status, 200)
    assert.equal(moved.data.assigneeUserId, 'u-teacher2')
    assert.equal(moved.data.status, 'assigned')

    const rows = (await api('GET', `/api/task-instances?taskId=${chore.data.id}`, { token: lakshmi })).data
    assert.equal(rows.length, 2)
    const old = rows.find((r) => r.id === id)
    assert.equal(old.status, 'cancelled')
    assert.match(old.cancelReason, /Reassigned to Kavya Menon/)

    // regeneration must not resurrect the original pairing
    await api('POST', '/api/tasks/generate', { token: lakshmi, body: { taskId: chore.data.id } })
    const after = (await api('GET', `/api/task-instances?taskId=${chore.data.id}`, { token: lakshmi })).data
    assert.equal(after.length, 2)
  })
})
