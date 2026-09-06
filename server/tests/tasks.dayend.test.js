import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

// Day-end reporting is opt-in per node. Turning it on is what a school does;
// the fixture does the same thing by hand.
//
// The work week is opened to all seven days on purpose. The day-end template
// carries skipNonWorkingDays, so on a Sunday the seeded Mon-Sat week produces no
// occurrence at all and every assertion below about "today's report" fails — the
// suite was red every weekend for exactly that reason. What is under test here is
// the report, not the calendar; the work week has its own tests in
// tasks.schedule.test.js and tasks.recurrence.test.js.
async function enableDayEnd(nodeId = 'node-sch-jh') {
  const { getDb } = await import('../db.js')
  const node = getDb().orgNodes.find((n) => n.id === nodeId)
  node.settings = { ...(node.settings || {}), dayEndReport: true, workWeek: [0, 1, 2, 3, 4, 5, 6] }
}

test('Day-End report: a task that rolls the day up to the reporting manager', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()
  await enableDayEnd()

  const lakshmi = await login('principal@kidzonia.com')   // Anjali's reporting manager
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)

  // some real work to report on
  const created = await api('POST', '/api/tasks', {
    token: lakshmi,
    body: {
      title: 'Tidy the reading corner',
      target: { kind: 'position', positionIds: ['pos-anjali'] },
      recurrence: { freq: 'none', startDate: today },
    },
  })
  const workId = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: lakshmi })).data[0].id

  let reportInstanceId = null

  await t.test('every active position gets one, daily and blocking', async () => {
    const mine = (await api('GET', '/api/tasks/my', { token: anjali })).data
    const all = [...mine.overdue, ...mine.dueToday]
    const report = all.find((i) => i.title === 'Submit Day-End Report')
    assert.ok(report, 'it is on her plate today')
    reportInstanceId = report.id
    assert.equal(report.isBlocking, true)
    assert.equal(report.origin, 'automated')
    assert.equal(report.completionCondition.nature, 'custom')
    assert.equal(report.completionCondition.custom.requireNote, true, 'the notes field is the point')

    // her principal owes one too — it is per position, not per teacher
    const theirs = (await api('GET', '/api/tasks/my', { token: lakshmi })).data
    assert.ok([...theirs.overdue, ...theirs.dueToday].some((i) => i.title === 'Submit Day-End Report'))
  })

  await t.test('it holds sign-off, and sorts LAST behind the real work', async () => {
    const gate = (await api('GET', '/api/tasks/logout-check', { token: anjali })).data
    assert.equal(gate.blocked, true)
    assert.equal(gate.instances[gate.instances.length - 1].title, 'Submit Day-End Report',
      'the report is the last thing you do, not the first thing that stops you')
  })

  await t.test('the preview rolls today up before she types anything', async () => {
    await api('POST', `/api/task-instances/${workId}/submit`, { token: anjali })
    const pre = (await api('GET', '/api/tasks/day-end/preview', { token: anjali })).data
    assert.equal(pre.date, today)
    assert.equal(pre.reportsTo.name, 'Lakshmi Devi', 'it goes to her immediate ancestor')
    assert.equal(pre.summary.counts.completed, 1)
    assert.ok(pre.summary.completed.some((i) => i.title === 'Tidy the reading corner'))
    assert.equal(pre.alreadySubmitted, false)
    // the report never counts itself as part of the day it reports on
    assert.ok(!pre.summary.pending.some((i) => i.title === 'Submit Day-End Report'))
  })

  await t.test('submitting IS the report — no separate publish step', async () => {
    const nothing = await api('POST', `/api/task-instances/${reportInstanceId}/submit`, { token: anjali })
    assert.equal(nothing.status, 422)
    assert.equal(nothing.data.error, 'note_required', 'the notes field is required')

    const done = await api('POST', `/api/task-instances/${reportInstanceId}/submit`, {
      token: anjali,
      body: { completion: { note: 'Two children still waiting on their library cards.' } },
    })
    assert.equal(done.status, 200)
    assert.equal(done.data.status, 'approved')

    const gate = (await api('GET', '/api/tasks/logout-check', { token: anjali })).data
    assert.equal(gate.blocked, false, 'and now she can sign off')
  })

  await t.test('it lands in her manager’s received-reports inbox, rolled up', async () => {
    const inbox = (await api('GET', '/api/tasks/day-end/received', { token: lakshmi })).data
    assert.equal(inbox.received, 1)
    const row = inbox.reports[0]
    assert.equal(row.byName, 'Anjali Rao')
    assert.equal(row.notes, 'Two children still waiting on their library cards.')
    assert.equal(row.summary.counts.completed, 1)
    assert.equal(inbox.totals.completed, 1, 'roll-up across everyone who reported')

    // and the half a list of received reports cannot show you: who has not filed
    assert.ok(inbox.outstanding.length >= 1, 'the people still to report are named')
    assert.ok(!inbox.outstanding.some((p) => p.userId === 'u-teacher'))

    const note = (await api('GET', '/api/notifications', { token: lakshmi })).data
      .find((n) => n.event === 'day_end')
    assert.ok(note, 'the manager is told it arrived')
    assert.match(note.body, /1 done/)
  })

  await t.test('the report is FROZEN — later work does not rewrite yesterday', async () => {
    const before = (await api('GET', '/api/tasks/day-end/received', { token: lakshmi })).data.reports[0]
    const extra = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: { title: 'A late extra job', target: { kind: 'position', positionIds: ['pos-anjali'] }, recurrence: { freq: 'none', startDate: today } },
    })
    const id = (await api('GET', `/api/task-instances?taskId=${extra.data.id}`, { token: lakshmi })).data[0].id
    await api('POST', `/api/task-instances/${id}/submit`, { token: anjali })

    const after = (await api('GET', `/api/tasks/day-end/${before.id}`, { token: lakshmi })).data
    assert.equal(after.summary.counts.completed, 1, 'it still says what was true at sign-off')
  })

  await t.test('the manager can acknowledge it, and only the manager', async () => {
    const report = (await api('GET', '/api/tasks/day-end/received', { token: lakshmi })).data.reports[0]

    const bySender = await api('POST', `/api/tasks/day-end/${report.id}/acknowledge`, { token: anjali, body: { comment: 'ok' } })
    assert.equal(bySender.status, 403)

    const ack = await api('POST', `/api/tasks/day-end/${report.id}/acknowledge`, {
      token: lakshmi, body: { comment: 'Chased the library cards, thank you' },
    })
    assert.equal(ack.status, 200)
    assert.ok(ack.data.acknowledgedAt)

    assert.ok((await api('GET', '/api/notifications', { token: anjali })).data
      .some((n) => /read your day-end report/.test(n.title)), 'she hears that it was read')

    const meera = await login('superadmin@kidzonia.com')
    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    assert.ok(audit.some((a) => a.action === 'dayend.submit'))
    assert.ok(audit.some((a) => a.action === 'dayend.acknowledge'))
  })

  await t.test('a report you never wrote LAPSES — it does not stalk you forever', async () => {
    const { getDb } = await import('../db.js')
    const db = getDb()

    // yesterday's report, still open: exactly the state that used to accrue one
    // more blocking task every night
    const stale = db.taskInstances.find((i) => i.assigneeUserId === 'u-teacher2' && i.title === 'Submit Day-End Report')
    assert.ok(stale, 'the fixture needs an unfiled report')
    stale.serviceDate = '2026-01-05'
    stale.dueAt = '2026-01-05T18:30:00.000Z'
    stale.status = 'overdue'

    const kavya = await login('teacher2@kidzonia.com')
    await api('GET', '/api/tasks/my', { token: kavya })          // any read runs the sweep

    const after = db.taskInstances.find((i) => i.id === stale.id)
    assert.equal(after.status, 'cancelled')
    assert.equal(after.cancelReason, 'missed')

    const gate = (await api('GET', '/api/tasks/logout-check', { token: kavya })).data
    assert.ok(!gate.instances.some((i) => i.id === stale.id), 'a day she cannot re-live no longer holds the door')

    // but it is NOT swept away: her manager sees the gap
    const report = db.dayEndReports.find((r) => r.instanceId === stale.id)
    assert.ok(report, 'the missed day is recorded')
    assert.equal(report.missed, true)
    assert.equal(report.date, '2026-01-05')
    assert.equal(report.submittedAt, null)

    const inbox = (await api('GET', '/api/tasks/day-end/received', { token: lakshmi })).data
    assert.ok(inbox.missed.some((r) => r.id === report.id), 'it shows in the inbox as missed')
    assert.ok(!inbox.reports.some((r) => r.id === report.id), 'and never as a submission')

    const meera = await login('superadmin@kidzonia.com')
    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    assert.ok(audit.some((a) => a.action === 'dayend.missed' && a.recordId === stale.id))
  })

  await t.test('a report is private to its sender, its recipient and the line above', async () => {
    const report = (await api('GET', '/api/tasks/day-end/received', { token: lakshmi })).data.reports[0]
    const kavya = await login('teacher2@kidzonia.com')
    assert.equal((await api('GET', `/api/tasks/day-end/${report.id}`, { token: kavya })).status, 404, 'a peer cannot read it')

    const meera = await login('superadmin@kidzonia.com')
    assert.equal((await api('GET', `/api/tasks/day-end/${report.id}`, { token: meera })).status, 200, 'HQ can')
    assert.equal((await api('GET', `/api/tasks/day-end/${report.id}`, { token: anjali })).status, 200, 'and so can she')
  })
})

