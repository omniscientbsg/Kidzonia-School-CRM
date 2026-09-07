// Three different dates, and they were all being called "the deadline".
//
//   dueAt               the deadline    -> overdue. STILL SUBMITTABLE.
//   expiresAt           it closes       -> expired. Terminal.
//   recurrence.endDate  stop repeating  -> no new occurrences.
//
// Before this there was only `dueAt`, so a task somebody missed sat on their
// list for ever and went on holding their sign-off — including work that could
// no longer be done at all.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday, addDays, localDate, DEFAULT_TZ } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

test('expiry: late is not the same as closed', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)

  const { getDb } = await import('../db.js')
  const { expireStale, refreshOverdue } = await import('../tasks/generate.js')

  const create = (body) => api('POST', '/api/tasks', {
    token: lakshmi,
    body: {
      target: { positionIds: ['pos-anjali'], followJoiners: false },
      recurrence: { freq: 'none', startDate: today },
      ...body,
    },
  })
  const firstInstance = async (taskId) => (await api('GET', `/api/task-instances?taskId=${taskId}`, { token: lakshmi })).data[0]

  await t.test('every existing task carries expiry `never` — nothing changes for them', async () => {
    const created = await create({ title: 'Nothing said about closing' })
    assert.deepEqual(created.data.expiry, { mode: 'never', days: null })
    const inst = await firstInstance(created.data.id)
    assert.equal(inst.expiresAt, null, 'no closing time at all')
  })

  await t.test('end_of_day closes at the end of the CALENDAR day, not at the deadline', async () => {
    const created = await create({ title: 'Fire drill', expiry: { mode: 'end_of_day' } })
    const inst = await firstInstance(created.data.id)
    assert.ok(inst.expiresAt, 'it has a closing time')
    // the deadline and the closing time are DIFFERENT instants — that is the
    // whole point. With a shift end at 16:00 they would otherwise coincide and
    // the grace period would be nothing at all.
    assert.ok(Date.parse(inst.expiresAt) >= Date.parse(inst.dueAt))
    // and it still lands on the day the task is for: the gate, the day-end
    // roll-up and the end-of-day nudge all read that
    assert.equal(localDate(inst.tz || DEFAULT_TZ, inst.expiresAt), inst.serviceDate)
  })

  await t.test('after_days gives that many days of grace past the deadline', async () => {
    const created = await create({ title: 'Stock take', expiry: { mode: 'after_days', days: 3 } })
    assert.deepEqual(created.data.expiry, { mode: 'after_days', days: 3 })
    const inst = await firstInstance(created.data.id)
    assert.equal(localDate(inst.tz || DEFAULT_TZ, inst.expiresAt), addDays(inst.serviceDate, 3))
  })

  await t.test('after_days without a number is refused rather than guessed', async () => {
    const bad = await create({ title: 'How long?', expiry: { mode: 'after_days', days: 0 } })
    assert.equal(bad.status, 422)
    assert.match(bad.data.message, /whole number of days/)

    const worse = await create({ title: 'Eh?', expiry: { mode: 'whenever' } })
    assert.equal(worse.status, 422)
    assert.match(worse.data.message, /expiry.mode must be one of/)
  })

  await t.test('it is still perfectly submittable while it is merely late', async () => {
    const created = await create({ title: 'Late but doable', expiry: { mode: 'end_of_day' } })
    const inst = await firstInstance(created.data.id)
    const raw = getDb().taskInstances.find((i) => i.id === inst.id)
    raw.dueAt = new Date(Date.now() - 3600000).toISOString()

    refreshOverdue()
    assert.equal(getDb().taskInstances.find((i) => i.id === inst.id).status, 'overdue')

    const done = await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })
    assert.equal(done.status, 200, 'overdue work can still be handed in — that is what overdue MEANS')
    assert.equal(done.data.status, 'approved')
  })

  await t.test('once it closes it is terminal: no submit, no cancel, no reassign', async () => {
    const created = await create({ title: 'Gone', expiry: { mode: 'end_of_day' } })
    const inst = await firstInstance(created.data.id)
    const raw = getDb().taskInstances.find((i) => i.id === inst.id)
    raw.dueAt = new Date(Date.now() - 7200000).toISOString()
    raw.expiresAt = new Date(Date.now() - 3600000).toISOString()
    raw.status = 'overdue'

    const closed = expireStale()
    assert.equal(closed.length, 1)
    assert.equal(closed[0].id, inst.id)
    assert.equal(closed[0].status, 'expired')
    assert.ok(closed[0].expiredAt)

    const late = await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })
    assert.equal(late.status, 409)
    const cancel = await api('POST', `/api/task-instances/${inst.id}/cancel`, { token: lakshmi, body: { reason: 'x' } })
    assert.equal(cancel.status, 409, 'closed work is already finished — the 5 hardcoded terminal lists agree now')
    const reassign = await api('POST', `/api/task-instances/${inst.id}/reassign`, { token: lakshmi, body: { toPositionId: 'pos-renu' } })
    assert.equal(reassign.status, 409)
  })

  await t.test('closing fires the notice exactly once, however often the sweep runs', async () => {
    const created = await create({ title: 'One notice only', expiry: { mode: 'end_of_day' } })
    const inst = await firstInstance(created.data.id)
    const raw = getDb().taskInstances.find((i) => i.id === inst.id)
    raw.expiresAt = new Date(Date.now() - 1000).toISOString()

    const before = getDb().notifications.filter((n) => n.userId === raw.assigneeUserId).length
    assert.equal(expireStale().length, 1)
    const after = getDb().notifications.filter((n) => n.userId === raw.assigneeUserId).length
    assert.ok(after > before, 'they are told')
    // expiredAt is the guard, exactly as overdueAt guards refreshOverdue
    assert.equal(expireStale().length, 0)
    assert.equal(getDb().notifications.filter((n) => n.userId === raw.assigneeUserId).length, after)
  })

  await t.test('THE POINT: a closed mandatory task stops holding their sign-off', async () => {
    const created = await create({
      title: 'Mandatory and gone',
      isBlocking: true,
      expiry: { mode: 'end_of_day' },
    })
    const inst = await firstInstance(created.data.id)
    const raw = getDb().taskInstances.find((i) => i.id === inst.id)
    raw.dueAt = new Date(Date.now() - 7200000).toISOString()
    raw.status = 'overdue'

    // while it is only late, it holds
    const held = await api('POST', '/api/auth/logout', { token: anjali })
    assert.equal(held.status, 409)

    raw.expiresAt = new Date(Date.now() - 1000).toISOString()
    expireStale()

    const free = await api('POST', '/api/auth/logout', { token: anjali })
    assert.equal(free.status, 200, 'nobody is held to work that can no longer be done')
  })
})

