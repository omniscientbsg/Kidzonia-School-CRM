// The demo board, untouched — this file must NOT call clearSeededTasks(), which
// is why it lives on its own (one throwaway db per test file).
import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login } from './helpers.js'
import { weekdayOf } from '../tasks/time.js'

test('seed ships a demonstrable daily, weekly and monthly task', async (t) => {
  await startServer()
  t.after(stopServer)

  const meera = await login('superadmin@kidzonia.com')
  const { data: tasks } = await api('GET', '/api/tasks', { token: meera })

  const daily = tasks.find((x) => x.id === 'task-attendance')
  const weekly = tasks.find((x) => x.id === 'task-weekly-inventory')
  const monthly = tasks.find((x) => x.id === 'task-audit')
  const weekdays = tasks.find((x) => x.id === 'task-parentcalls')
  assert.ok(daily && weekly && monthly && weekdays)

  await t.test('daily: mandatory, skips weekly offs and holidays', async () => {
    assert.equal(daily.title, 'Mark class attendance')
    assert.equal(daily.recurrence.freq, 'daily')
    assert.equal(daily.recurrence.skipNonWorkingDays, true)
    assert.equal(daily.isBlocking, true)

    const rows = (await api('GET', `/api/task-instances?taskId=${daily.id}`, { token: meera })).data
    assert.ok(rows.length > 0)
    assert.ok(rows.every((i) => weekdayOf(i.serviceDate) !== 0))     // never a Sunday
    assert.ok(rows.every((i) => i.dueAt.endsWith('18:29:59.999Z')))  // end of the Indian day
  })

  await t.test('specific weekdays: Mon / Wed / Fri', async () => {
    assert.equal(weekdays.recurrence.freq, 'weekdays')
    assert.deepEqual(weekdays.recurrence.byWeekday, [1, 3, 5])
    const rows = (await api('GET', `/api/task-instances?taskId=${weekdays.id}`, { token: meera })).data
    assert.ok(rows.length > 0)
    assert.ok(rows.every((i) => [1, 3, 5].includes(weekdayOf(i.serviceDate))))
  })

  await t.test('weekly: every Friday, needs sign-off', async () => {
    assert.equal(weekly.recurrence.freq, 'weekly')
    assert.deepEqual(weekly.recurrence.byWeekday, [5])
    assert.equal(weekly.requiresApproval, true)
    const rows = (await api('GET', `/api/task-instances?taskId=${weekly.id}`, { token: meera })).data
    assert.ok(rows.length > 0)
    assert.ok(rows.every((i) => weekdayOf(i.serviceDate) === 5))
  })

  await t.test('monthly: day 5, across both schools', async () => {
    assert.equal(monthly.recurrence.freq, 'monthly')
    assert.equal(monthly.recurrence.dayOfMonth, 5)
    const rows = (await api('GET', `/api/task-instances?taskId=${monthly.id}`, { token: meera })).data
    assert.ok(rows.length > 0)
    assert.ok(rows.every((i) => i.serviceDate.endsWith('-05') || i.serviceDate === rows[0].serviceDate))
    const nodes = new Set(rows.map((i) => i.assigneeNodeId))
    assert.ok(nodes.has('node-sch-jh') && nodes.has('node-sch-gb'))   // franchise + company-owned
  })

  await t.test('a holiday on the school calendar produces no occurrence', async () => {
    // seed ships Independence Day 2026-08-15 as a holiday for br-jh
    const holidays = (await api('GET', '/api/events', { token: meera })).data.filter((e) => e.type === 'holiday')
    assert.ok(holidays.some((e) => e.date === '2026-08-15'))

    const rows = (await api('GET', `/api/task-instances?taskId=${daily.id}`, { token: meera })).data
    const jh = rows.filter((i) => i.branchId === 'br-jh')
    assert.ok(!jh.some((i) => i.serviceDate === '2026-08-15'))
  })
})
