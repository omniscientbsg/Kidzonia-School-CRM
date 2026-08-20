import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday, addDays } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

test('dashboards: role-aware roll-ups bounded by the org tree', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const nandita = await login('nandita.rao@kidzonia.com')   // HQ — sees both schools
  const prakash = await login('prakash.reddy@kidzonia.com') // franchise owner — JH only
  const lakshmi = await login('principal@kidzonia.com')     // JH principal
  const sunil = await login('principal.gb@kidzonia.com')    // GB principal
  const anjali = await login('teacher@kidzonia.com')
  const kavya = await login('teacher2@kidzonia.com')
  const today = localToday(TZ)

  // JH: one task for the teachers
  const jh = await api('POST', '/api/tasks', {
    token: lakshmi,
    body: {
      title: 'Tidy the reading corner',
      target: { kind: 'node_level', nodeIds: ['node-sch-jh'], levelId: 'lvl-teacher' },
      requiresApproval: true,
      recurrence: { freq: 'none', startDate: today },
    },
  })
  // GB: one task for its teacher, so the other branch has data of its own
  await api('POST', '/api/tasks', {
    token: sunil,
    body: {
      title: 'Check the play equipment',
      target: { kind: 'position', positionIds: ['pos-divya'] },
      recurrence: { freq: 'none', startDate: today },
    },
  })

  // drive some real states: Kavya finishes, Anjali starts, the rest sit
  const kavyaInst = (await api('GET', '/api/tasks/my', { token: kavya })).data.dueToday.find((i) => i.taskId === jh.data.id)
  await api('POST', `/api/task-instances/${kavyaInst.id}/submit`, { token: kavya })
  await api('POST', `/api/task-instances/${kavyaInst.id}/approve`, { token: lakshmi })
  const anjaliInst = (await api('GET', '/api/tasks/my', { token: anjali })).data.dueToday.find((i) => i.taskId === jh.data.id)
  await api('POST', `/api/task-instances/${anjaliInst.id}/start`, { token: anjali })

  await t.test('HQ sees both branches; the franchise owner sees only his own', async () => {
    const hq = await api('GET', '/api/tasks/analytics', { token: nandita })
    assert.equal(hq.status, 200)
    const hqNodes = hq.data.team.nodes.map((n) => n.nodeName)
    assert.ok(hqNodes.includes('Kidzonia Jubilee Hills'))
    assert.ok(hqNodes.includes('Kidzonia Gachibowli'))

    const owner = await api('GET', '/api/tasks/analytics', { token: prakash })
    const ownerNodes = owner.data.team.nodes.map((n) => n.nodeName)
    assert.ok(ownerNodes.includes('Kidzonia Jubilee Hills'))
    assert.ok(!ownerNodes.includes('Kidzonia Gachibowli'))
    assert.ok(!owner.data.team.people.some((p) => p.userName === 'Divya Nair'))

    // a school principal sees only her own subtree
    const jhOnly = await api('GET', '/api/tasks/analytics', { token: lakshmi })
    assert.deepEqual(jhOnly.data.team.nodes.map((n) => n.nodeName), ['Kidzonia Jubilee Hills'])
    const gbOnly = await api('GET', '/api/tasks/analytics', { token: sunil })
    assert.deepEqual(gbOnly.data.team.nodes.map((n) => n.nodeName), ['Kidzonia Gachibowli'])
    assert.ok(!gbOnly.data.team.people.some((p) => p.userName === 'Anjali Rao'))
  })

  await t.test('a node filter can only narrow, never widen', async () => {
    // the GB principal asking for the JH node gets nothing, not JH data
    const sneak = await api('GET', '/api/tasks/analytics?nodeId=node-sch-jh', { token: sunil })
    assert.equal(sneak.status, 200)
    assert.equal(sneak.data.team.total, 0)
    assert.equal(sneak.data.team.people.length, 0)

    // asking for the HQ root does not promote her either
    const upward = await api('GET', '/api/tasks/analytics?nodeId=node-hq', { token: sunil })
    assert.ok(!upward.data.team.people.some((p) => p.userName === 'Anjali Rao'))

    // HQ narrowing to one school works as expected
    const narrowed = await api('GET', '/api/tasks/analytics?nodeId=node-sch-gb', { token: nandita })
    assert.deepEqual(narrowed.data.team.nodes.map((n) => n.nodeName), ['Kidzonia Gachibowli'])
  })

  await t.test('roll-ups by person, tier and node agree with each other', async () => {
    const { data } = await api('GET', '/api/tasks/analytics', { token: lakshmi })
    assert.equal(data.team.total, 5)                            // 5 JH teachers
    assert.equal(data.team.done, 1)                             // Kavya
    assert.equal(data.team.completionPct, 20)

    const sum = (rows) => rows.reduce((s, r) => s + r.total, 0)
    assert.equal(sum(data.team.people), data.team.total)
    assert.equal(sum(data.team.tiers), data.team.total)
    assert.equal(sum(data.team.nodes), data.team.total)

    const teacherTier = data.team.tiers.find((t) => t.tier === 'Teacher')
    assert.equal(teacherTier.total, 5)
    assert.equal(teacherTier.done, 1)
    assert.equal(teacherTier.pct, 20)

    // lowest completion first, so whoever needs chasing is at the top
    assert.equal(data.team.people[data.team.people.length - 1].userName, 'Kavya Menon')
    assert.equal(data.team.people[0].pct, 0)
  })

  await t.test('assignee view: completion, overdue and streaks', async () => {
    const mine = await api('GET', '/api/tasks/analytics', { token: kavya })
    assert.equal(mine.data.me.total, 1)
    assert.equal(mine.data.me.done, 1)
    assert.equal(mine.data.me.completionPct, 100)
    assert.equal(mine.data.me.streak.current, 1)               // today closed clean
    assert.ok(mine.data.me.streak.longest >= 1)

    const started = await api('GET', '/api/tasks/analytics', { token: anjali })
    assert.equal(started.data.me.completionPct, 0)
    assert.equal(started.data.me.streak.current, 0)            // still open today
    assert.equal(started.data.me.overdue, 0)

    // a teacher has no downline, so no roll-up is offered
    assert.equal(started.data.team.total, 0)
    assert.equal(started.data.team.people.length, 0)
    assert.equal(started.data.scope.canSeeTeam, false)
  })

  await t.test('overdue leaderboard and "blocked right now"', async () => {
    const yesterday = addDays(today, -1)
    await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Yesterday’s stock count',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        recurrence: { freq: 'none', startDate: yesterday },
        isBlocking: true,
      },
    })
    const { data } = await api('GET', '/api/tasks/analytics', { token: lakshmi })

    const leader = data.team.overdueLeaderboard[0]
    assert.equal(leader.userName, 'Anjali Rao')
    assert.equal(leader.overdue, 1)

    const blocked = data.blockedNow.find((b) => b.userName === 'Anjali Rao')
    assert.ok(blocked)
    assert.equal(blocked.armed, true)                          // from an earlier day: writes frozen
    assert.equal(blocked.daysStuck, 1)
    assert.equal(blocked.tier, 'Teacher')
    assert.ok(blocked.titles.includes('Yesterday’s stock count'))

    // and it is gone once a manager defers it
    const inst = (await api('GET', '/api/task-instances?scope=downline&status=overdue', { token: lakshmi })).data[0]
    await api('POST', `/api/task-instances/${inst.id}/defer`, { token: lakshmi, body: { to: addDays(today, 3), reason: 'Stock room shut' } })
    const after = await api('GET', '/api/tasks/analytics', { token: lakshmi })
    assert.ok(!after.data.blockedNow.some((b) => b.userName === 'Anjali Rao'))
  })

  await t.test('approval turnaround is measured submitted -> decided', async () => {
    const { data } = await api('GET', '/api/tasks/analytics', { token: lakshmi })
    assert.equal(data.approvalTurnaround.decisions, 1)
    assert.ok(data.approvalTurnaround.avgHours >= 0)
    assert.ok(data.approvalTurnaround.medianHours != null)
    const approver = data.approvalTurnaround.byApprover.find((a) => a.userName === 'Lakshmi Devi')
    assert.equal(approver.approved, 1)
    assert.equal(approver.overrides, 0)
  })

  await t.test('filters: status, tier and recurring vs one-off', async () => {
    const recurringTask = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Daily register check',
        target: { kind: 'position', positionIds: ['pos-renu'] },
        recurrence: { freq: 'daily', startDate: today },
      },
    })
    assert.equal(recurringTask.status, 201)

    const all = await api('GET', `/api/tasks/analytics?from=${today}&to=${today}`, { token: lakshmi })
    const onlyRecurring = await api('GET', `/api/tasks/analytics?recurring=true&from=${today}&to=${today}`, { token: lakshmi })
    const onlyOneOff = await api('GET', `/api/tasks/analytics?recurring=false&from=${today}&to=${today}`, { token: lakshmi })

    // Renu holds both a recurring and a one-off task, so she appears in both
    // views — what must differ is the counts, which have to partition the whole.
    assert.equal(onlyRecurring.data.team.total, 1)
    assert.deepEqual(onlyRecurring.data.team.people.map((p) => p.userName), ['Renu Nair'])
    assert.equal(onlyOneOff.data.team.total, 5)
    assert.equal(onlyOneOff.data.team.people.find((p) => p.userName === 'Renu Nair').total, 1)
    assert.equal(onlyRecurring.data.team.total + onlyOneOff.data.team.total, all.data.team.total)

    const onlyApproved = await api('GET', '/api/tasks/analytics?status=approved', { token: lakshmi })
    assert.equal(onlyApproved.data.team.total, onlyApproved.data.team.done)

    const byTier = await api('GET', '/api/tasks/analytics?levelId=lvl-teacher', { token: lakshmi })
    assert.ok(byTier.data.team.people.every((p) => p.tier === 'Teacher' || p.tier === 'Senior Teacher'))
  })

  await t.test('completion-over-time series covers the range in local dates', async () => {
    const from = addDays(today, -6)
    const { data } = await api('GET', `/api/tasks/analytics?from=${from}&to=${today}`, { token: lakshmi })
    assert.equal(data.range.from, from)
    assert.equal(data.range.timezone, TZ)
    assert.equal(data.series.length, 7)
    assert.equal(data.series[0].date, from)
    assert.equal(data.series[6].date, today)
    const todayPoint = data.series[6]
    assert.equal(todayPoint.assigned, todayPoint.done + todayPoint.open + (todayPoint.assigned - todayPoint.done - todayPoint.open))
    assert.ok(todayPoint.pct >= 0 && todayPoint.pct <= 100)
  })
})
