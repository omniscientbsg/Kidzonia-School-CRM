import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

// Anjali (u-teacher) keeps the register for Nursery A. Kavya (u-teacher2) keeps
// Jr KG A. Both are class teachers of other classes too — the binding must pick
// the register they actually mark, not every class they carry a title for.
const ANJALI_SECTION = 'sec-jh-nursery-a'

// The demo seed marks today's registers so the dashboards open with real
// numbers. These tests need an UNMARKED register to start from, so they empty
// the one they are about to use (same process, same db singleton).
async function clearRegister(sectionId, date) {
  const { getDb } = await import('../db.js')
  const db = getDb()
  db.attendanceRecords = db.attendanceRecords.filter((r) => !(r.sectionId === sectionId && r.date === date))
}

test('ACCEPTANCE: a Mark Attendance task cannot be completed until attendance is actually marked', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)
  await clearRegister(ANJALI_SECTION, today)

  // ---- the class teacher is given a module-linked "Mark Attendance" task ----
  const created = await api('POST', '/api/tasks', {
    token: lakshmi,
    body: {
      title: 'Mark Attendance',
      target: { kind: 'position', positionIds: ['pos-anjali'] },
      recurrence: { freq: 'none', startDate: today },
      isBlocking: true,
      completionCondition: {
        nature: 'module_linked',
        moduleLinked: {
          moduleKey: 'attendance',
          signalKey: 'isMarked',
          paramBinding: { sectionId: { source: 'assignee.section' }, date: { source: 'instance.serviceDate' } },
          derivedMcq: { question: 'Attendance marked?' },
        },
      },
    },
  })
  assert.equal(created.status, 201)
  const instId = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: lakshmi })).data[0].id
  const load = async (token = anjali) => (await api('GET', `/api/task-instances/${instId}`, { token })).data

  // helper: mark the register the way the Attendance screen does
  const roster = async () => (await api('GET', `/api/attendance?sectionId=${ANJALI_SECTION}&date=${today}`, { token: anjali })).data
  const mark = (records) => api('POST', '/api/attendance', { token: anjali, body: { sectionId: ANJALI_SECTION, date: today, records } })

  await t.test('before the register is marked, the task cannot be completed', async () => {
    const inst = await load()
    assert.equal(inst.condition.nature, 'module_linked')
    assert.equal(inst.condition.satisfied, false)
    assert.equal(inst.condition.verifiable, true, 'we CAN judge this — the answer is simply no')
    assert.equal(inst.conditionMet, false)

    const refused = await api('POST', `/api/task-instances/${instId}/submit`, { token: anjali })
    assert.equal(refused.status, 422)
    assert.equal(refused.data.error, 'module_not_done')
    assert.match(refused.data.message, /Open Attendance and mark it first/)
  })

  await t.test('the derived Yes is read-only — the assignee cannot self-select it', async () => {
    const inst = await load()
    assert.equal(inst.can.answer, false, 'no answer endpoint is offered at all')
    assert.equal(inst.condition.derived.readOnly, true)
    assert.equal(inst.condition.derived.enabled, false, 'the Yes is disabled while the signal is false')
    assert.equal(inst.condition.derived.value, null)
    assert.equal(inst.condition.derived.cta.route, '/attendance', 'the message is a way forward, not a dead end')

    // and the endpoint refuses it outright, so a hand-rolled request gets nowhere
    const forged = await api('POST', `/api/task-instances/${instId}/answer`, { token: anjali, body: { answer: 'yes' } })
    assert.equal(forged.status, 422)
    assert.equal(forged.data.error, 'derived_answer')
    assert.equal((await load()).conditionMet, false)
  })

  await t.test('a HALF-marked register is not marked', async () => {
    const children = await roster()
    assert.ok(children.length >= 2, 'the fixture needs a real roster')
    await mark(children.slice(0, 1).map((c) => ({ studentId: c.studentId, status: 'present' })))

    const inst = await load()
    assert.equal(inst.condition.satisfied, false)
    assert.match(inst.condition.message, new RegExp(`${children.length - 1} of ${children.length} children are still unmarked`))
    assert.equal((await api('POST', `/api/task-instances/${instId}/submit`, { token: anjali })).status, 422)
  })

  await t.test('PUSH: marking the register auto-satisfies the task, with no read from the assignee', async () => {
    const children = await roster()
    const res = await mark(children.map((c, i) => ({ studentId: c.studentId, status: i === 0 ? 'present' : i === 1 ? 'late' : 'present' })))
    assert.equal(res.status, 200)
    assert.ok(res.data.signalled >= 1, 'attendance.marked reached a subscriber')

    // read the instance straight from the store: the flag was flipped by the
    // event, not by the assignee opening anything
    const { getDb } = await import('../db.js')
    const raw = getDb().taskInstances.find((i) => i.id === instId)
    assert.equal(raw.conditionMet, true, 'the push flipped it')
    assert.ok(raw.conditionMetAt)
    assert.ok(raw.verificationId)
  })

  await t.test('the task now reflects it, and the derived Yes is enabled', async () => {
    const inst = await load()
    assert.equal(inst.condition.satisfied, true)
    assert.equal(inst.condition.derived.enabled, true)
    assert.equal(inst.condition.derived.value, 'yes')
    assert.equal(inst.condition.derived.readOnly, true, 'still read-only — it is derived, not granted')
    assert.equal(inst.can.answer, false)
    assert.match(inst.condition.message, /Attendance marked for \d+ children/)
  })

  await t.test('and it submits', async () => {
    const done = await api('POST', `/api/task-instances/${instId}/submit`, { token: anjali })
    assert.equal(done.status, 200)
    assert.equal(done.data.status, 'approved')
  })

  await t.test('EVIDENCE: what satisfied it is stored, and in the audit trail', async () => {
    const inst = await load()
    const ev = inst.completionEvidence
    assert.ok(ev, 'the occurrence carries the evidence it was accepted on')
    assert.equal(ev.moduleKey, 'attendance')
    assert.equal(ev.signalKey, 'isMarked')
    assert.ok(ev.recordIds.length > 0, 'the satisfying attendance record ids')
    assert.equal(ev.count, ev.recordIds.length)
    assert.ok(ev.checksum, 'a fingerprint of the state we accepted')
    assert.equal(ev.markedByUserId, 'u-teacher')
    assert.ok(ev.markedAt, 'when the register was marked')
    assert.ok(ev.observedAt, 'when we verified it')

    // the records it names are real attendance rows for the right register
    const { getDb } = await import('../db.js')
    const rows = getDb().attendanceRecords.filter((r) => ev.recordIds.includes(r.id))
    assert.equal(rows.length, ev.recordIds.length)
    assert.ok(rows.every((r) => r.sectionId === ANJALI_SECTION && r.date === today))

    // the verification history is queryable
    assert.ok(inst.verifications.some((v) => v.satisfied && v.source === 'push'))

    // and it is in the immutable trail, not only on a row that can be edited
    const meera = await login('superadmin@kidzonia.com')
    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    const entries = audit.filter((a) => a.action === 'instance.verified' && a.recordId === instId)
    assert.ok(entries.length, 'the verification is audited')
    // every read that satisfied it is on the record, and the FIRST one was the
    // push — the module told us before the assignee opened anything
    assert.ok(entries.some((e) => e.after.source === 'push'))
    const entry = entries.find((e) => e.after.source === 'push')
    assert.deepEqual(entry.after.recordIds, ev.recordIds)
    assert.equal(entry.after.checksum, ev.checksum)
    assert.equal(entry.after.markedByUserId, 'u-teacher')
  })
})