// ---------------------------------------------------------------------------
test('expiry: the template and the analytics', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const today = localToday(TZ)
  const { getDb } = await import('../db.js')
  const { expireStale } = await import('../tasks/generate.js')

  await t.test('changing the expiry retimes future untouched occurrences only', async () => {
    const created = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Daily with a closing time',
        target: { positionIds: ['pos-anjali'], followJoiners: false },
        recurrence: { freq: 'daily', startDate: today },
        expiry: { mode: 'after_days', days: 1 },
      },
    })
    const all = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: lakshmi })).data
    const todays = all.find((i) => i.serviceDate === today)
    const future = all.find((i) => i.serviceDate > today)

    // today's is started, so it is history and keeps what it was assigned under
    const anjali = await login('teacher@kidzonia.com')
    await api('POST', `/api/task-instances/${todays.id}/start`, { token: anjali })

    await api('PUT', `/api/tasks/${created.data.id}`, {
      token: lakshmi, body: { expiry: { mode: 'after_days', days: 5 } },
    })

    const after = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: lakshmi })).data
    const stillOne = after.find((i) => i.id === todays.id)
    const nowFive = after.find((i) => i.id === future.id)
    assert.equal(stillOne.expiry.days, 1, 'work in flight keeps the rule it was assigned under')
    assert.equal(nowFive.expiry.days, 5, 'untouched future occurrences follow the template')
    assert.equal(localDate(TZ, nowFive.expiresAt), addDays(nowFive.serviceDate, 5), 'and the date moved with it')
  })

  await t.test('closed work gets its own column and leaves the completion rate alone', async () => {
    const anjali = await login('teacher@kidzonia.com')
    const made = async (title) => {
      const res = await api('POST', '/api/tasks', {
        token: lakshmi,
        body: {
          title,
          target: { positionIds: ['pos-anjali'], followJoiners: false },
          recurrence: { freq: 'none', startDate: today },
          expiry: { mode: 'end_of_day' },
        },
      })
      return (await api('GET', `/api/task-instances?taskId=${res.data.id}`, { token: lakshmi })).data[0]
    }
    const done = await made('Will be done')
    const gone = await made('Will close')
    await api('POST', `/api/task-instances/${done.id}/submit`, { token: anjali })

    const raw = getDb().taskInstances.find((i) => i.id === gone.id)
    raw.expiresAt = new Date(Date.now() - 1000).toISOString()
    expireStale()

    const rep = await api('GET', `/api/tasks/analytics?scope=team&from=${today}&to=${today}`, { token: lakshmi })
    assert.equal(rep.status, 200)
    const rows = rep.data.team?.people || []
    const hers = rows.find((r) => r.userName === 'Anjali Rao')
    assert.ok(hers, 'she is in the roll-up')
    assert.ok(hers.expired >= 1, 'a column of its own')
    // it used to fall through every branch, counting in `total` and nowhere
    // else, which silently depressed the percentage
    assert.equal(hers.pct, Math.round((hers.done / (hers.total - hers.cancelled - hers.expired)) * 100))
  })
})
