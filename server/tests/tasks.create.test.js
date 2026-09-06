import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday, localDayEnd, addDays } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

test('create task: fan-out happens on save, in the school local timezone', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const meera = await login('superadmin@kidzonia.com')
  const nandita = await login('nandita.rao@kidzonia.com')
  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)

  await t.test('one-off to a specific person: instance exists the moment it is saved', async () => {
    const res = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Hand over the trip consent forms',
        description: 'Collect signed slips and drop them at the front desk.',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        priority: 'high',
        dueType: 'end_of_day',
        recurrence: { freq: 'none', startDate: today },
      },
    })
    assert.equal(res.status, 201)
    assert.equal(res.data.assignedCount, 1)
    assert.equal(res.data.instancesCreated, 1)

    const inst = res.data.instances[0]
    assert.equal(inst.status, 'assigned')
    assert.equal(inst.assigneeUserId, 'u-teacher')
    assert.equal(inst.tz, TZ)
    assert.equal(inst.dueAt, localDayEnd(TZ, today))          // 23:59:59.999 local, not server time
    assert.equal(inst.assignedByUserId, 'u-principal')

    // the assignee sees it without anyone else having to open a screen first
    const mine = await api('GET', '/api/tasks/my', { token: anjali })
    assert.ok(mine.data.dueToday.some((i) => i.title === 'Hand over the trip consent forms'))
  })

  await t.test('a tier target may name several roles, and old single-role tasks still resolve', async () => {
    const spec = { kind: 'node_level', levelIds: ['lvl-teacher', 'lvl-daycare'], nodeIds: ['node-sch-jh'] }
    const preview = await api('POST', '/api/tasks/preview-targets', { token: lakshmi, body: { target: spec } })
    assert.equal(preview.data.count, 6)                          // 5 teachers + 1 day care
    assert.deepEqual([...new Set(preview.data.people.map((p) => p.tier))].sort(),
      ['Day Care Staff', 'Senior Teacher', 'Teacher'])

    const res = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Read the new fire drill notice',
        target: spec,
        dueType: 'end_of_day',
        recurrence: { freq: 'none', startDate: today },
      },
    })
    assert.equal(res.status, 201)
    assert.equal(res.data.assignedCount, 6)
    // both fields are written, so anything still reading levelId keeps working
    assert.deepEqual(res.data.target.levelIds, ['lvl-teacher', 'lvl-daycare'])
    assert.equal(res.data.target.levelId, 'lvl-teacher')

    // a target stored the OLD way — levelId only — resolves unchanged
    const legacy = await api('POST', '/api/tasks/preview-targets', {
      token: lakshmi,
      body: { target: { kind: 'node_level', levelId: 'lvl-daycare', nodeIds: ['node-sch-jh'] } },
    })
    assert.equal(legacy.data.count, 1)

    // naming no role at all is still refused
    const none = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: { title: 'x', target: { kind: 'node_level', nodeIds: ['node-sch-jh'] }, recurrence: { freq: 'none', startDate: today } },
    })
    assert.equal(none.status, 422)
  })

  await t.test('role-tier target expands to individuals: all Principals under HQ', async () => {
    // no nodes named — the tier across the co-ordinator's whole downline
    const preview = await api('POST', '/api/tasks/preview-targets', {
      token: nandita,
      body: { target: { kind: 'node_level', levelId: 'lvl-principal', nodeIds: [] } },
    })
    assert.equal(preview.data.count, 2)
    assert.deepEqual(preview.data.people.map((p) => p.userName).sort(), ['Lakshmi Devi', 'Sunil Kumar'])

    const res = await api('POST', '/api/tasks', {
      token: nandita,
      body: {
        title: 'Confirm the June headcount',
        target: { kind: 'node_level', levelId: 'lvl-principal', nodeIds: [] },
        dueType: 'n_days',
        dueConfig: { days: 2 },
        recurrence: { freq: 'none', startDate: today },
      },
    })
    assert.equal(res.status, 201)
    assert.equal(res.data.assignedCount, 2)
    assert.equal(res.data.instancesCreated, 2)

    // both branches, different depths, one target
    const nodes = res.data.instances.map((i) => i.assigneeNodeId).sort()
    assert.deepEqual(nodes, ['node-sch-gb', 'node-sch-jh'])
    assert.ok(res.data.instances.every((i) => i.dueAt === localDayEnd(TZ, addDays(today, 2))))
  })

  await t.test('whole-node target expands to everyone below, skipping the assigner', async () => {
    const res = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Read the updated safeguarding policy',
        target: { kind: 'node', nodeIds: ['node-sch-jh'] },
        recurrence: { freq: 'none', startDate: today },
      },
    })
    assert.equal(res.status, 201)
    const names = res.data.instances.map((i) => i.assigneeName)
    assert.ok(!names.includes('Lakshmi Devi'))               // never yourself
    assert.ok(names.includes('Sudhir Kukreja'))              // VP is below her
    assert.ok(names.includes('Anjali Rao'))
    assert.equal(res.data.assignedCount, res.data.instancesCreated)
  })

  await t.test('"everyone below me" from HQ reaches both branches at once', async () => {
    const res = await api('POST', '/api/tasks', {
      token: nandita,
      body: {
        title: 'Acknowledge the new leave policy',
        target: { kind: 'downline' },
        recurrence: { freq: 'none', startDate: today },
      },
    })
    assert.equal(res.status, 201)
    const names = res.data.instances.map((i) => i.assigneeName)
    assert.ok(names.includes('Prakash Reddy'))               // franchise owner
    assert.ok(names.includes('Divya Nair'))                  // non-franchise teacher
    assert.ok(names.includes('Anjali Rao'))                  // franchise teacher, one deeper
    assert.ok(!names.includes('Meera Krishnan'))             // senior at her own node
    assert.ok(!names.includes('Nandita Rao'))                // never yourself
  })

  await t.test('an invalid target is blocked and explained, and nothing is created', async () => {
    const before = (await api('GET', '/api/tasks', { token: meera })).data.length
    const res = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: { title: 'Boss, do this', target: { kind: 'position', positionIds: ['pos-prakash', 'pos-anjali'] } },
    })
    assert.equal(res.status, 403)
    assert.equal(res.data.error, 'not_in_downline')
    assert.match(res.data.message, /Prakash Reddy is not in your downline/)
    assert.equal(res.data.rejected[0].positionId, 'pos-prakash')

    // all-or-nothing: the reachable half of the target is not quietly assigned
    const after = (await api('GET', '/api/tasks', { token: meera })).data.length
    assert.equal(after, before)
  })

  await t.test('creation is audited with who, what target and how many landed', async () => {
    const audit = (await api('GET', '/api/audit-log', { token: meera })).data
    const row = audit.find((a) => a.action === 'task.create' && a.after?.title === 'Confirm the June headcount')
    assert.ok(row)
    assert.equal(row.userId, 'u-coord')
    assert.equal(row.positionId, 'pos-nandita')
    assert.equal(row.after.instancesCreated, 2)
    assert.deepEqual(row.after.assignedTo.sort(), ['pos-lakshmi', 'pos-sunil'])
    assert.equal(row.after.target.kind, 'node_level')
  })

  await t.test('the timeline opens with the assignment itself', async () => {
    const inst = (await api('GET', '/api/task-instances?scope=assigned_by_me', { token: lakshmi })).data[0]
    const { data } = await api('GET', `/api/task-instances/${inst.id}/timeline`, { token: lakshmi })
    assert.equal(data.events[0].action, 'instance.assign')
    assert.equal(data.events[0].userName, 'Lakshmi Devi')
    assert.match(data.events[0].reason, /Assigned to/)
  })
})

