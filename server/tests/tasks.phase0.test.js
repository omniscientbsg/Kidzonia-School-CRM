// Regressions for six bugs that were live in the engine and that nothing was
// watching. Each one is here because it was found by reading, not by a failure —
// which is exactly why each needs a test that fails if it comes back.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday, addDays } from '../tasks/time.js'
import { normalizeTask } from '../tasks/model.js'

const TZ = 'Asia/Kolkata'

test('phase 0: six bugs that were live', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)

  await t.test('gateOrder survives normalizeTask, so editing a day-end template keeps it last', () => {
    // normalizeTask builds the stored task field by field. gateOrder was not one
    // of them, so a PUT returned a task without it — and because gateOrder is in
    // SNAPSHOT_FIELDS, applyTemplateEdit then wrote `undefined` onto every future
    // occurrence and the day-end report stopped sorting to the bottom of the gate.
    const { task } = normalizeTask({ title: 'Submit Day-End Report', gateOrder: 100 })
    assert.equal(task.gateOrder, 100)

    // and an ordinary task still defaults to 0 rather than undefined
    const { task: plain } = normalizeTask({ title: 'Anything else' })
    assert.equal(plain.gateOrder, 0)

    // a nonsense value does not poison the sort
    const { task: junk } = normalizeTask({ title: 'x', gateOrder: 'soon' })
    assert.equal(junk.gateOrder, 0)
  })

  await t.test('an edit through the API keeps gateOrder on the row and on future work', async () => {
    const made = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Sorts last',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        recurrence: { freq: 'daily', startDate: today },
        isBlocking: true,
        gateOrder: 100,
      },
    })
    assert.equal(made.status, 201)
    assert.equal(made.data.gateOrder, 100)

    const edited = await api('PUT', `/api/tasks/${made.data.id}`, {
      token: lakshmi,
      body: { ...made.data, title: 'Sorts last, renamed' },
    })
    assert.equal(edited.status, 200)
    assert.equal(edited.data.gateOrder, 100, 'the edit must not drop it')

    const rows = (await api('GET', `/api/task-instances?taskId=${made.data.id}`, { token: lakshmi })).data
    assert.ok(rows.length > 0)
    assert.ok(rows.every((i) => i.gateOrder === 100), 'and it must not be undefined on the occurrences')
  })

  await t.test('a gated admin can still configure the module that is gating them', async () => {
    // /escalation-policies matched none of the exempt patterns, so the one person
    // who could fix an escalation problem was locked out of doing it. Same for
    // every task master: /^\/tasks(\/|$)/ does not match /task-priorities.
    // assigned from ABOVE her — nobody can assign work to themselves
    const nandita = await login('nandita.rao@kidzonia.com')
    const missed = await api('POST', '/api/tasks', {
      token: nandita,
      body: {
        title: 'Yesterday’s mandatory thing',
        target: { kind: 'position', positionIds: ['pos-lakshmi'] },
        recurrence: { freq: 'none', startDate: addDays(today, -1) },
        isBlocking: true,
      },
    })
    assert.equal(missed.status, 201)
    assert.equal((await api('GET', '/api/tasks/logout-check', { token: lakshmi })).data.armed, true)

    // an unrelated write is refused, which is the gate working
    const elsewhere = await api('POST', '/api/task-categories', { token: lakshmi, body: { name: 'Blocked?' } })
    assert.notEqual(elsewhere.status, 403, 'task masters are exempt — this is module config, not other work')

    const policy = await api('POST', '/api/escalation-policies', {
      token: lakshmi,
      body: { name: 'School approvals', stages: [{ resolver: 'next_ancestor', slaMinutes: 120 }] },
    })
    assert.notEqual(policy.status, 403, 'escalation policy config must not be gated')
    assert.equal(policy.status, 201)

    const edit = await api('PUT', `/api/escalation-policies/${policy.data.id}`, {
      token: lakshmi,
      body: { name: 'School approvals v2', stages: [{ resolver: 'next_ancestor', slaMinutes: 240 }] },
    })
    assert.equal(edit.status, 200)
  })

  await t.test('the occurrence keeps the deadline rule it was issued under', async () => {
    // dueType IS snapshotted onto the occurrence so a template edit cannot retime
    // work already in flight. decorateInstance then read it back off the live
    // template, handing the client a different value from the one selfDeferLimit
    // judges against.
    const made = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Three days to do it',
        target: { kind: 'position', positionIds: ['pos-anjali'] },
        recurrence: { freq: 'none', startDate: today },
        dueType: 'n_days',
        dueConfig: { days: 3 },
      },
    })
    const id = (await api('GET', `/api/task-instances?taskId=${made.data.id}`, { token: lakshmi })).data[0].id

    // retype the template. The occurrence is for TODAY, so it is not rewritable
    // (isRewritable requires a future service date) and must keep n_days.
    const edited = await api('PUT', `/api/tasks/${made.data.id}`, {
      token: lakshmi,
      body: { ...made.data, dueType: 'end_of_day', dueConfig: { startDate: null, dueDate: null, days: null } },
    })
    assert.equal(edited.status, 200)

    const inst = (await api('GET', `/api/task-instances/${id}`, { token: anjali })).data
    assert.equal(inst.dueType, 'n_days', 'the snapshot wins over the live template')
    // and the two agree: selfDeferLimit only exists for n_days, and the client
    // reads dueType to decide whether to offer the defer control at all
    assert.ok(inst.selfDeferLimit, 'the deferral window and the displayed dueType must agree')
  })
})
