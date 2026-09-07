// Deferring moves the occurrence to another day. Both of its dates have to move
// with it, through the SAME functions generation uses.
//
// They did not. Defer wrote the shift end for every dueType, so moving a
// "by 3pm" task silently turned it into "by end of day"; and it left
// `expiresAt` behind entirely, so a deferred task with a closing time was
// already past it and closed the instant it revived.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday, addDays, localDate, DEFAULT_TZ } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

test('deferring carries both dates with it', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)
  const tomorrow = addDays(today, 1)
  const { getDb } = await import('../db.js')

  const create = (body) => api('POST', '/api/tasks', {
    token: lakshmi,
    body: {
      target: { positionIds: ['pos-anjali'], followJoiners: false },
      recurrence: { freq: 'none', startDate: today },
      ...body,
    },
  })
  const firstInstance = async (taskId) => (await api('GET', `/api/task-instances?taskId=${taskId}`, { token: lakshmi })).data[0]
  const defer = (id, to) => api('POST', `/api/task-instances/${id}/defer`, {
    token: lakshmi, body: { to, reason: 'Anjali is out this afternoon' },
  })

  await t.test('a clock deadline stays a clock deadline on the new day', async () => {
    const created = await create({
      title: 'Bank run',
      dueType: 'at_time',
      dueConfig: { startDate: today, dueDate: today, time: '15:00' },
    })
    assert.equal(created.status, 201)
    const inst = await firstInstance(created.data.id)
    // 15:00 IST is 09:30Z — that is the whole point of the task
    assert.equal(inst.dueAt.slice(11, 16), '09:30')

    const moved = await defer(inst.id, tomorrow)
    assert.equal(moved.status, 200)
    assert.equal(moved.data.deferredTo, tomorrow)
    assert.equal(
      moved.data.dueAt.slice(11, 16), '09:30',
      '"by 3pm" means 3pm on whatever day it lands, not the end of that day',
    )
    assert.equal(localDate(TZ, moved.data.dueAt), tomorrow)
  })

  await t.test('an end-of-day deadline still lands on the new day’s shift end', async () => {
    const created = await create({ title: 'Tidy the corner' })
    const inst = await firstInstance(created.data.id)
    const moved = await defer(inst.id, tomorrow)
    assert.equal(moved.status, 200)
    assert.equal(localDate(TZ, moved.data.dueAt), tomorrow)
  })

  await t.test('THE OTHER ONE: the closing time moves too, or it closes on revival', async () => {
    const created = await create({ title: 'Closes tonight', expiry: { mode: 'end_of_day' } })
    const inst = await firstInstance(created.data.id)
    assert.equal(localDate(TZ, inst.expiresAt), today)

    const moved = await defer(inst.id, tomorrow)
    assert.equal(moved.status, 200)
    assert.equal(
      localDate(TZ, moved.data.expiresAt), tomorrow,
      'it closes at the end of the day it was moved TO',
    )

    // revive it the way syncTasks does, then sweep: it must survive
    const { reviveDeferred, expireStale } = await import('../tasks/generate.js')
    const raw = getDb().taskInstances.find((i) => i.id === inst.id)
    raw.deferredTo = today
    assert.equal(reviveDeferred().length, 1)
    assert.equal(getDb().taskInstances.find((i) => i.id === inst.id).status, 'assigned')
    assert.deepEqual(expireStale().map((r) => r.id), [], 'not closed the moment it came back')
  })

  await t.test('a grace period is measured from the NEW deadline, not the old one', async () => {
    const created = await create({ title: 'Three days of grace', expiry: { mode: 'after_days', days: 3 } })
    const inst = await firstInstance(created.data.id)
    assert.equal(localDate(TZ, inst.expiresAt), addDays(today, 3))

    const moved = await defer(inst.id, tomorrow)
    assert.equal(localDate(TZ, moved.data.expiresAt), addDays(tomorrow, 3))
  })

  await t.test('a task that never closes still never closes', async () => {
    const created = await create({ title: 'Waits for them' })
    const inst = await firstInstance(created.data.id)
    const moved = await defer(inst.id, tomorrow)
    assert.equal(moved.data.expiresAt, null)
  })

  await t.test('deferring clears the overdue and closed stamps, so the sweeps re-fire', async () => {
    const created = await create({ title: 'Late already', expiry: { mode: 'end_of_day' } })
    const inst = await firstInstance(created.data.id)
    const raw = getDb().taskInstances.find((i) => i.id === inst.id)
    raw.status = 'overdue'
    raw.overdueAt = new Date().toISOString()

    const moved = await defer(inst.id, tomorrow)
    assert.equal(moved.status, 200)
    assert.equal(moved.data.overdueAt, null)
    assert.equal(moved.data.expiredAt, null)
  })

  await t.test('the assignee still cannot move it outside their own window', async () => {
    const created = await create({
      title: 'Two days to do it',
      dueType: 'n_days',
      dueConfig: { startDate: today, dueDate: today, days: 2 },
    })
    const inst = await firstInstance(created.data.id)
    const tooFar = await api('POST', `/api/task-instances/${inst.id}/defer`, {
      token: anjali, body: { to: addDays(today, 9), reason: 'later please' },
    })
    assert.equal(tooFar.status, 422)
    assert.equal(tooFar.data.error, 'outside_window')

    const ok = await api('POST', `/api/task-instances/${inst.id}/defer`, {
      token: anjali, body: { to: addDays(today, 1), reason: 'tomorrow suits better' },
    })
    assert.equal(ok.status, 200)
    assert.equal(localDate(inst.tz || DEFAULT_TZ, ok.data.dueAt), addDays(today, 1))
  })
})