// ---------------------------------------------------------------------------
test('the Today view is where a login lands', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()
  await enableDayEnd()

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)

  const make = async (body) => {
    const res = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: { target: { kind: 'position', positionIds: ['pos-anjali'] }, recurrence: { freq: 'none', startDate: today }, ...body },
    })
    return (await api('GET', `/api/task-instances?taskId=${res.data.id}`, { token: lakshmi })).data[0].id
  }

  await make({ title: 'Low and later', priority: 'low' })
  const urgent = await make({ title: 'Urgent and mandatory', priority: 'urgent', isBlocking: true })
  const stale = await make({ title: 'Left over from before' })

  // age one occurrence into yesterday, the way the clock would
  const { getDb } = await import('../db.js')
  const old = getDb().taskInstances.find((i) => i.id === stale)
  old.serviceDate = '2026-01-05'
  old.dueAt = '2026-01-05T18:30:00.000Z'
  old.status = 'overdue'

  await t.test('it lands on today plus anything left from before', async () => {
    const view = (await api('GET', '/api/tasks/today', { token: anjali })).data
    assert.equal(view.today, today)
    assert.equal(view.greetingName, 'Anjali Rao')
    assert.ok(view.overdue.some((i) => i.id === stale), 'yesterday’s unfinished work is right there')
    assert.ok(view.dueToday.some((i) => i.id === urgent))
    assert.ok(!view.dueToday.some((i) => i.title === 'Submit Day-End Report'), 'the report is its own call to action')
  })

  await t.test('it is ordered the way you would actually work', async () => {
    const view = (await api('GET', '/api/tasks/today', { token: anjali })).data
    assert.equal(view.dueToday[0].title, 'Urgent and mandatory', 'mandatory and urgent first')
    assert.equal(view.dueToday[view.dueToday.length - 1].title, 'Low and later')
  })

  await t.test('the banner says exactly what is holding sign-off', async () => {
    const view = (await api('GET', '/api/tasks/today', { token: anjali })).data
    assert.equal(view.signOff.blocked, true)
    assert.ok(view.signOff.count >= 2)
    assert.ok(view.signOff.items.some((i) => i.title === 'Urgent and mandatory'))
    assert.equal(view.signOff.items[view.signOff.items.length - 1].title, 'Submit Day-End Report')

    // the Day-End CTA is its own field, not buried in a list
    assert.ok(view.dayEnd.instanceId)
    assert.equal(view.dayEnd.submitted, false)
  })

  await t.test('a manager also sees how many reports are waiting on them', async () => {
    const view = (await api('GET', '/api/tasks/today', { token: lakshmi })).data
    assert.equal(typeof view.reportsWaiting, 'number')
  })
})
