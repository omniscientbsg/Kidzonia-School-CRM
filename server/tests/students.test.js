import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login } from './helpers.js'

test('students: attendance alerts and leave workflow', async (t) => {
  await startServer()
  t.after(stopServer)
  const teacher = await login('teacher@kidzonia.com')
  const principal = await login('principal@kidzonia.com')
  const parent = await login('parent@kidzonia.com') // Priya Sharma — Aarav (stu-1) + Anaya (stu-11)

  await t.test('flow 2: marking absent notifies the guardian', async () => {
    // stu-3 (Diya Iyer) belongs to parent3@example.com
    const save = await api('POST', '/api/attendance', {
      token: teacher,
      body: { sectionId: 'sec-jh-nursery-a', date: '2099-01-10', records: [{ studentId: 'stu-3', status: 'absent' }] },
    })
    assert.equal(save.status, 200)
    assert.deepEqual(save.data.notified, ['stu-3'])
    const diyaParent = await login('parent3@example.com')
    const { data: notifs } = await api('GET', '/api/notifications', { token: diyaParent })
    assert.ok(notifs.some((n) => n.type === 'attendance' && n.body.includes('2099-01-10')))
  })

  await t.test('re-saving same status does not duplicate the alert', async () => {
    const again = await api('POST', '/api/attendance', {
      token: teacher,
      body: { sectionId: 'sec-jh-nursery-a', date: '2099-01-10', records: [{ studentId: 'stu-3', status: 'absent' }] },
    })
    assert.deepEqual(again.data.notified, [])
  })

  await t.test('parent sees both children under one login', async () => {
    const { data } = await api('GET', '/api/parent/children', { token: parent })
    assert.equal(data.length, 2)
    const names = data.map((c) => c.firstName).sort()
    assert.deepEqual(names, ['Aarav', 'Anaya'])
  })

  await t.test('parent cannot touch another family\'s child', async () => {
    const { status } = await api('GET', '/api/parent/children/stu-3/attendance', { token: parent })
    assert.equal(status, 403)
  })

  await t.test('flow 5: parent leave request → approval → attendance reflects leave', async () => {
    const create = await api('POST', '/api/parent/leave-requests', {
      token: parent,
      body: { studentId: 'stu-1', fromDate: '2099-02-01', toDate: '2099-02-02', reason: 'Travel' },
    })
    assert.equal(create.status, 201)
    const decide = await api('POST', `/api/leave-requests/${create.data.id}/decide`, {
      token: principal, body: { status: 'approved' },
    })
    assert.equal(decide.status, 200)
    const roster = await api('GET', '/api/attendance?sectionId=sec-jh-nursery-a&date=2099-02-01', { token: teacher })
    const aarav = roster.data.find((r) => r.studentId === 'stu-1')
    assert.equal(aarav.status, 'leave')
    const summary = await api('GET', '/api/parent/children/stu-1/attendance?month=2099-02', { token: parent })
    assert.equal(summary.data.counts.leave, 2)
  })
})
