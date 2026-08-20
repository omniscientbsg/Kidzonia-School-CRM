import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'
const SECTION = 'sec-jh-nursery-a'          // Anjali's register

async function clearRegister(sectionId, date) {
  const { getDb } = await import('../db.js')
  const db = getDb()
  db.attendanceRecords = db.attendanceRecords.filter((r) => !(r.sectionId === sectionId && r.date === date))
}

// Locks outlive the tasks that placed them, so a fixture that leaves one behind
// would block the NEXT test from marking the same register at all.
async function clearLocks() {
  const { getDb } = await import('../db.js')
  const db = getDb()
  db.taskLocks = []
  db.taskLockRequests = []
}

test('ACCEPTANCE: completed attendance is locked, an ancestor unlocks one edit, the task re-verifies', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')      // ancestor of Anjali
  const anjali = await login('teacher@kidzonia.com')         // the class teacher
  const kavya = await login('teacher2@kidzonia.com')         // a peer — no authority
  const today = localToday(TZ)
  await clearRegister(SECTION, today)

  const roster = async () => (await api('GET', `/api/attendance?sectionId=${SECTION}&date=${today}`, { token: anjali })).data
  const mark = (records, token = anjali) => api('POST', '/api/attendance', { token, body: { sectionId: SECTION, date: today, records } })

  // ---- a module-linked task that locks the register it was verified against ----
  const created = await api('POST', '/api/tasks', {
    token: lakshmi,
    body: {
      title: 'Mark Attendance',
      target: { kind: 'position', positionIds: ['pos-anjali'] },
      recurrence: { freq: 'none', startDate: today },
      completionCondition: {
        nature: 'module_linked',
        moduleLinked: { moduleKey: 'attendance', signalKey: 'isMarked' },
      },
      lockOnComplete: [{
        moduleKey: 'attendance', guardKey: 'editRequiresApproval',
        paramBinding: { sectionId: { source: 'assignee.section' }, date: { source: 'instance.serviceDate' } },
      }],
    },
  })
  assert.equal(created.status, 201, JSON.stringify(created.data))
  const instId = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: lakshmi })).data[0].id

  let lockId = null
  let requestId = null
  let children = []

  await t.test('before completion the register is freely editable', async () => {
    children = await roster()
    assert.ok(children.length >= 2, 'the fixture needs a real roster')
    const res = await mark(children.map((c) => ({ studentId: c.studentId, status: 'present' })))
    assert.equal(res.status, 200)
    assert.equal(res.data.reEdit, null, 'no grant was spent — nothing was locked')
  })

  await t.test('completing the task locks that register, and the lock is audited', async () => {
    const done = await api('POST', `/api/task-instances/${instId}/submit`, { token: anjali })
    assert.equal(done.status, 200)
    assert.equal(done.data.status, 'approved')

    const locks = (await api('GET', '/api/tasks/locks', { token: anjali })).data
    const lock = locks.find((l) => l.instanceId === instId)
    assert.ok(lock, 'a lock was placed')
    lockId = lock.id
    assert.equal(lock.collection, 'attendanceRecords')
    assert.deepEqual(lock.scope, { collection: 'attendanceRecords', sectionId: SECTION, date: today })
    assert.equal(lock.canDecide, false, 'the assignee cannot sign off her own re-edit')

    const meera = await login('superadmin@kidzonia.com')
    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    const entry = audit.find((a) => a.action === 'lock.place' && a.recordId === lockId)
    assert.ok(entry, 'placing the lock is audited')
    assert.equal(entry.after.instanceId, instId)
  })

  await t.test('the teacher can no longer edit that attendance', async () => {
    const blocked = await mark([{ studentId: children[0].studentId, status: 'absent' }])
    assert.equal(blocked.status, 423)
    assert.equal(blocked.data.error, 'record_locked')
    assert.match(blocked.data.message, /locked/)
    assert.match(blocked.data.message, /Mark Attendance/, 'it names the task that locked it')
    assert.equal(blocked.data.canRequest, true, 'and offers the way forward')
    assert.equal(blocked.data.lockId, lockId)

    // nothing was written
    const { getDb } = await import('../db.js')
    const row = getDb().attendanceRecords.find((r) => r.studentId === children[0].studentId && r.date === today)
    assert.equal(row.status, 'present', 'the edit really was refused, not just reported as refused')
  })

  await t.test('another day, and another register, are untouched', async () => {
    const other = await api('POST', '/api/attendance', {
      token: anjali,
      body: { sectionId: SECTION, date: '2026-01-15', records: [{ studentId: children[0].studentId, status: 'present' }] },
    })
    assert.equal(other.status, 200, 'the lock is scoped to its own date')

    const kavyaRoster = (await api('GET', `/api/attendance?sectionId=sec-jh-jrkg-a&date=${today}`, { token: kavya })).data
    const hers = await api('POST', '/api/attendance', {
      token: kavya,
      body: { sectionId: 'sec-jh-jrkg-a', date: today, records: kavyaRoster.map((c) => ({ studentId: c.studentId, status: 'present' })) },
    })
    assert.equal(hers.status, 200, 'and to its own section')
  })

  await t.test('she asks for a re-edit, and it goes to her ancestors', async () => {
    const req = await api('POST', `/api/tasks/locks/${lockId}/request`, {
      token: anjali, body: { reason: 'Aarav came in after the register closed' },
    })
    assert.equal(req.status, 201)
    requestId = req.data.id
    assert.equal(req.data.status, 'pending')
    assert.ok(req.data.approverNames.includes('Lakshmi Devi'), 'her principal is asked')
    assert.ok(req.data.approverNames.includes('Meera Krishnan'), 'and so is HQ — not one manager who might be away')

    // still locked while it is pending, and the message says so
    const still = await mark([{ studentId: children[0].studentId, status: 'absent' }])
    assert.equal(still.status, 423)
    assert.match(still.data.message, /waiting for/)
    assert.equal(still.data.canRequest, false, 'no double-asking')

    const dup = await api('POST', `/api/tasks/locks/${lockId}/request`, { token: anjali, body: { reason: 'again' } })
    assert.equal(dup.status, 409)
  })

  await t.test('it lands in the ancestor inbox, ready to decide', async () => {
    const forLakshmi = (await api('GET', '/api/tasks/lock-requests?status=pending', { token: lakshmi })).data
    const row = forLakshmi.find((r) => r.id === requestId)
    assert.ok(row, 'her principal sees it')
    assert.equal(row.canDecide, true)
    assert.equal(row.byName, 'Anjali Rao')
    assert.equal(row.taskTitle, 'Mark Attendance')
    assert.match(row.scopeLabel, /attendanceRecords/)
    assert.match(row.scopeLabel, new RegExp(SECTION))

    // the requester sees her own, but cannot act on it
    const hers = (await api('GET', '/api/tasks/lock-requests', { token: anjali })).data.find((r) => r.id === requestId)
    assert.equal(hers.canDecide, false)

    // a peer sees nothing
    const peer = (await api('GET', '/api/tasks/lock-requests', { token: kavya })).data
    assert.ok(!peer.some((r) => r.id === requestId))
  })

  await t.test('only a real ancestor may approve it', async () => {
    // Kavya is a peer at the same node — canManage says no
    const peer = await api('POST', `/api/tasks/lock-requests/${requestId}/decide`, { token: kavya, body: { decision: 'approved' } })
    assert.equal(peer.status, 403)
    assert.equal(peer.data.error, 'not_approver')

    // and the assignee cannot approve her own
    const herself = await api('POST', `/api/tasks/lock-requests/${requestId}/decide`, { token: anjali, body: { decision: 'approved' } })
    assert.equal(herself.status, 403)
  })

  await t.test('the ancestor approves, and it unlocks exactly ONE edit', async () => {
    const ok = await api('POST', `/api/tasks/lock-requests/${requestId}/decide`, {
      token: lakshmi, body: { decision: 'approved', comment: 'Fine — mark him late' },
    })
    assert.equal(ok.status, 200)
    assert.equal(ok.data.status, 'approved')
    assert.equal(ok.data.maxEdits, 1)
    assert.ok(Date.parse(ok.data.expiresAt) > Date.now(), 'the window is bounded in time as well as in edits')

    // the edit now goes through
    const edit = await mark(children.map((c, i) => ({ studentId: c.studentId, status: i === 0 ? 'late' : 'present' })))
    assert.equal(edit.status, 200)
    assert.equal(edit.data.reEdit, requestId, 'the grant was spent by the edit itself')

    const { getDb } = await import('../db.js')
    assert.equal(getDb().attendanceRecords.find((r) => r.studentId === children[0].studentId && r.date === today).status, 'late')

    // a SECOND edit is refused — one approval, one change
    const second = await mark([{ studentId: children[1].studentId, status: 'absent' }])
    assert.equal(second.status, 423)
    assert.equal(second.data.canRequest, true, 'she may ask again')
  })

  await t.test('the task re-verified against the new state, and still holds', async () => {
    const inst = (await api('GET', `/api/task-instances/${instId}`, { token: anjali })).data
    assert.equal(inst.status, 'approved', 'a legitimate correction does not un-complete the work')
    assert.ok(inst.verifications.some((v) => v.source === 'recheck'), 'it was re-read after the edit')
    assert.equal(inst.verificationBroken, false, 'an ancestor agreed to this change — flagging it would make the flag meaningless')

    // not flagged, but not forgotten: the frozen evidence stays as it was and
    // the revision is on the record
    assert.ok(inst.evidenceRevisedAt, 'the revision is noted')
    assert.notEqual(inst.evidenceRevisedChecksum, inst.completionEvidence.checksum)

    const meera = await login('superadmin@kidzonia.com')
    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    const revised = audit.find((a) => a.action === 'instance.evidence_revised' && a.recordId === instId)
    assert.ok(revised, 'and audited as a revision rather than a break')
    assert.equal(revised.after.authorised, true)
  })

  await t.test('every step is in the audit trail', async () => {
    const meera = await login('superadmin@kidzonia.com')
    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    const of = (action) => audit.filter((a) => a.action === action)

    assert.equal(of('lock.place').length, 1)
    assert.equal(of('lock.request').length, 1)
    assert.equal(of('lock.approve').length, 1)
    assert.equal(of('lock.edit').length, 1, 'the authorised edit itself is recorded')

    const approve = of('lock.approve')[0]
    assert.equal(approve.userId, 'u-principal', 'who allowed it')
    assert.equal(approve.reason, 'Fine — mark him late', 'and why')

    const edit = of('lock.edit')[0]
    assert.equal(edit.userId, 'u-teacher', 'who made the edit')
    assert.equal(edit.after.approvedByUserId, 'u-principal', 'under whose authority')
    assert.equal(edit.after.editsUsed, 1)
  })
})

