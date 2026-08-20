import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday, addDays, weekdayOf } from '../tasks/time.js'
import { occurrencesBetween } from '../tasks/recurrence.js'

const TZ = 'Asia/Kolkata'

test('recurrence: skip-holidays and weekly offs', async (t) => {
  await t.test('a holiday in the middle of a daily run is skipped', () => {
    const holidays = new Set(['2026-08-15'])
    const all = occurrencesBetween({ freq: 'daily', startDate: '2026-08-13' }, '2026-08-13', '2026-08-17')
    assert.deepEqual(all, ['2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17'])

    const skipping = occurrencesBetween(
      { freq: 'daily', startDate: '2026-08-13', skipNonWorkingDays: true },
      '2026-08-13', '2026-08-17',
      { workWeek: [1, 2, 3, 4, 5, 6], holidays }
    )
    assert.ok(!skipping.includes('2026-08-15'))     // Independence Day
    assert.ok(!skipping.some((d) => weekdayOf(d) === 0))   // Sunday is a weekly off
    assert.deepEqual(skipping, ['2026-08-13', '2026-08-14', '2026-08-17'])
  })

  await t.test('a template that does not opt in still fires on holidays', () => {
    const rows = occurrencesBetween(
      { freq: 'daily', startDate: '2026-08-15', skipNonWorkingDays: false },
      '2026-08-15', '2026-08-16',
      { workWeek: [1, 2, 3, 4, 5, 6], holidays: new Set(['2026-08-15']) }
    )
    assert.deepEqual(rows, ['2026-08-15', '2026-08-16'])
  })

  await t.test('a weekly task whose day falls on a holiday simply has no occurrence', () => {
    // 2026-08-15 is a Saturday
    assert.equal(weekdayOf('2026-08-15'), 6)
    const rows = occurrencesBetween(
      { freq: 'weekly', byWeekday: [6], startDate: '2026-08-08', skipNonWorkingDays: true },
      '2026-08-08', '2026-08-29',
      { workWeek: [1, 2, 3, 4, 5, 6], holidays: new Set(['2026-08-15']) }
    )
    assert.ok(!rows.includes('2026-08-15'))
    assert.ok(rows.includes('2026-08-22'))
  })
})

test('the generator runs on a schedule, and stays idempotent when both paths run', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const { runScheduledSync, startScheduler, stopScheduler, schedulerStatus } = await import('../tasks/scheduler.js')
  const lakshmi = await login('principal@kidzonia.com')
  const today = localToday(TZ)

  const daily = await api('POST', '/api/tasks', {
    token: lakshmi,
    body: {
      title: 'Mark class attendance',
      target: { kind: 'position', positionIds: ['pos-anjali'] },
      recurrence: { freq: 'daily', startDate: today },
      isBlocking: true,
    },
  })
  const count = async () => (await api('GET', `/api/task-instances?taskId=${daily.data.id}`, { token: lakshmi })).data.length

  await t.test('a scheduled run creates nothing that the save already created', async () => {
    const before = await count()
    assert.equal(before, 8)                          // today + 7 days ahead
    const run = runScheduledSync({ quiet: true })
    assert.equal(run.created, 0)
    assert.equal(await count(), before)
  })

  await t.test('repeated runs never duplicate', async () => {
    const before = await count()
    for (let i = 0; i < 3; i++) runScheduledSync({ quiet: true })
    assert.equal(await count(), before)
    const ids = (await api('GET', `/api/task-instances?taskId=${daily.data.id}`, { token: lakshmi })).data.map((i) => i.id)
    assert.equal(new Set(ids).size, ids.length)      // deterministic ids, no collisions
  })

  await t.test('the scheduled run revives deferred work when its day arrives', async () => {
    const inst = (await api('GET', `/api/task-instances?taskId=${daily.data.id}&from=${today}&to=${today}`, { token: lakshmi })).data[0]

    // the API refuses a deferral that does not move the date forward
    const sameDay = await api('POST', `/api/task-instances/${inst.id}/defer`, { token: lakshmi, body: { to: today, reason: 'test' } })
    assert.equal(sameDay.status, 422)

    const deferred = await api('POST', `/api/task-instances/${inst.id}/defer`, { token: lakshmi, body: { to: addDays(today, 2), reason: 'Class trip' } })
    assert.equal(deferred.status, 200)
    assert.equal(runScheduledSync({ quiet: true }).revived, 0)     // not yet due back

    // wind the clock forward the only way a test can: make its return date today
    const { getDb } = await import('../db.js')
    getDb().taskInstances.find((i) => i.id === inst.id).deferredTo = today

    const run = runScheduledSync({ quiet: true })
    assert.ok(run.revived >= 1)
    const after = (await api('GET', `/api/task-instances/${inst.id}`, { token: lakshmi })).data
    assert.equal(after.status, 'assigned')
    assert.equal(after.serviceDate, today)
  })

  await t.test('start/stop is safe to call repeatedly', () => {
    startScheduler({ minutes: 60 })
    const first = schedulerStatus()
    assert.equal(first.running, true)
    startScheduler({ minutes: 60 })                  // no second timer
    assert.equal(schedulerStatus().running, true)
    stopScheduler()
    assert.equal(schedulerStatus().running, false)
    stopScheduler()                                  // idempotent
  })
})

