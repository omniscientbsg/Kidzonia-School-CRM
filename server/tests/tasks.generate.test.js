import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday, localDayEnd, addDays } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

test('tasks: instance generation, idempotency and overdue', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()   // demo board out of the way; these tests build their own

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const sunil = await login('principal.gb@kidzonia.com')
  const today = localToday(TZ)

  const daily = await api('POST', '/api/tasks', {
    token: lakshmi,
    body: {
      title: 'Submit attendance before leaving',
      target: { kind: 'node_level', nodeIds: ['node-sch-jh'], levelId: 'lvl-teacher' },
      dueType: 'end_of_day',
      recurrence: { freq: 'daily', startDate: today },
      isBlocking: true,
      priority: 'high',
    },
  })
  assert.equal(daily.status, 201)
  const dailyId = daily.data.id

  await t.test('one occurrence per assignee per day, out to the horizon', async () => {
    const { data } = await api('GET', `/api/task-instances?taskId=${dailyId}`, { token: lakshmi })
    const dates = [...new Set(data.map((i) => i.serviceDate))].sort()
    const people = [...new Set(data.map((i) => i.assigneeUserId))]
    assert.equal(people.length, 5)                     // 5 teachers at JH
    assert.equal(dates[0], today)
    assert.equal(dates.length, 8)                      // today + 7 days ahead
    assert.equal(data.length, 40)
    assert.ok(data.every((i) => i.status === 'assigned'))
    assert.ok(data.every((i) => i.isBlocking))
    assert.ok(data.every((i) => i.branchId === 'br-jh'))
  })

  await t.test('due instants use the school local day, not the server day', async () => {
    const { data } = await api('GET', `/api/task-instances?taskId=${dailyId}&from=${today}&to=${today}`, { token: lakshmi })
    assert.ok(data.length > 0)
    assert.ok(data.every((i) => i.tz === TZ))
    assert.ok(data.every((i) => i.dueAt === localDayEnd(TZ, today)))
  })

  await t.test('generation is idempotent — running it again creates nothing', async () => {
    const before = (await api('GET', `/api/task-instances?taskId=${dailyId}`, { token: lakshmi })).data.length
    const again = await api('POST', '/api/tasks/generate', { token: lakshmi, body: { taskId: dailyId } })
    assert.equal(again.status, 200)
    assert.equal(again.data.created, 0)
    const after = (await api('GET', `/api/task-instances?taskId=${dailyId}`, { token: lakshmi })).data.length
    assert.equal(after, before)
  })

  await t.test('assignees see their own work; the tree bounds everyone else', async () => {
    const mine = await api('GET', '/api/tasks/my', { token: anjali })
    assert.equal(mine.status, 200)
    assert.equal(mine.data.timezone, TZ)
    assert.equal(mine.data.dueToday.length, 1)
    assert.equal(mine.data.dueToday[0].title, 'Submit attendance before leaving')
    assert.equal(mine.data.blockingOpen, 1)
    // the 7 future days are split across "this week" and "upcoming"
    assert.equal(mine.data.thisWeek.length + mine.data.upcoming.length, 7)

    // a teacher sees only her own occurrences, never her colleagues'
    const teacherAll = await api('GET', '/api/task-instances', { token: anjali })
    assert.ok(teacherAll.data.every((i) => i.assigneeUserId === 'u-teacher'))

    // the other school sees nothing of this
    const gb = await api('GET', '/api/task-instances', { token: sunil })
    assert.equal(gb.data.filter((i) => i.taskId === dailyId).length, 0)

    // the principal sees her whole downline
    const downline = await api('GET', `/api/task-instances?taskId=${dailyId}&scope=downline&from=${today}&to=${today}`, { token: lakshmi })
    assert.equal(downline.data.length, 5)
    assert.ok(downline.data.every((i) => i.assigneeTier))
  })

  await t.test('a missed day flips to overdue exactly once', async () => {
    const yesterday = addDays(today, -1)
    const oneOff = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Yesterday’s fire drill report',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        dueType: 'end_of_day',
        recurrence: { freq: 'none', startDate: yesterday },
      },
    })
    assert.equal(oneOff.status, 201)

    const list1 = await api('GET', `/api/task-instances?taskId=${oneOff.data.id}`, { token: lakshmi })
    assert.equal(list1.data.length, 1)
    assert.equal(list1.data[0].status, 'overdue')
    assert.equal(list1.data[0].serviceDate, yesterday)
    const stamp = list1.data[0].overdueAt
    assert.ok(stamp)

    const list2 = await api('GET', `/api/task-instances?taskId=${oneOff.data.id}`, { token: lakshmi })
    assert.equal(list2.data[0].overdueAt, stamp)      // not re-stamped on every read

    const mine = await api('GET', '/api/tasks/my', { token: anjali })
    assert.equal(mine.data.overdue.length, 1)
  })

  await t.test('n_days and date_window due dates', async () => {
    const nDays = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Prepare the Sports Day list',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        dueType: 'n_days', dueConfig: { days: 3 },
        recurrence: { freq: 'none', startDate: today },
      },
    })
    const rows = (await api('GET', `/api/task-instances?taskId=${nDays.data.id}`, { token: lakshmi })).data
    assert.equal(rows[0].dueAt, localDayEnd(TZ, addDays(today, 3)))

    const window = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Annual Day rehearsal plan',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        dueType: 'date_window',
        dueConfig: { startDate: today, dueDate: addDays(today, 10) },
        recurrence: { freq: 'none', startDate: today },
      },
    })
    const win = (await api('GET', `/api/task-instances?taskId=${window.data.id}`, { token: lakshmi })).data
    assert.equal(win[0].dueAt, localDayEnd(TZ, addDays(today, 10)))
  })

  await t.test('pausing withdraws untouched future work and stops new generation', async () => {
    const paused = await api('POST', `/api/tasks/${dailyId}/pause`, { token: lakshmi })
    assert.equal(paused.data.status, 'paused')
    assert.ok(paused.data.propagation.removed > 0)

    const during = (await api('GET', `/api/task-instances?taskId=${dailyId}`, { token: lakshmi })).data
    assert.equal(during.filter((i) => i.serviceDate > today).length, 0)   // future withdrawn
    assert.ok(during.some((i) => i.serviceDate === today))                // today survives

    // a paused template generates nothing
    await api('POST', '/api/tasks/generate', { token: lakshmi, body: {} })
    const stillPaused = (await api('GET', `/api/task-instances?taskId=${dailyId}`, { token: lakshmi })).data
    assert.equal(stillPaused.length, during.length)

    // resuming brings the horizon back
    await api('POST', `/api/tasks/${dailyId}/pause`, { token: lakshmi })
    const resumed = (await api('GET', `/api/task-instances?taskId=${dailyId}`, { token: lakshmi })).data
    assert.ok(resumed.filter((i) => i.serviceDate > today).length > 0)
    return resumed.length
  })

  await t.test('cancelling kills every open occurrence and never regenerates', async () => {
    const before = (await api('GET', `/api/task-instances?taskId=${dailyId}`, { token: lakshmi })).data
    const open = before.filter((i) => !['approved', 'cancelled'].includes(i.status)).length

    const cancelled = await api('POST', `/api/tasks/${dailyId}/cancel`, { token: lakshmi, body: { reason: 'Replaced' } })
    assert.equal(cancelled.data.cancelledInstances, open)
    const rows = (await api('GET', `/api/task-instances?taskId=${dailyId}`, { token: lakshmi })).data
    assert.ok(rows.every((i) => i.status === 'cancelled'))

    await api('POST', '/api/tasks/generate', { token: lakshmi, body: {} })
    const after = (await api('GET', `/api/task-instances?taskId=${dailyId}`, { token: lakshmi })).data
    assert.equal(after.length, before.length)
  })
})