// ---------------------------------------------------------------------------
test('an unapproved change to verified records flags the task instead of passing silently', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)
  await clearRegister(SECTION, today)
  await clearLocks()

  const roster = (await api('GET', `/api/attendance?sectionId=${SECTION}&date=${today}`, { token: anjali })).data
  await api('POST', '/api/attendance', {
    token: anjali,
    body: { sectionId: SECTION, date: today, records: roster.map((c) => ({ studentId: c.studentId, status: 'present' })) },
  })

  const created = await api('POST', '/api/tasks', {
    token: lakshmi,
    body: {
      title: 'Mark Attendance',
      target: { kind: 'position', positionIds: ['pos-anjali'] },
      recurrence: { freq: 'none', startDate: today },
      completionCondition: { nature: 'module_linked', moduleLinked: { moduleKey: 'attendance', signalKey: 'isMarked' } },
      lockOnComplete: [{
        moduleKey: 'attendance', guardKey: 'editRequiresApproval',
        paramBinding: { sectionId: { source: 'assignee.section' }, date: { source: 'instance.serviceDate' } },
      }],
    },
  })
  const instId = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: lakshmi })).data[0].id
  await api('POST', `/api/task-instances/${instId}/submit`, { token: anjali })
  const evidenceBefore = (await api('GET', `/api/task-instances/${instId}`, { token: anjali })).data.completionEvidence
  assert.ok(evidenceBefore.checksum)

  await t.test('approving leave writes the register by another door — and is caught', async () => {
    // Leave approval writes attendanceRecords directly. It is deliberately NOT
    // blocked: refusing a child's leave because a task locked that day would be
    // the wrong trade. It announces itself instead.
    const student = roster[0].studentId
    const { insert } = await import('../db.js')
    const lr = insert('leaveRequests', {
      studentId: student, fromDate: today, toDate: today, reason: 'Fever', status: 'pending', decidedBy: null,
    }, 'u-principal')

    const res = await api('POST', `/api/leave-requests/${lr.id}/decide`, { token: lakshmi, body: { status: 'approved' } })
    assert.equal(res.status, 200, 'the leave is approved — the lock does not veto pastoral decisions')

    const { getDb } = await import('../db.js')
    assert.equal(getDb().attendanceRecords.find((r) => r.studentId === student && r.date === today).status, 'leave')

    const inst = (await api('GET', `/api/task-instances/${instId}`, { token: anjali })).data
    assert.equal(inst.status, 'approved', 'the work is not un-done — she did mark the register')
    assert.equal(inst.verificationBroken, true, 'but it does not silently pass either')
    assert.match(inst.verificationBrokenReason, /without an approved re-edit/)
    assert.notEqual(inst.verificationBrokenChecksum, evidenceBefore.checksum, 'the fingerprint moved')
    assert.equal(inst.completionEvidence.checksum, evidenceBefore.checksum, 'the frozen evidence is not rewritten')
  })

  await t.test('the people who own the outcome are told', async () => {
    const inbox = async (token) => (await api('GET', '/api/notifications', { token })).data
    const note = (await inbox(lakshmi)).find((n) => n.event === 'verification_broken')
    assert.ok(note, 'the approver hears about it')
    assert.match(note.title, /no longer matches its records/)
    assert.ok((await inbox(anjali)).some((n) => n.event === 'verification_broken'))
  })

  await t.test('and it is on the immutable record', async () => {
    const meera = await login('superadmin@kidzonia.com')
    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    const entry = audit.find((a) => a.action === 'instance.verification_broken' && a.recordId === instId)
    assert.ok(entry)
    assert.notEqual(entry.before.checksum, entry.after.checksum)
    assert.equal(entry.after.ref.sectionId, SECTION)
    assert.equal(entry.after.authorised, false)
  })
})