// ---------------------------------------------------------------------------
test('verification: pull is the authority, push is only speed', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)
  await clearRegister(ANJALI_SECTION, today)

  const makeTask = async (title) => {
    const res = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title,
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        recurrence: { freq: 'none', startDate: today },
        completionCondition: {
          nature: 'module_linked',
          moduleLinked: { moduleKey: 'attendance', signalKey: 'isMarked' },   // default bindings
        },
      },
    })
    return (await api('GET', `/api/task-instances?taskId=${res.data.id}`, { token: lakshmi })).data[0].id
  }

  await t.test('the default binding is the declared one — the assigner types nothing', async () => {
    const id = await makeTask('Attendance, default binding')
    const inst = (await api('GET', `/api/task-instances/${id}`, { token: anjali })).data
    assert.equal(
      inst.condition.summary,
      'Completes when attendance is marked for the assignee’s class on the task’s date',
    )
  })

  await t.test('a stale conditionMet flag does not get the task through', async () => {
    const id = await makeTask('Attendance, forged flag')
    const { getDb } = await import('../db.js')
    const raw = getDb().taskInstances.find((i) => i.id === id)
    // simulate the worst case: something set the flag without evidence
    raw.conditionMet = true
    raw.conditionMessage = 'looks fine to me'

    const refused = await api('POST', `/api/task-instances/${id}/submit`, { token: anjali })
    assert.equal(refused.status, 422, 'submit re-reads the signal and overrules the flag')
    assert.equal(refused.data.error, 'module_not_done')
    assert.equal(getDb().taskInstances.find((i) => i.id === id).conditionMet, false, 'and it corrects the flag')
  })

  await t.test('SWEEP: attendance marked before the task existed still resolves', async () => {
    // mark the register FIRST — no task exists yet, so no push can help
    const roster = (await api('GET', `/api/attendance?sectionId=${ANJALI_SECTION}&date=${today}`, { token: anjali })).data
    await api('POST', '/api/attendance', {
      token: anjali,
      body: { sectionId: ANJALI_SECTION, date: today, records: roster.map((c) => ({ studentId: c.studentId, status: 'present' })) },
    })

    const id = await makeTask('Attendance, marked beforehand')
    // any task read runs syncTasks(), which sweeps module-linked work
    await api('GET', '/api/tasks/my', { token: anjali })

    const inst = (await api('GET', `/api/task-instances/${id}`, { token: anjali })).data
    assert.equal(inst.condition.satisfied, true)
    assert.ok(inst.verifications.some((v) => v.source === 'sweep' || v.source === 'pull'))
    assert.equal((await api('POST', `/api/task-instances/${id}/submit`, { token: anjali })).data.status, 'approved')
  })

  await t.test('someone with no register of their own gets a clear reason, not a crash', async () => {
    // Lakshmi is a principal; she keeps no section register
    const res = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Attendance for a principal',
        target: { kind: 'position', positionIds: ['pos-lakshmi'] },
        recurrence: { freq: 'none', startDate: today },
        completionCondition: { nature: 'module_linked', moduleLinked: { moduleKey: 'attendance', signalKey: 'isMarked' } },
      },
    })
    // a principal cannot assign to herself — target her via HQ instead
    const meera = await login('superadmin@kidzonia.com')
    const hq = await api('POST', '/api/tasks', {
      token: meera,
      body: {
        title: 'Attendance for a principal',
        target: { kind: 'position', positionIds: ['pos-lakshmi'] },
        recurrence: { freq: 'none', startDate: today },
        completionCondition: { nature: 'module_linked', moduleLinked: { moduleKey: 'attendance', signalKey: 'isMarked' } },
      },
    })
    assert.equal(res.status, 403)
    assert.equal(hq.status, 201)

    const id = (await api('GET', `/api/task-instances?taskId=${hq.data.id}`, { token: meera })).data[0].id
    const inst = (await api('GET', `/api/task-instances/${id}`, { token: lakshmi })).data
    assert.equal(inst.condition.satisfied, false)
    assert.equal(inst.condition.verifiable, false, 'nothing to read is "cannot judge", not "no"')
    assert.match(inst.condition.message, /could not be resolved for this assignee/)

    const refused = await api('POST', `/api/task-instances/${id}/submit`, { token: lakshmi })
    assert.equal(refused.status, 422)
    assert.equal(refused.data.error, 'unbound_params')
  })

  await t.test('the gate never freezes the module a mandatory task depends on', async () => {
    // Yesterday's mandatory attendance task, still open: the gate is armed, and
    // the one endpoint she needs is the one it would otherwise freeze.
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
    const res = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Mark Attendance (yesterday)',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        recurrence: { freq: 'none', startDate: yesterday },
        isBlocking: true,
        dueConfig: { startDate: yesterday, dueDate: yesterday },
        completionCondition: { nature: 'module_linked', moduleLinked: { moduleKey: 'attendance', signalKey: 'isMarked' } },
      },
    })
    const id = (await api('GET', `/api/task-instances?taskId=${res.data.id}`, { token: lakshmi })).data[0].id
    const { getDb } = await import('../db.js')
    const raw = getDb().taskInstances.find((i) => i.id === id)
    raw.serviceDate = yesterday
    raw.dueAt = new Date(Date.now() - 864e5).toISOString()
    raw.status = 'overdue'
    raw.conditionMet = false

    // the gate IS armed — an unrelated write is refused
    const unrelated = await api('POST', '/api/task-categories', { token: anjali, body: { name: 'x' } })
    const blocked = await api('PUT', '/api/students/stu-1', { token: anjali, body: { firstName: 'Nope' } })
    assert.equal(blocked.status, 403)
    assert.equal(blocked.data.error, 'task_gate')
    assert.ok(unrelated.status !== 403, 'the tasks module itself is always exempt')

    // but attendance is not, because that is what she owes
    const roster = (await api('GET', `/api/attendance?sectionId=${ANJALI_SECTION}&date=${yesterday}`, { token: anjali })).data
    const marked = await api('POST', '/api/attendance', {
      token: anjali,
      body: { sectionId: ANJALI_SECTION, date: yesterday, records: roster.map((c) => ({ studentId: c.studentId, status: 'present' })) },
    })
    assert.equal(marked.status, 200, 'the module that clears the gate stays open')
    assert.equal(getDb().taskInstances.find((i) => i.id === id).conditionMet, true)

    // and once she no longer owes it, the escape closes again
    await api('POST', `/api/task-instances/${id}/submit`, { token: anjali })
    // (a teacher cannot edit a student anyway — what matters is that the refusal
    // is no longer the GATE)
    const after = await api('PUT', '/api/students/stu-1', { token: anjali, body: { firstName: 'Nope' } })
    assert.notEqual(after.data?.error, 'task_gate', 'gate lifts once the mandatory work is done')
  })

  await t.test('the register moving for somebody else does not touch this task', async () => {
    const id = await makeTask('Attendance, other register')
    // Kavya keeps Jr KG A; marking it must not satisfy Anjali's task
    const kavya = await login('teacher2@kidzonia.com')
    const roster = (await api('GET', `/api/attendance?sectionId=sec-jh-jrkg-a&date=${today}`, { token: kavya })).data
    await api('POST', '/api/attendance', {
      token: kavya,
      body: { sectionId: 'sec-jh-jrkg-a', date: today, records: roster.map((c) => ({ studentId: c.studentId, status: 'present' })) },
    })

    const { getDb } = await import('../db.js')
    const raw = getDb().taskInstances.find((i) => i.id === id)
    // Anjali's register is already marked from the sweep test above, so assert
    // on WHOSE evidence satisfied it rather than on the flag
    if (raw.conditionMet) {
      const v = getDb().taskVerifications.filter((x) => x.instanceId === id).pop()
      const rows = getDb().attendanceRecords.filter((r) => v.evidence.recordIds.includes(r.id))
      assert.ok(rows.every((r) => r.sectionId === ANJALI_SECTION), 'satisfied by her own register only')
    }
  })
})
