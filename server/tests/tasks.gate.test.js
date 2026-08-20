import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday, addDays } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

test('tasks: mandatory tasks gate logout, server-side', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()   // demo board out of the way; these tests build their own

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const kavya = await login('teacher2@kidzonia.com')
  const today = localToday(TZ)

  await t.test('no mandatory work — logout just works', async () => {
    const { status, data } = await api('POST', '/api/auth/logout', { token: kavya })
    assert.equal(status, 200)
    assert.deepEqual(data, { ok: true })
  })

  const blocking = await api('POST', '/api/tasks', {
    token: lakshmi,
    body: {
      title: 'Close the attendance register',
      target: { kind: 'position', positionIds: ['pos-anjali'] },
      dueType: 'end_of_day',
      recurrence: { freq: 'none', startDate: today },
      isBlocking: true,
    },
  })
  const instId = (await api('GET', `/api/task-instances?taskId=${blocking.data.id}`, { token: lakshmi })).data[0].id

  await t.test("today's open mandatory task blocks logout with the reason", async () => {
    const { status, data } = await api('POST', '/api/auth/logout', { token: anjali })
    assert.equal(status, 409)
    assert.equal(data.error, 'blocking_tasks')
    assert.equal(data.instances.length, 1)
    assert.equal(data.instances[0].title, 'Close the attendance register')
    assert.equal(data.instances[0].assignedByName, 'Lakshmi Devi')

    const check = await api('GET', '/api/tasks/logout-check', { token: anjali })
    assert.equal(check.data.blocked, true)
    assert.equal(check.data.armed, false)          // same day: not yet a hard gate
  })

  await t.test('same-day gate does NOT block other work', async () => {
    const marking = await api('POST', '/api/attendance', {
      token: anjali,
      body: { sectionId: 'sec-jh-nursery-a', date: today, entries: [] },
    })
    assert.notEqual(marking.status, 403)
  })

  await t.test('finishing it opens the door', async () => {
    await api('POST', `/api/task-instances/${instId}/submit`, { token: anjali })
    const { status } = await api('POST', '/api/auth/logout', { token: anjali })
    assert.equal(status, 200)
  })

  await t.test('submitted work never traps a junior waiting for approval', async () => {
    const needsOk = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Daily safety walkthrough',
        target: { kind: 'position', positionIds: ['pos-kavya'] },
        recurrence: { freq: 'none', startDate: today },
        isBlocking: true,
        requiresApproval: true,
      },
    })
    const id = (await api('GET', `/api/task-instances?taskId=${needsOk.data.id}`, { token: lakshmi })).data[0].id
    assert.equal((await api('POST', '/api/auth/logout', { token: kavya })).status, 409)
    await api('POST', `/api/task-instances/${id}/submit`, { token: kavya })
    assert.equal((await api('POST', '/api/auth/logout', { token: kavya })).status, 200)   // pending approval, not pending work
  })

  await t.test('walking out anyway: yesterday’s open mandatory task freezes writes', async () => {
    const yesterday = addDays(today, -1)
    const missed = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Yesterday’s incident report',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        recurrence: { freq: 'none', startDate: yesterday },
        isBlocking: true,
      },
    })
    const id = (await api('GET', `/api/task-instances?taskId=${missed.data.id}`, { token: lakshmi })).data[0].id

    const check = await api('GET', '/api/tasks/logout-check', { token: anjali })
    assert.equal(check.data.armed, true)

    // writes elsewhere in the API are refused…
    const marking = await api('POST', '/api/attendance', {
      token: anjali,
      body: { sectionId: 'sec-jh-nursery-a', date: today, entries: [] },
    })
    assert.equal(marking.status, 403)
    assert.equal(marking.data.error, 'task_gate')

    // …reads stay open so they can see why…
    const reads = await api('GET', '/api/students', { token: anjali })
    assert.equal(reads.status, 200)

    // …and the tasks module itself stays reachable so it can be cleared
    const started = await api('POST', `/api/task-instances/${id}/start`, { token: anjali })
    assert.equal(started.status, 200)

    await api('POST', `/api/task-instances/${id}/submit`, { token: anjali })
    const afterFix = await api('POST', '/api/attendance', {
      token: anjali,
      body: { sectionId: 'sec-jh-nursery-a', date: today, entries: [] },
    })
    assert.notEqual(afterFix.status, 403)
  })

  await t.test('a manager can defer to lift the gate, and it is audited', async () => {
    const yesterday = addDays(today, -1)
    const missed = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Yesterday’s laundry count',
        target: { kind: 'position', positionIds: ['pos-kavya'] },
        recurrence: { freq: 'none', startDate: yesterday },
        isBlocking: true,
      },
    })
    const id = (await api('GET', `/api/task-instances?taskId=${missed.data.id}`, { token: lakshmi })).data[0].id
    assert.equal((await api('GET', '/api/tasks/logout-check', { token: kavya })).data.armed, true)

    const deferred = await api('POST', `/api/task-instances/${id}/defer`, {
      token: lakshmi,
      body: { to: addDays(today, 1), reason: 'Linen delivery was late' },
    })
    assert.equal(deferred.status, 200)

    const check = await api('GET', '/api/tasks/logout-check', { token: kavya })
    assert.equal(check.data.armed, false)
    assert.equal((await api('POST', '/api/auth/logout', { token: kavya })).status, 200)

    const audit = (await api('GET', '/api/audit-log', { token: await login('superadmin@kidzonia.com') })).data
    assert.ok(audit.some((a) => a.action === 'instance.defer' && a.reason === 'Linen delivery was late'))
    assert.ok(audit.some((a) => a.action === 'gate.block'))
  })

  await t.test('a node can switch the gate off entirely', async () => {
    const meera = await login('superadmin@kidzonia.com')
    const yesterday = addDays(today, -1)
    const missed = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Optional evening checklist',
        target: { kind: 'position', positionIds: ['pos-kavya'] },
        recurrence: { freq: 'none', startDate: yesterday },
        isBlocking: true,
      },
    })
    await api('GET', `/api/task-instances?taskId=${missed.data.id}`, { token: lakshmi })
    assert.equal((await api('GET', '/api/tasks/logout-check', { token: kavya })).data.armed, true)

    await api('PUT', '/api/org/nodes/node-sch-jh', { token: meera, body: { settings: { blockingLogoutEnabled: false } } })
    const check = await api('GET', '/api/tasks/logout-check', { token: kavya })
    assert.equal(check.data.blocked, false)
    assert.equal((await api('POST', '/api/auth/logout', { token: kavya })).status, 200)

    await api('PUT', '/api/org/nodes/node-sch-jh', { token: meera, body: { settings: { blockingLogoutEnabled: true } } })
  })

  await t.test('login hands back the outstanding list', async () => {
    const fresh = await api('POST', '/api/auth/login', { body: { email: 'teacher2@kidzonia.com', password: 'password' } })
    assert.equal(fresh.status, 200)
    assert.ok(Array.isArray(fresh.data.blockingTasks))
    assert.ok(fresh.data.blockingTasks.some((i) => i.title === 'Optional evening checklist'))
    assert.equal(fresh.data.taskGateArmed, true)
  })
})
