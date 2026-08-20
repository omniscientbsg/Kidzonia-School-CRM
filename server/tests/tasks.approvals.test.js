import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, getBaseUrl, api, login, clearSeededTasks } from './helpers.js'
import { localToday } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

async function upload(token, { name = 'proof.png', type = 'image/png' } = {}) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array([1, 2, 3, 4])], { type }), name)
  const res = await fetch(`${getBaseUrl()}/api/media`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form })
  return (await res.json()).id
}

test('approvals: inbox, decisions and the rejection loop', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const meera = await login('superadmin@kidzonia.com')
  const prakash = await login('prakash.reddy@kidzonia.com')  // franchise owner, above JH
  const lakshmi = await login('principal@kidzonia.com')      // named approver
  const sunil = await login('principal.gb@kidzonia.com')     // other school
  const anjali = await login('teacher@kidzonia.com')
  const kavya = await login('teacher2@kidzonia.com')
  const today = localToday(TZ)

  const created = await api('POST', '/api/tasks', {
    token: lakshmi,
    body: {
      title: 'Upload 3 classroom photos',
      description: 'Share the day’s activity photos for the parent diary.',
      target: { kind: 'position', positionIds: ['pos-anjali'] },
      requiresApproval: true,
      requiresMedia: true,
      mediaTypes: ['photo'],
      minAttachments: 1,
      isBlocking: true,
      recurrence: { freq: 'none', startDate: today },
    },
  })
  const instId = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: lakshmi })).data[0].id

  await api('POST', `/api/task-instances/${instId}/attachments`, { token: anjali, body: { mediaId: await upload(anjali) } })
  await api('POST', `/api/task-instances/${instId}/submit`, { token: anjali, body: { comment: 'Circle time and craft corner' } })

  await t.test('the inbox carries the proof and the note being judged', async () => {
    const { status, data } = await api('GET', '/api/tasks/approvals', { token: lakshmi })
    assert.equal(status, 200)
    const row = data.find((r) => r.id === instId)
    assert.ok(row)
    assert.equal(row.assigneeName, 'Anjali Rao')
    assert.equal(row.lastComment, 'Circle time and craft corner')
    assert.equal(row.description, 'Share the day’s activity photos for the parent diary.')
    assert.equal(row.attachments.length, 1)
    assert.equal(row.attachments[0].kind, 'photo')
    assert.ok(row.attachments[0].mediaId)
    assert.equal(row.viaOverride, false)
  })

  await t.test('only valid approvers see it — and the tree decides, not the client', async () => {
    // an ancestor of the assignee also sees it, flagged as an override
    const owner = await api('GET', '/api/tasks/approvals', { token: prakash })
    assert.equal(owner.data.find((r) => r.id === instId).viaOverride, true)

    // the other school sees nothing of it
    const other = await api('GET', '/api/tasks/approvals', { token: sunil })
    assert.equal(other.data.filter((r) => r.id === instId).length, 0)

    // and cannot act on it even knowing the id
    const sneak = await api('POST', `/api/task-instances/${instId}/approve`, { token: sunil })
    assert.equal(sneak.status, 404)

    // the assignee cannot approve her own work
    const self = await api('POST', `/api/task-instances/${instId}/approve`, { token: anjali })
    assert.equal(self.status, 403)
    assert.equal(self.data.error, 'not_approver')

    // a peer is not an approver either
    const peer = await api('POST', `/api/task-instances/${instId}/approve`, { token: kavya })
    assert.equal(peer.status, 404)
  })

  await t.test('rejecting without a reason is refused', async () => {
    const bare = await api('POST', `/api/task-instances/${instId}/reject`, { token: lakshmi })
    assert.equal(bare.status, 422)
    assert.equal(bare.data.error, 'reason_required')

    const blank = await api('POST', `/api/task-instances/${instId}/reject`, { token: lakshmi, body: { comment: '   ' } })
    assert.equal(blank.status, 422)

    const still = await api('GET', `/api/task-instances/${instId}`, { token: lakshmi })
    assert.equal(still.data.status, 'submitted')      // nothing moved
  })

  await t.test('rejection sends it back as live work, not a parked state', async () => {
    const rejected = await api('POST', `/api/task-instances/${instId}/reject`, {
      token: lakshmi, body: { comment: 'Two of the three photos are blurry — please retake.' },
    })
    assert.equal(rejected.status, 200)
    assert.equal(rejected.data.status, 'in_progress')          // straight back to the assignee
    assert.equal(rejected.data.submittedAt, null)
    assert.equal(rejected.data.rejectionCount, 1)
    assert.equal(rejected.data.submissionRound, 2)
    assert.equal(rejected.data.lastRejection.byName, 'Lakshmi Devi')
    assert.match(rejected.data.lastRejection.reason, /blurry/)
    assert.equal(rejected.data.lastRejection.round, 1)

    // it leaves the approver's inbox immediately
    const inbox = await api('GET', '/api/tasks/approvals', { token: lakshmi })
    assert.equal(inbox.data.filter((r) => r.id === instId).length, 0)

    // and the assignee is told
    const notifs = (await api('GET', '/api/notifications', { token: anjali })).data
    assert.ok(notifs.some((n) => n.title === 'Task sent back' && n.body.includes('blurry')))
  })

  await t.test('a rejected blocking task is NOT done and still blocks logout', async () => {
    const gate = await api('GET', '/api/tasks/logout-check', { token: anjali })
    assert.equal(gate.data.blocked, true)
    assert.ok(gate.data.instances.some((i) => i.id === instId))

    const out = await api('POST', '/api/auth/logout', { token: anjali })
    assert.equal(out.status, 409)
    assert.equal(out.data.error, 'blocking_tasks')

    // it shows up as work to do, not as history
    const my = await api('GET', '/api/tasks/my', { token: anjali })
    assert.ok(my.data.dueToday.some((i) => i.id === instId))
    assert.equal(my.data.blockingOpen, 1)
  })

  await t.test('round 2 needs fresh proof; the old round no longer counts', async () => {
    const short = await api('POST', `/api/task-instances/${instId}/submit`, { token: anjali })
    assert.equal(short.status, 422)
    assert.equal(short.data.error, 'proof_required')

    await api('POST', `/api/task-instances/${instId}/attachments`, { token: anjali, body: { mediaId: await upload(anjali, { name: 'retake.png' }) } })
    const resubmitted = await api('POST', `/api/task-instances/${instId}/submit`, { token: anjali, body: { comment: 'Retaken in better light' } })
    assert.equal(resubmitted.status, 200)
    assert.equal(resubmitted.data.status, 'submitted')

    // the inbox shows attempt 2, with only this round's file
    const inbox = await api('GET', '/api/tasks/approvals', { token: lakshmi })
    const row = inbox.data.find((r) => r.id === instId)
    assert.equal(row.submissionRound, 2)
    assert.equal(row.rejectionCount, 1)
    assert.equal(row.attachments.length, 1)
    assert.equal(row.attachments[0].filename, 'retake.png')
  })

  await t.test('approval completes it and releases the gate', async () => {
    const approved = await api('POST', `/api/task-instances/${instId}/approve`, { token: prakash, body: { comment: 'Much better' } })
    assert.equal(approved.status, 200)
    assert.equal(approved.data.status, 'approved')
    assert.ok(approved.data.completedAt)

    assert.equal((await api('GET', '/api/tasks/logout-check', { token: anjali })).data.blocked, false)
    assert.equal((await api('POST', '/api/auth/logout', { token: anjali })).status, 200)

    const twice = await api('POST', `/api/task-instances/${instId}/approve`, { token: lakshmi })
    assert.equal(twice.status, 409)
  })

  await t.test('the audit trail names approver, decision, reason and time', async () => {
    const { data } = await api('GET', `/api/task-instances/${instId}/timeline`, { token: lakshmi })

    const reject = data.approvals.find((a) => a.action === 'instance.reject')
    assert.equal(reject.userName, 'Lakshmi Devi')
    assert.equal(reject.round, 1)
    assert.match(reject.reason, /blurry/)
    assert.ok(reject.at)
    assert.equal(reject.viaOverride, false)

    const approve = data.approvals.find((a) => a.action === 'instance.approve')
    assert.equal(approve.userName, 'Prakash Reddy')
    assert.equal(approve.round, 2)
    assert.equal(approve.viaOverride, true)              // decided as an ancestor, not the named approver

    // the immutable log carries the same decisions independently
    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    const logged = audit.filter((a) => a.recordId === instId && ['instance.approve', 'instance.reject'].includes(a.action))
    assert.equal(logged.length, 2)
    assert.ok(logged.every((a) => a.userId && a.createdAt))
    assert.ok(logged.some((a) => a.action === 'instance.reject' && /blurry/.test(a.reason)))
  })

  await t.test('turnaround stats count rejections, not just approvals', async () => {
    const { data } = await api('GET', '/api/tasks/analytics', { token: lakshmi })
    assert.equal(data.approvalTurnaround.decisions, 2)      // one reject + one approve
    const lakshmiRow = data.approvalTurnaround.byApprover.find((a) => a.userName === 'Lakshmi Devi')
    assert.equal(lakshmiRow.rejected, 1)
    const ownerRow = data.approvalTurnaround.byApprover.find((a) => a.userName === 'Prakash Reddy')
    assert.equal(ownerRow.approved, 1)
    assert.equal(ownerRow.overrides, 1)
    assert.equal(data.team.people.find((p) => p.userName === 'Anjali Rao').sentBack, 1)
  })
})
