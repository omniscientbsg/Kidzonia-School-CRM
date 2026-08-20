import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday, addDays, endOfWeek, weekdayOf } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

test('My Tasks: buckets, self-deferral and terminal states', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)
  const weekEnd = endOfWeek(today)

  const make = (body) => api('POST', '/api/tasks', {
    token: lakshmi,
    body: { target: { kind: 'position', positionIds: ['pos-anjali'] }, ...body },
  })

  await t.test('work lands in Due today / This week / Upcoming / Overdue', async () => {
    await make({ title: 'Yesterday’s register', recurrence: { freq: 'none', startDate: addDays(today, -1) } })
    await make({ title: 'Today’s register', recurrence: { freq: 'none', startDate: today } })
    await make({ title: 'Far future audit', recurrence: { freq: 'none', startDate: addDays(weekEnd, 3) } })

    const { data } = await api('GET', '/api/tasks/my', { token: anjali })
    assert.equal(data.today, today)
    assert.equal(data.weekEnd, weekEnd)
    assert.equal(weekdayOf(data.weekEnd), 0)                       // weeks end on Sunday

    assert.ok(data.overdue.some((i) => i.title === 'Yesterday’s register'))
    assert.ok(data.dueToday.some((i) => i.title === 'Today’s register'))
    assert.ok(data.upcoming.some((i) => i.title === 'Far future audit'))

    // every bucket is disjoint — nothing is counted twice
    const ids = [...data.overdue, ...data.dueToday, ...data.thisWeek, ...data.upcoming].map((i) => i.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.ok(data.thisWeek.every((i) => i.serviceDate > today && i.serviceDate <= weekEnd))
    assert.ok(data.upcoming.every((i) => i.serviceDate > weekEnd))
  })

  await t.test('a daily task fills This week without spilling into Upcoming', async () => {
    const daily = await make({ title: 'Mark class attendance', recurrence: { freq: 'daily', startDate: today } })
    assert.equal(daily.status, 201)
    const { data } = await api('GET', '/api/tasks/my', { token: anjali })
    const mine = (rows) => rows.filter((i) => i.taskId === daily.data.id)
    assert.ok(mine(data.thisWeek).every((i) => i.serviceDate <= weekEnd))
    assert.ok(mine(data.upcoming).every((i) => i.serviceDate > weekEnd))
    assert.equal(mine(data.dueToday).length, 1)
  })

  await t.test('no approval needed → submitting completes it outright', async () => {
    const created = await make({ title: 'Water the plants', recurrence: { freq: 'none', startDate: today } })
    const inst = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: anjali })).data[0]
    const done = await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })
    assert.equal(done.status, 200)
    assert.equal(done.data.status, 'approved')                     // one terminal state…
    assert.equal(done.data.requiresApproval, false)                // …labelled "Completed" in the UI
    assert.ok(done.data.completedAt)
    assert.equal(done.data.submittedAt, done.data.completedAt)
  })

  await t.test('an N-days task can be completed any time inside its window', async () => {
    const created = await make({
      title: 'Prepare the trip list',
      dueType: 'n_days', dueConfig: { days: 3 },
      recurrence: { freq: 'none', startDate: today },
    })
    const inst = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: anjali })).data[0]
    assert.equal(inst.dueType, 'n_days')
    assert.equal(inst.dueAt, `${addDays(today, 3)}T18:29:59.999Z`)
    assert.equal(inst.status, 'assigned')                          // not overdue despite being dated today

    const started = await api('POST', `/api/task-instances/${inst.id}/start`, { token: anjali })
    assert.equal(started.data.status, 'in_progress')
    const submitted = await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })
    assert.equal(submitted.status, 200)
  })

  await t.test('assignee may defer an N-days task inside its window, but no further', async () => {
    const created = await make({
      title: 'Laminate the name cards',
      dueType: 'n_days', dueConfig: { days: 4 },
      recurrence: { freq: 'none', startDate: today },
    })
    const inst = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: anjali })).data[0]
    assert.equal(inst.selfDeferLimit, addDays(today, 4))
    assert.equal(inst.can.defer, true)

    const tooFar = await api('POST', `/api/task-instances/${inst.id}/defer`, {
      token: anjali, body: { to: addDays(today, 9), reason: 'Busy week' },
    })
    assert.equal(tooFar.status, 422)
    assert.equal(tooFar.data.error, 'outside_window')

    const noReason = await api('POST', `/api/task-instances/${inst.id}/defer`, { token: anjali, body: { to: addDays(today, 2) } })
    assert.equal(noReason.status, 422)

    const ok = await api('POST', `/api/task-instances/${inst.id}/defer`, {
      token: anjali, body: { to: addDays(today, 2), reason: 'Laminator is booked until Thursday' },
    })
    assert.equal(ok.status, 200)
    assert.equal(ok.data.status, 'deferred')
    assert.equal(ok.data.deferredTo, addDays(today, 2))

    const { data: my } = await api('GET', '/api/tasks/my', { token: anjali })
    assert.ok(my.deferred.some((i) => i.id === inst.id))
    assert.ok(!my.dueToday.some((i) => i.id === inst.id))
  })

  await t.test('an end-of-day task cannot be self-deferred at all', async () => {
    const created = await make({ title: 'Lock the store room', recurrence: { freq: 'none', startDate: today } })
    const inst = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: anjali })).data[0]
    assert.equal(inst.selfDeferLimit, null)
    assert.equal(inst.can.defer, false)

    const refused = await api('POST', `/api/task-instances/${inst.id}/defer`, {
      token: anjali, body: { to: addDays(today, 1), reason: 'Later' },
    })
    assert.equal(refused.status, 403)

    // the manager above can still move it
    const byBoss = await api('POST', `/api/task-instances/${inst.id}/defer`, {
      token: lakshmi, body: { to: addDays(today, 1), reason: 'Keys with the electrician' },
    })
    assert.equal(byBoss.status, 200)
  })

  await t.test('a mandatory task is never self-deferrable, even with an N-days window', async () => {
    const created = await make({
      title: 'Daily safety sign-off',
      dueType: 'n_days', dueConfig: { days: 3 },
      isBlocking: true,
      recurrence: { freq: 'none', startDate: today },
    })
    const inst = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: anjali })).data[0]
    assert.equal(inst.selfDeferLimit, null)                        // would otherwise lift her own logout gate
    const refused = await api('POST', `/api/task-instances/${inst.id}/defer`, {
      token: anjali, body: { to: addDays(today, 1), reason: 'Tomorrow' },
    })
    assert.equal(refused.status, 403)
    assert.match(refused.data.message, /mandatory/i)
  })

  await t.test('every transition is audited', async () => {
    const meera = await login('superadmin@kidzonia.com')
    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    for (const action of ['instance.start', 'instance.submit', 'instance.defer']) {
      assert.ok(audit.some((a) => a.action === action), `${action} was not audited`)
    }
    const deferRow = audit.find((a) => a.action === 'instance.defer' && a.reason?.includes('Laminator'))
    assert.equal(deferRow.userId, 'u-teacher')                     // the assignee's own deferral
    assert.equal(deferRow.positionId, 'pos-anjali')
  })
})
