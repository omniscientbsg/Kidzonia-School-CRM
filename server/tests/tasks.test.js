import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'

test('tasks: templates, targets and downline enforcement', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()   // demo board out of the way; these tests build their own

  const meera = await login('superadmin@kidzonia.com')
  const nandita = await login('nandita.rao@kidzonia.com')
  const prakash = await login('prakash.reddy@kidzonia.com')
  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')

  await t.test('preview shows who gets it and who is skipped', async () => {
    const { status, data } = await api('POST', '/api/tasks/preview-targets', {
      token: lakshmi,
      body: { target: { kind: 'node_level', nodeIds: ['node-sch-jh'], levelId: 'lvl-teacher' } },
    })
    assert.equal(status, 200)
    assert.equal(data.count, 5)                                   // 5 teachers at JH
    assert.ok(data.people.every((p) => p.levelId === 'lvl-teacher'))
    assert.ok(data.people.some((p) => p.tier === 'Senior Teacher'))  // display title overrides the tier label
    assert.equal(data.rejected.length, 0)

    // a broad node target silently skips the principal herself and her peers
    const whole = await api('POST', '/api/tasks/preview-targets', {
      token: lakshmi,
      body: { target: { kind: 'node', nodeIds: ['node-sch-jh'] } },
    })
    assert.ok(!whole.data.people.some((p) => p.userName === 'Lakshmi Devi'))
    assert.ok(whole.data.people.some((p) => p.tier === 'Vice Principal'))

    // an explicit pick that is out of reach is reported, not silently dropped
    const bad = await api('POST', '/api/tasks/preview-targets', {
      token: lakshmi,
      body: { target: { kind: 'position', positionIds: ['pos-sunil'] } },
    })
    assert.equal(bad.data.count, 0)
    assert.equal(bad.data.rejected[0].userName, 'Sunil Kumar')
  })

  await t.test('HQ downline spans both branches regardless of depth', async () => {
    const { data } = await api('POST', '/api/tasks/preview-targets', {
      token: nandita,
      body: { target: { kind: 'downline' } },
    })
    const names = data.people.map((p) => p.userName)
    assert.ok(names.includes('Anjali Rao'))       // franchise branch, depth 2
    assert.ok(names.includes('Divya Nair'))       // company-owned branch, depth 1
    assert.ok(names.includes('Prakash Reddy'))
    assert.ok(!names.includes('Meera Krishnan'))  // senior at her own node
    assert.ok(!names.includes('Nandita Rao'))     // never yourself
  })

  await t.test('creating a task validates the target against the tree', async () => {
    const ok = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Submit attendance before leaving',
        description: 'Mark every child present/absent in the app.',
        target: { kind: 'node_level', nodeIds: ['node-sch-jh'], levelId: 'lvl-teacher' },
        priority: 'high',
        dueType: 'end_of_day',
        recurrence: { freq: 'daily' },
        isBlocking: true,
      },
    })
    assert.equal(ok.status, 201)
    assert.equal(ok.data.targets.count, 5)
    assert.equal(ok.data.createdByTier, 'Principal')
    assert.equal(ok.data.approverPositionId, 'pos-lakshmi')   // defaults to the assigner

    const upward = await api('POST', '/api/tasks', {
      token: anjali,
      body: { title: 'Principal, do this', target: { kind: 'position', positionIds: ['pos-lakshmi'] } },
    })
    assert.equal(upward.status, 403)
    assert.equal(upward.data.error, 'not_in_downline')

    const sideways = await api('POST', '/api/tasks', {
      token: prakash,
      body: { title: 'Cross-school order', target: { kind: 'position', positionIds: ['pos-divya'] } },
    })
    assert.equal(sideways.status, 403)

    const empty = await api('POST', '/api/tasks', {
      token: anjali,
      body: { title: 'Nobody below me', target: { kind: 'downline' } },
    })
    assert.equal(empty.status, 422)
    assert.equal(empty.data.error, 'no_targets')
  })

  await t.test('validation: dates, recurrence and media rules', async () => {
    const badWindow = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Bad window', target: { kind: 'node', nodeIds: ['node-sch-jh'] },
        dueType: 'date_window', dueConfig: { startDate: '2026-09-10', dueDate: '2026-09-01' },
      },
    })
    assert.equal(badWindow.status, 422)
    assert.match(badWindow.data.message, /dueDate must be on or after/)

    const recurringWindow = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Impossible', target: { kind: 'node', nodeIds: ['node-sch-jh'] },
        dueType: 'date_window', dueConfig: { startDate: '2026-09-01', dueDate: '2026-09-10' },
        recurrence: { freq: 'daily' },
      },
    })
    assert.equal(recurringWindow.status, 422)

    const noWeekday = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: { title: 'Which day?', target: { kind: 'node', nodeIds: ['node-sch-jh'] }, recurrence: { freq: 'weekdays', byWeekday: [] } },
    })
    assert.equal(noWeekday.status, 422)

    const noMedia = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: { title: 'Proof please', target: { kind: 'node', nodeIds: ['node-sch-jh'] }, requiresMedia: true, mediaTypes: [] },
    })
    assert.equal(noMedia.status, 422)
  })

  await t.test('approver must sit above every assignee', async () => {
    const bad = await api('POST', '/api/tasks', {
      token: nandita,
      body: {
        title: 'Cross-branch review',
        target: { kind: 'downline' },
        requiresApproval: true,
        approverPositionId: 'pos-prakash',      // owns only the JH subtree
      },
    })
    assert.equal(bad.status, 422)
    assert.equal(bad.data.error, 'invalid_approver')

    const good = await api('POST', '/api/tasks', {
      token: nandita,
      body: {
        title: 'JH monthly audit',
        target: { kind: 'node', nodeIds: ['node-sch-jh'] },
        requiresApproval: true,
        approverPositionId: 'pos-prakash',      // above everyone at the JH school
        recurrence: { freq: 'monthly', dayOfMonth: 5 },
      },
    })
    assert.equal(good.status, 201)
  })

  await t.test('visibility and editing follow the same upward line', async () => {
    const mine = await api('GET', '/api/tasks', { token: lakshmi })
    assert.ok(mine.data.some((x) => x.title === 'Submit attendance before leaving'))

    // the teacher created nothing and manages nobody
    const teacherView = await api('GET', '/api/tasks', { token: anjali })
    assert.equal(teacherView.data.length, 0)

    // HQ sees what the principal created, because the principal is below HQ
    const hqView = await api('GET', '/api/tasks', { token: meera })
    const task = hqView.data.find((x) => x.title === 'Submit attendance before leaving')
    assert.ok(task)

    // priorities are master data now; the legacy string is still accepted on the
    // way in and normalizes to the id, so an un-updated client keeps working
    const edited = await api('PUT', `/api/tasks/${task.id}`, { token: meera, body: { priority: 'urgent' } })
    assert.equal(edited.status, 200)
    assert.equal(edited.data.priority, 'prio-urgent')
    assert.equal(edited.data.priorityName, 'Urgent')
    assert.equal(edited.data.priorityRank, 10)

    const byTeacher = await api('PUT', `/api/tasks/${task.id}`, { token: anjali, body: { priority: 'low' } })
    assert.equal(byTeacher.status, 403)

    const cancelled = await api('POST', `/api/tasks/${task.id}/cancel`, { token: lakshmi, body: { reason: 'Replaced by the new checklist' } })
    assert.equal(cancelled.status, 200)
    assert.equal(cancelled.data.status, 'cancelled')
  })
})
