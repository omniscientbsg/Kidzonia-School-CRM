// Task templates: reuse the WORK, decide the people each time.
//
// `taskTemplates` has existed as a collection since the masters slice, with a
// screen that could rename and delete but nothing anywhere that could create
// one — so the list was permanently empty.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

test('templates carry the work, never the people', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const today = localToday(TZ)

  const payload = {
    title: 'Close down the nursery room',
    description: 'Strip, air, lock.',
    dueType: 'at_time',
    dueConfig: { startDate: today, dueDate: today, time: '17:30' },
    expiry: { mode: 'after_days', days: 2 },
    recurrence: { freq: 'daily', byWeekday: [], dayOfMonth: null, interval: 1, startDate: today, endDate: null, skipNonWorkingDays: true },
    isBlocking: true,
    requiresMedia: true,
    mediaTypes: ['photo'],
    minAttachments: 1,
    completionCondition: {
      mode: 'answers',
      questions: [{ id: 'aired', type: 'yes_no', prompt: 'Was the room aired?', options: [{ value: 'yes', label: 'Yes', accepts: true }, { value: 'no', label: 'No' }], requiredAnswer: 'yes' }],
    },
    // the assign form always sends one; it must not survive into the template
    target: { positionIds: ['pos-anjali'], followJoiners: false },
  }

  let tplId = null

  await t.test('a template needs a name and something to apply', async () => {
    const noName = await api('POST', '/api/task-templates', { token: lakshmi, body: { payload } })
    assert.equal(noName.status, 422)
    assert.match(noName.data.message, /needs a name/)

    const noPayload = await api('POST', '/api/task-templates', { token: lakshmi, body: { name: 'Empty' } })
    assert.equal(noPayload.status, 422)
    assert.match(noPayload.data.message, /something to apply/)

    const noTitle = await api('POST', '/api/task-templates', {
      token: lakshmi, body: { name: 'Untitled work', payload: { description: 'x' } },
    })
    assert.equal(noTitle.status, 422)
    assert.match(noTitle.data.message, /task title/)
  })

  await t.test('THE RULE: the target is stripped, everything else is kept', async () => {
    const made = await api('POST', '/api/task-templates', {
      token: lakshmi,
      body: { name: 'Nursery close-down', description: 'Any classroom, end of day', payload },
    })
    assert.equal(made.status, 201)
    tplId = made.data.id

    // a frozen list of people inside a template goes stale in silence, and who
    // does the work is a decision made when the work is assigned
    assert.equal(made.data.payload.target, undefined, 'the people do not travel with the template')

    assert.equal(made.data.payload.title, 'Close down the nursery room')
    assert.equal(made.data.payload.dueType, 'at_time')
    assert.equal(made.data.payload.dueConfig.time, '17:30')
    assert.deepEqual(made.data.payload.expiry, { mode: 'after_days', days: 2 })
    assert.equal(made.data.payload.isBlocking, true)
    assert.equal(made.data.payload.requiresMedia, true)
    assert.deepEqual(made.data.payload.completionCondition.questions.map((q) => q.id), ['aired'])
  })

  await t.test('applying it produces a real task, with a target chosen now', async () => {
    const tpl = (await api('GET', `/api/task-templates/${tplId}`, { token: lakshmi })).data
    const created = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: { ...tpl.payload, target: { positionIds: ['pos-anjali'], followJoiners: false } },
    })
    assert.equal(created.status, 201)
    assert.equal(created.data.title, 'Close down the nursery room')
    assert.equal(created.data.dueType, 'at_time')
    assert.deepEqual(created.data.expiry, { mode: 'after_days', days: 2 })
    assert.equal(created.data.isBlocking, true)
    assert.deepEqual(created.data.completionCondition.questions.map((q) => q.id), ['aired'])
    // and it is a COPY: nothing on the task points back at the template
    assert.equal(created.data.templateId, undefined)
  })

  await t.test('editing the template afterwards does not touch work already out', async () => {
    const before = (await api('GET', '/api/tasks', { token: lakshmi })).data
      .find((x) => x.title === 'Close down the nursery room')
    assert.ok(before)

    const edited = await api('PUT', `/api/task-templates/${tplId}`, {
      token: lakshmi,
      body: { name: 'Nursery close-down', payload: { ...before, title: 'Something else entirely' } },
    })
    assert.equal(edited.status, 200)
    assert.equal(edited.data.payload.title, 'Something else entirely')

    const after = (await api('GET', `/api/tasks/${before.id}`, { token: lakshmi })).data
    assert.equal(after.title, 'Close down the nursery room', 'the assigned work is untouched')
  })
})
