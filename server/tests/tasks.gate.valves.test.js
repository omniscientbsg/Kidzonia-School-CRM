import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday, addDays } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

test('logout gate: what blocks, and the safety valves', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const meera = await login('superadmin@kidzonia.com')
  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const kavya = await login('teacher2@kidzonia.com')
  const today = localToday(TZ)
  const mk = (body) => api('POST', '/api/tasks', {
    token: lakshmi,
    body: { target: { kind: 'position', positionIds: ['pos-anjali'] }, recurrence: { freq: 'none', startDate: today }, ...body },
  })

  await t.test('a future-window mandatory task does NOT block today', async () => {
    await mk({ title: 'Three-day stock audit', isBlocking: true, dueType: 'n_days', dueConfig: { days: 3 } })
    const check = await api('GET', '/api/tasks/logout-check', { token: anjali })
    assert.equal(check.data.blocked, false)               // deadline is 3 days out
    assert.equal((await api('POST', '/api/auth/logout', { token: anjali })).status, 200)
  })

  await t.test('a non-blocking end-of-day task does NOT block', async () => {
    await mk({ title: 'Tidy the book corner', isBlocking: false })
    assert.equal((await api('GET', '/api/tasks/logout-check', { token: anjali })).data.blocked, false)
  })

  await t.test('a mandatory end-of-day task blocks, and names what is outstanding', async () => {
    await mk({ title: 'Close the attendance register', isBlocking: true })
    const check = await api('GET', '/api/tasks/logout-check', { token: anjali })
    assert.equal(check.data.blocked, true)
    assert.equal(check.data.instances.length, 1)
    assert.equal(check.data.instances[0].title, 'Close the attendance register')

    const out = await api('POST', '/api/auth/logout', { token: anjali })
    assert.equal(out.status, 409)
    assert.match(out.data.message, /Finish 1 mandatory task/)
  })

  await t.test('the window task starts blocking once its deadline arrives', async () => {
    const created = await mk({ title: 'Window closes today', isBlocking: true, dueType: 'n_days', dueConfig: { days: 2 } })
    const inst = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: lakshmi })).data[0]
    const { getDb } = await import('../db.js')
    getDb().taskInstances.find((i) => i.id === inst.id).dueAt = `${today}T18:29:59.999Z`
    const check = await api('GET', '/api/tasks/logout-check', { token: anjali })
    assert.ok(check.data.instances.some((i) => i.title === 'Window closes today'))
  })

  await t.test('VALVE 1: an ancestor releases the person for the day', async () => {
    const noReason = await api('POST', '/api/tasks/gate/release', { token: lakshmi, body: { userId: 'u-teacher' } })
    assert.equal(noReason.status, 422)
    assert.equal(noReason.data.error, 'reason_required')

    const byPeer = await api('POST', '/api/tasks/gate/release', { token: kavya, body: { userId: 'u-teacher', reason: 'mate' } })
    assert.equal(byPeer.status, 403)

    const released = await api('POST', '/api/tasks/gate/release', {
      token: lakshmi, body: { userId: 'u-teacher', reason: 'Sent home unwell' },
    })
    assert.equal(released.status, 201)
    assert.ok(released.data.stillOutstanding >= 1)         // work is NOT wiped, only the lock

    const check = await api('GET', '/api/tasks/logout-check', { token: anjali })
    assert.equal(check.data.blocked, false)
    assert.equal(check.data.released, true)
    assert.equal(check.data.release.by, 'Lakshmi Devi')
    assert.equal((await api('POST', '/api/auth/logout', { token: anjali })).status, 200)

    assert.ok((await api('GET', '/api/notifications', { token: anjali })).data.some((n) => n.title === 'You can sign off'))
    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    assert.ok(audit.some((a) => a.action === 'gate.override' && a.reason === 'Sent home unwell'))
  })

  await t.test('a release covers one day only', async () => {
    const { getDb } = await import('../db.js')
    getDb().taskGateReleases.forEach((r) => { r.forDate = addDays(today, -1) })
    const check = await api('GET', '/api/tasks/logout-check', { token: anjali })
    assert.equal(check.data.blocked, true)
    assert.equal(check.data.released, false)
  })

  await t.test('VALVE 2: the person can ask to be released; everyone above is told', async () => {
    const bare = await api('POST', '/api/tasks/gate/request-release', { token: anjali, body: {} })
    assert.equal(bare.status, 422)

    const asked = await api('POST', '/api/tasks/gate/request-release', {
      token: anjali, body: { reason: 'Family emergency, have to leave now' },
    })
    assert.equal(asked.status, 201)
    // never dependent on one manager being at their desk
    assert.ok(asked.data.notified.includes('Lakshmi Devi'))
    assert.ok(asked.data.notified.includes('Meera Krishnan'))

    for (const token of [lakshmi, meera]) {
      const notifs = (await api('GET', '/api/notifications', { token })).data
      assert.ok(notifs.some((n) => n.title === 'Anjali Rao is asking to sign off'))
    }
    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    assert.ok(audit.some((a) => a.action === 'gate.release_requested' && /Family emergency/.test(a.reason)))
  })

  await t.test('VALVE 3: the tasks module itself is never blocked', async () => {
    const { getDb } = await import('../db.js')
    for (const i of getDb().taskInstances) {
      if (i.assigneeUserId === 'u-teacher' && i.isBlocking) i.dueAt = `${addDays(today, -1)}T18:29:59.999Z`
    }
    assert.equal((await api('GET', '/api/tasks/logout-check', { token: anjali })).data.armed, true)

    const blocked = await api('POST', '/api/attendance', {
      token: anjali, body: { sectionId: 'sec-jh-nursery-a', date: today, entries: [] },
    })
    assert.equal(blocked.status, 403)
    assert.match(blocked.data.message, /ask your manager to defer or release you/)

    // everything needed to finish the work stays open
    const inst = (await api('GET', '/api/tasks/my', { token: anjali })).data.overdue[0]
    assert.equal((await api('POST', `/api/task-instances/${inst.id}/start`, { token: anjali })).status, 200)
    assert.equal((await api('GET', '/api/students', { token: anjali })).status, 200)
    assert.equal((await api('POST', '/api/tasks/gate/request-release', { token: anjali, body: { reason: 'still stuck' } })).status, 201)
    assert.equal((await api('POST', '/api/notifications/read-all', { token: anjali })).status, 200)
  })

  await t.test('the blocked list is discoverable to managers, and bounded by the tree', async () => {
    const mine = await api('GET', '/api/tasks/gate/blocked', { token: lakshmi })
    assert.equal(mine.status, 200)
    const row = mine.data.find((r) => r.userName === 'Anjali Rao')
    assert.ok(row)
    assert.equal(row.armed, true)
    assert.equal(row.tier, 'Teacher')
    assert.ok(row.instances.length >= 1)

    const sunil = await login('principal.gb@kidzonia.com')
    assert.equal((await api('GET', '/api/tasks/gate/blocked', { token: sunil })).data.length, 0)
    assert.equal((await api('GET', '/api/tasks/gate/blocked', { token: kavya })).data.length, 0)
  })
})