// ---------------------------------------------------------------------------
test('the lock interface is the only thing a module has to know', async (t) => {
  await startServer()
  t.after(stopServer)

  await t.test('a broken lock provider fails OPEN, it does not freeze the module', async () => {
    const taskLock = (await import('../capabilities/taskLock.js')).default
    const { registerLockProvider } = await import('../capabilities/taskLock.js')
    const { registerLocks } = await import('../tasks/lock.js')

    registerLockProvider(() => { throw new Error('provider exploded') })
    const res = taskLock.check('attendance', { collection: 'attendanceRecords', sectionId: 'x', date: '2026-01-01' }, {})
    assert.equal(res.locked, false, 'a bug in the lock layer must not stop a teacher marking a register')

    registerLocks({ force: true })            // put the real one back
    assert.equal(taskLock.hasLockProvider(), true)
  })

  await t.test('scope matching is a subset match on the ref', async () => {
    const { refMatches, refKey } = await import('../capabilities/taskLock.js')
    const scope = { collection: 'attendanceRecords', sectionId: 'sec-a', date: '2026-08-19' }
    assert.equal(refMatches(scope, { collection: 'attendanceRecords', sectionId: 'sec-a', date: '2026-08-19', studentId: 'stu-1' }), true)
    assert.equal(refMatches(scope, { collection: 'attendanceRecords', sectionId: 'sec-b', date: '2026-08-19' }), false)
    assert.equal(refMatches(scope, { collection: 'dcMeals', sectionId: 'sec-a', date: '2026-08-19' }), false)
    // key is order-independent, so two callers building the ref differently agree
    assert.equal(refKey({ collection: 'x', b: 2, a: 1 }), refKey({ collection: 'x', a: 1, b: 2 }))
  })

  await t.test('the owning module imports exactly one thing from the task engine', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../routes/students.routes.js', import.meta.url), 'utf8')
    const taskImports = [...src.matchAll(/^import .*from '\.\..*'$/gm)]
      .map((m) => m[0])
      .filter((line) => /tasks\//.test(line))
    assert.deepEqual(taskImports, [], 'attendance must not import from server/tasks at all')
    assert.match(src, /import taskLock from '\.\.\/capabilities\/taskLock\.js'/)
    // and it calls it once
    assert.equal((src.match(/taskLock\.check\(/g) || []).length, 1)
  })
})