test('editing a template changes the future only', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)
  const tomorrow = addDays(today, 1)

  const created = await api('POST', '/api/tasks', {
    token: lakshmi,
    body: {
      title: 'Mark class attendance',
      target: { kind: 'position', positionIds: ['pos-anjali'] },
      priority: 'normal',
      recurrence: { freq: 'daily', startDate: today },
    },
  })
  const taskId = created.data.id
  const rows = async () => (await api('GET', `/api/task-instances?taskId=${taskId}`, { token: lakshmi })).data
  const on = (list, date) => list.find((i) => i.serviceDate === date)

  // today's occurrence is already in flight
  const todayInst = on(await rows(), today)
  await api('POST', `/api/task-instances/${todayInst.id}/start`, { token: anjali })

  await t.test('in-flight and past occurrences keep the rules they were given', async () => {
    const res = await api('PUT', `/api/tasks/${taskId}`, {
      token: lakshmi,
      body: { title: 'Mark class attendance (with sign-off)', priority: 'urgent', isBlocking: true },
    })
    assert.equal(res.status, 200)
    assert.ok(res.data.propagation.updated >= 7)

    const after = await rows()
    const stillToday = on(after, today)
    assert.equal(stillToday.status, 'in_progress')
    assert.equal(stillToday.title, 'Mark class attendance')     // untouched history
    assert.equal(stillToday.priority, 'normal')
    assert.equal(stillToday.isBlocking, false)

    const future = on(after, tomorrow)
    assert.equal(future.title, 'Mark class attendance (with sign-off)')
    assert.equal(future.priority, 'urgent')
    assert.equal(future.isBlocking, true)
  })

  await t.test('narrowing the rule withdraws future occurrences that no longer apply', async () => {
    const before = await rows()
    const futureCount = before.filter((i) => i.serviceDate > today).length
    assert.ok(futureCount >= 7)

    // daily -> Mondays only
    const res = await api('PUT', `/api/tasks/${taskId}`, {
      token: lakshmi,
      body: { recurrence: { freq: 'weekly', byWeekday: [1], startDate: today } },
    })
    assert.equal(res.status, 200)
    assert.ok(res.data.propagation.removed > 0)

    const after = await rows()
    assert.ok(after.filter((i) => i.serviceDate > today).every((i) => weekdayOf(i.serviceDate) === 1))
    assert.ok(on(after, today))                                  // today survives untouched
    assert.equal(on(after, today).status, 'in_progress')
  })

  await t.test('an end date stops future generation', async () => {
    await api('PUT', `/api/tasks/${taskId}`, {
      token: lakshmi,
      body: { recurrence: { freq: 'daily', startDate: today, endDate: addDays(today, 2) } },
    })
    const after = await rows()
    assert.ok(after.every((i) => i.serviceDate <= addDays(today, 2)))
    assert.ok(on(after, addDays(today, 2)))
    assert.ok(!on(after, addDays(today, 3)))
  })

  await t.test('pausing withdraws untouched future work; resuming puts it back', async () => {
    const paused = await api('POST', `/api/tasks/${taskId}/pause`, { token: lakshmi })
    assert.equal(paused.data.status, 'paused')
    const during = await rows()
    assert.equal(during.filter((i) => i.serviceDate > today).length, 0)
    assert.equal(on(during, today).status, 'in_progress')         // in-flight work is not withdrawn

    const resumed = await api('POST', `/api/tasks/${taskId}/pause`, { token: lakshmi })
    assert.equal(resumed.data.status, 'active')
    assert.ok((await rows()).filter((i) => i.serviceDate > today).length > 0)
  })

  await t.test('the edit is audited with what it propagated', async () => {
    const meera = await login('superadmin@kidzonia.com')
    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    const row = audit.find((a) => a.action === 'task.update' && a.after?.propagation)
    assert.ok(row)
    assert.equal(typeof row.after.propagation.updated, 'number')
    assert.equal(typeof row.after.propagation.removed, 'number')
    assert.equal(typeof row.after.propagation.created, 'number')
  })
})

