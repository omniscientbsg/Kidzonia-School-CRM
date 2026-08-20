import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

test('notifications: the whole task lifecycle', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const meera = await login('superadmin@kidzonia.com')
  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)

  const inbox = async (token) => (await api('GET', '/api/notifications', { token })).data
  const titles = async (token) => (await inbox(token)).map((n) => n.title)
  const logFor = async (event) => (await api('GET', `/api/tasks/notification-log?event=${event}`, { token: meera })).data

  await t.test('assignment notifies the assignee, digested per run', async () => {
    const created = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Mark class attendance',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        recurrence: { freq: 'daily', startDate: today },
        isBlocking: true,
      },
    })
    assert.equal(created.status, 201)

    const mine = await inbox(anjali)
    const assigned = mine.filter((n) => n.event === 'assigned')
    // 8 occurrences were created, but she is told once
    assert.equal(assigned.length, 1)
    assert.match(assigned[0].title, /8 new tasks assigned to you/)
    assert.match(assigned[0].body, /Lakshmi Devi assigned you 8 tasks/)
    assert.equal(assigned[0].type, 'task')
    assert.equal(assigned[0].refType, 'taskInstance')
  })

  await t.test('every send is logged per channel, including the mocked ones', async () => {
    const rows = await logFor('assigned')
    assert.ok(rows.length >= 1)
    const row = rows[0]
    assert.equal(row.channel, 'inApp')
    assert.equal(row.status, 'sent')
    assert.equal(row.provider, 'in-app')
    assert.equal(row.userName, 'Anjali Rao')
    assert.ok(row.refId)
  })

  await t.test('due-soon fires once, within the configured lead time', async () => {
    const { getDb } = await import('../db.js')
    const db = getDb()
    const inst = db.taskInstances.find((i) => i.assigneeUserId === 'u-teacher' && i.serviceDate === today)
    // pull the deadline inside the default 4h lead time
    inst.dueAt = new Date(Date.now() + 2 * 3600000).toISOString()

    await api('GET', '/api/tasks/my', { token: anjali })          // any read runs the sweep
    const first = (await inbox(anjali)).filter((n) => n.event === 'due_soon')
    assert.equal(first.length, 1)
    assert.match(first[0].body, /due in about 2 hours/)

    await api('GET', '/api/tasks/my', { token: anjali })
    const second = (await inbox(anjali)).filter((n) => n.event === 'due_soon')
    assert.equal(second.length, 1, 'due-soon must not repeat on every read')

    // push is mocked but still recorded with a payload
    const pushRow = (await logFor('due_soon')).find((l) => l.channel === 'push')
    assert.ok(pushRow)
    assert.equal(pushRow.status, 'stubbed')
    assert.equal(pushRow.provider, 'mock-push')
    assert.match(pushRow.payload.body, /due in about/)
  })

  await t.test('blocking work near end of day nudges before the door closes', async () => {
    const { getDb } = await import('../db.js')
    const inst = getDb().taskInstances.find((i) => i.assigneeUserId === 'u-teacher' && i.isBlocking && i.serviceDate === today)
    inst.dueAt = new Date(Date.now() + 1 * 3600000).toISOString()   // inside the 2h EOD lead
    inst.notifiedEodAt = null

    const before = (await inbox(anjali)).filter((n) => n.event === 'blocking_eod').length
    await api('GET', '/api/tasks/my', { token: anjali })
    const eod = (await inbox(anjali)).filter((n) => n.event === 'blocking_eod')
    assert.equal(eod.length, before + 1)
    assert.match(eod[0].title, /Finish before you sign off/)
    assert.match(eod[0].body, /will not be able to log out/)
    assert.match(eod[0].body, /Ask your manager/)                   // non-punitive, offers the way out

    // once per person per day: further sweeps add nothing, even though she owes
    // several mandatory tasks
    await api('GET', '/api/tasks/my', { token: anjali })
    await api('GET', '/api/tasks/my', { token: anjali })
    assert.equal((await inbox(anjali)).filter((n) => n.event === 'blocking_eod').length, before + 1)

    // whatsapp is mocked with a real recipient taken from the user record
    const wa = (await logFor('blocking_eod')).find((l) => l.channel === 'whatsapp')
    assert.equal(wa.provider, 'mock-whatsapp')
    assert.equal(wa.status, 'stubbed')
  })

  await t.test('overdue tells the assignee AND the assigner', async () => {
    const { getDb } = await import('../db.js')
    const inst = getDb().taskInstances.find((i) => i.assigneeUserId === 'u-teacher' && i.status !== 'approved' && i.serviceDate === today)
    inst.dueAt = new Date(Date.now() - 3600000).toISOString()       // deadline just passed
    inst.status = 'assigned'
    inst.overdueAt = null

    await api('GET', '/api/tasks/my', { token: anjali })
    assert.ok((await titles(anjali)).includes('Task overdue'))
    assert.ok((await titles(lakshmi)).includes('A task you assigned is overdue'))

    // the assigner ping is a `progress` event, not an `overdue` one
    const progress = (await inbox(lakshmi)).find((n) => n.title === 'A task you assigned is overdue')
    assert.equal(progress.event, 'progress')

    // and it does not repeat — overdueAt is the guard
    const before = (await inbox(anjali)).filter((n) => n.event === 'overdue').length
    await api('GET', '/api/tasks/my', { token: anjali })
    assert.equal((await inbox(anjali)).filter((n) => n.event === 'overdue').length, before)
  })

  await t.test('submitted goes up to the approver; approved comes back down', async () => {
    const created = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Weekly display board',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        requiresApproval: true,
        recurrence: { freq: 'none', startDate: today },
      },
    })
    const id = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: lakshmi })).data[0].id

    await api('POST', `/api/task-instances/${id}/submit`, { token: anjali, body: { comment: 'Done' } })
    const approverNote = (await inbox(lakshmi)).find((n) => n.title === 'Task awaiting your approval')
    assert.ok(approverNote)
    assert.equal(approverNote.event, 'submitted')

    await api('POST', `/api/task-instances/${id}/reject`, { token: lakshmi, body: { comment: 'Redo the border' } })
    const rejected = (await inbox(anjali)).find((n) => n.event === 'rejected')
    assert.match(rejected.body, /Redo the border/)

    await api('POST', `/api/task-instances/${id}/submit`, { token: anjali })
    await api('POST', `/api/task-instances/${id}/approve`, { token: lakshmi })
    assert.ok((await inbox(anjali)).some((n) => n.event === 'approved'))
    // the assigner is the approver here, so no duplicate progress ping is needed
    assert.ok((await titles(lakshmi)).includes('Task awaiting your approval'))
  })

  await t.test('a task with no approval still pings the assigner on completion', async () => {
    const created = await api('POST', '/api/tasks', {
      token: meera,                                                  // assigned by HQ
      body: {
        title: 'Confirm the fire exit signage',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        recurrence: { freq: 'none', startDate: today },
      },
    })
    const id = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: meera })).data[0].id
    await api('POST', `/api/task-instances/${id}/submit`, { token: anjali })

    const ping = (await inbox(meera)).find((n) => n.title === 'Task completed')
    assert.ok(ping, 'the assigner should hear that it finished')
    assert.equal(ping.event, 'progress')
    assert.match(ping.body, /Anjali Rao finished/)
  })

  await t.test('a user can mute a channel, and the suppression is recorded', async () => {
    const prefs = await api('PUT', '/api/tasks/notification-prefs', { token: anjali, body: { push: false } })
    assert.equal(prefs.data.push, false)

    const { getDb } = await import('../db.js')
    const inst = getDb().taskInstances.find((i) => i.assigneeUserId === 'u-teacher' && i.status === 'assigned')
    inst.dueAt = new Date(Date.now() + 3600000).toISOString()
    inst.notifiedDueSoonAt = null

    await api('GET', '/api/tasks/my', { token: anjali })
    const rows = await logFor('due_soon')
    const suppressed = rows.find((l) => l.channel === 'push' && l.status === 'suppressed')
    assert.ok(suppressed, 'an opted-out channel must still be logged')
    assert.equal(suppressed.reason, 'user_opted_out')
    // in-app still lands
    assert.ok(rows.some((l) => l.channel === 'inApp' && l.status === 'sent'))
  })

  await t.test('lead times are configurable per node, and the change is audited', async () => {
    const current = await api('GET', '/api/tasks/notification-settings?nodeId=node-sch-jh', { token: lakshmi })
    assert.equal(current.status, 200)
    assert.equal(current.data.settings.leadTimeHours, 4)
    assert.equal(current.data.overridden, false)
    assert.ok(current.data.events.includes('blocking_eod'))

    const bad = await api('PUT', '/api/tasks/notification-settings', {
      token: lakshmi, body: { nodeId: 'node-sch-jh', settings: { leadTimeHours: 0 } },
    })
    assert.equal(bad.status, 422)

    const saved = await api('PUT', '/api/tasks/notification-settings', {
      token: lakshmi,
      body: { nodeId: 'node-sch-jh', settings: { leadTimeHours: 12, channels: { due_soon: ['inApp', 'email'] } } },
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.data.settings.leadTimeHours, 12)
    assert.deepEqual(saved.data.settings.channels.due_soon, ['inApp', 'email'])
    assert.deepEqual(saved.data.settings.channels.overdue, ['inApp', 'push', 'email'])   // untouched default

    // a teacher cannot change her school's settings
    const byTeacher = await api('PUT', '/api/tasks/notification-settings', {
      token: anjali, body: { nodeId: 'node-sch-jh', settings: { leadTimeHours: 99 } },
    })
    assert.equal(byTeacher.status, 403)

    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    assert.ok(audit.some((a) => a.action === 'tasks.notification_settings'))
  })

  await t.test('the send log is bounded by the hierarchy', async () => {
    const sunil = await login('principal.gb@kidzonia.com')
    const theirs = (await api('GET', '/api/tasks/notification-log', { token: sunil })).data
    assert.ok(!theirs.some((l) => l.userName === 'Anjali Rao'))

    const hq = (await api('GET', '/api/tasks/notification-log', { token: meera })).data
    assert.ok(hq.some((l) => l.userName === 'Anjali Rao'))

    // a leaf sees only her own
    const hers = (await api('GET', '/api/tasks/notification-log', { token: anjali })).data
    assert.ok(hers.length > 0)
    assert.ok(hers.every((l) => l.userName === 'Anjali Rao'))
  })
})