test('tracking view: progress per assignee', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const kavya = await login('teacher2@kidzonia.com')
  const today = localToday(TZ)

  const res = await api('POST', '/api/tasks', {
    token: lakshmi,
    body: {
      title: 'Update your classroom display board',
      target: { kind: 'node_level', nodeIds: ['node-sch-jh'], levelId: 'lvl-teacher' },
      requiresApproval: true,
      recurrence: { freq: 'none', startDate: today },
    },
  })
  const taskId = res.data.id
  const forUser = (rows, id) => rows.find((p) => p.userId === id)

  await t.test('starts at zero for everyone', async () => {
    const { status, data } = await api('GET', `/api/tasks/${taskId}/progress`, { token: lakshmi })
    assert.equal(status, 200)
    assert.equal(data.assignees, 5)
    assert.equal(data.completion, 0)
    assert.equal(data.totals.assigned, 5)
    assert.ok(data.people.every((p) => p.total === 1 && p.done === 0 && p.open === 1))
    assert.ok(data.people.every((p) => p.tier && p.nodeName === 'Kidzonia Jubilee Hills'))
  })

  await t.test('tracks each assignee through their own states', async () => {
    const mine = await api('GET', '/api/tasks/my', { token: anjali })
    const anjaliInst = mine.data.dueToday.find((i) => i.taskId === taskId)
    await api('POST', `/api/task-instances/${anjaliInst.id}/start`, { token: anjali })

    const hers = await api('GET', '/api/tasks/my', { token: kavya })
    const kavyaInst = hers.data.dueToday.find((i) => i.taskId === taskId)
    await api('POST', `/api/task-instances/${kavyaInst.id}/submit`, { token: kavya })
    await api('POST', `/api/task-instances/${kavyaInst.id}/approve`, { token: lakshmi, body: { comment: 'Lovely' } })

    const { data } = await api('GET', `/api/tasks/${taskId}/progress`, { token: lakshmi })
    assert.equal(data.completion, 20)                        // 1 of 5
    assert.equal(forUser(data.people, 'u-teacher2').done, 1)
    assert.equal(forUser(data.people, 'u-teacher2').pct, 100)
    assert.equal(forUser(data.people, 'u-teacher').latestStatus, 'in_progress')
    assert.equal(forUser(data.people, 'u-teacher').done, 0)
    assert.ok(forUser(data.people, 'u-teacher2').lastActivityAt)

    // worst first, so whoever needs chasing is at the top
    assert.equal(data.people[data.people.length - 1].userId, 'u-teacher2')
  })

  await t.test('an assignee cannot read the whole-team rollup of a task they are not above', async () => {
    const peek = await api('GET', `/api/tasks/${taskId}/progress`, { token: anjali })
    assert.equal(peek.status, 200)                           // she is on it, so she may see it
    const gb = await api('GET', `/api/tasks/${taskId}/progress`, { token: await login('teacher.gb@kidzonia.com') })
    assert.equal(gb.status, 404)                             // unrelated branch: does not exist for her
  })
})

// ---------------------------------------------------------------------------
test('a deadline can carry a time of day', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday('Asia/Kolkata')

  await t.test('due at 15:30 resolves to 15:30 in the SCHOOL timezone', async () => {
    const res = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Hand the register to the office',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        recurrence: { freq: 'none', startDate: today },
        dueType: 'at_time',
        dueConfig: { time: '15:30' },
      },
    })
    assert.equal(res.status, 201, JSON.stringify(res.data))
    const inst = (await api('GET', `/api/task-instances?taskId=${res.data.id}`, { token: lakshmi })).data[0]

    // 15:30 IST is 10:00 UTC — the point is that it is NOT end of day
    const due = new Date(inst.dueAt)
    const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(due)
    assert.equal(hhmm, '15:30')
    assert.notEqual(inst.dueAt.slice(11, 16), '18:29')
  })

  await t.test('a bad time is refused rather than silently becoming midnight', async () => {
    const bad = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Nonsense time',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        recurrence: { freq: 'none', startDate: today },
        dueType: 'at_time',
        dueConfig: { time: '25:99' },
      },
    })
    assert.equal(bad.status, 422)
    assert.match(bad.data.message, /HH:MM/)
  })

  await t.test('it is LATE after its time, but does not hold sign-off until the day ends', async () => {
    const res = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Mandatory by 3pm',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        recurrence: { freq: 'none', startDate: today },
        isBlocking: true,
        dueType: 'at_time',
        dueConfig: { time: '15:00' },
      },
    })
    const id = (await api('GET', `/api/task-instances?taskId=${res.data.id}`, { token: lakshmi })).data[0].id

    // wind the clock past its time, but leave it on today
    const { getDb } = await import('../db.js')
    const raw = getDb().taskInstances.find((i) => i.id === id)
    raw.dueAt = new Date(Date.now() - 60000).toISOString()

    await api('GET', '/api/tasks/my', { token: anjali })
    assert.equal((await api('GET', `/api/task-instances/${id}`, { token: anjali })).data.status, 'overdue', 'late the moment its time passes')

    const gate = (await api('GET', '/api/tasks/logout-check', { token: anjali })).data
    assert.ok(!gate.armed, 'but nobody is frozen out mid-afternoon — the gate still works in whole days')
  })
})
