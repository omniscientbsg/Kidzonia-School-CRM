// Day-end forms: what each school actually asks its people at sign-off.
//
// Before this there was ONE hardcoded question for every person in every
// school, and `syncDayEndTemplates` reconciled only `target.positionIds` with a
// raw update() — so even if a form had existed, editing it would have reached
// neither the template nor the occurrences already generated from it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday, addDays } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'
const JH = 'node-sch-jh'
const GB = 'node-sch-gb'

// Day-end reporting is opt-in per node, and the seeded Mon–Sat week would give
// no occurrence at all on a Sunday. Same fixture as tasks.dayend.test.js.
async function enableDayEnd(nodeId) {
  const { getDb } = await import('../db.js')
  const node = getDb().orgNodes.find((n) => n.id === nodeId)
  node.settings = { ...(node.settings || {}), dayEndReport: true, workWeek: [0, 1, 2, 3, 4, 5, 6] }
}

const QUESTIONS = [
  { id: 'ratio', type: 'number', prompt: 'How many children were in your room at close?' },
  {
    id: 'incidents', type: 'yes_no', prompt: 'Any incidents to report?',
    options: [{ value: 'no', label: 'No', accepts: true }, { value: 'yes', label: 'Yes', accepts: true }],
    requiredAnswer: 'no',
  },
  { id: 'note', type: 'text', prompt: 'Anything else?', required: false },
]

const promptsOf = (row) => (row.completionCondition?.questions || []).map((q) => q.id)

test('day-end forms: a form is refused unless it can actually be filled in', async (t) => {
  await startServer()
  t.after(stopServer)
  const meera = await login('superadmin@kidzonia.com')

  const noName = await api('POST', '/api/day-end-forms', { token: meera, body: { questions: QUESTIONS } })
  assert.equal(noName.status, 422)
  assert.match(noName.data.message, /needs a name/)

  const noQuestions = await api('POST', '/api/day-end-forms', { token: meera, body: { name: 'Empty', questions: [] } })
  assert.equal(noQuestions.status, 422)
  assert.match(noQuestions.data.message, /at least one question/)

  const nonsense = await api('POST', '/api/day-end-forms', {
    token: meera,
    body: { name: 'Nonsense', questions: [{ id: 'x', type: 'interpretive_dance', prompt: 'Well?' }] },
  })
  assert.equal(nonsense.status, 422)
  assert.match(nonsense.data.message, /type must be one of/)
})

// ---------------------------------------------------------------------------
// The form exists BEFORE the school switches day-end reporting on, which is the
// ordinary way round: an admin writes the form, then turns the feature on.
test('day-end forms: each school and role asks its own questions', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const meera = await login('superadmin@kidzonia.com')
  const sunil = await login('principal.gb@kidzonia.com')
  const divya = await login('teacher.gb@kidzonia.com')
  const { getDb } = await import('../db.js')

  const myDayEnd = async (token) => {
    const mine = (await api('GET', '/api/tasks/my', { token })).data
    return [...mine.overdue, ...mine.dueToday].find((i) => i.title === 'Submit Day-End Report')
  }

  const made = await api('POST', '/api/day-end-forms', {
    token: meera,
    body: { name: 'Gachibowli — end of day', nodeId: GB, statement: 'How was it?', questions: QUESTIONS },
  })
  assert.equal(made.status, 201)
  assert.deepEqual(made.data.questions.map((q) => q.id), ['ratio', 'incidents', 'note'])
  const teacherForm = await api('POST', '/api/day-end-forms', {
    token: meera,
    body: {
      name: 'GB teachers only', nodeId: GB, levelId: 'lvl-teacher',
      questions: [{ id: 'nappies', type: 'number', prompt: 'Nappy changes logged?' }],
    },
  })
  assert.equal(teacherForm.status, 201)

  await enableDayEnd(GB)
  await api('GET', '/api/tasks/my', { token: meera })   // drives the sweep

  await t.test('a role-specific form gets its OWN template — one cannot ask two things', () => {
    const keys = getDb().tasks
      .filter((x) => (x.systemKey || '').startsWith(`day_end_report:${GB}`))
      .map((x) => x.systemKey).sort()
    assert.equal(keys.length, 2, 'the school-wide form and the teachers-only one')
    assert.ok(keys.includes(`day_end_report:${GB}`), 'the base key is untouched — nothing to migrate')
    assert.ok(keys.includes(`day_end_report:${GB}:${teacherForm.data.id}`))
  })

  await t.test('and each person is asked their own set', async () => {
    assert.deepEqual(promptsOf(await myDayEnd(divya)), ['nappies'], 'the teacher gets the teachers-only form')
    assert.deepEqual(promptsOf(await myDayEnd(sunil)), ['ratio', 'incidents', 'note'], 'the principal gets the school one')
  })

  await t.test('the composer is asked what the form asks, off its OWN snapshot', async () => {
    const preview = await api('GET', '/api/tasks/day-end/preview', { token: sunil })
    assert.equal(preview.status, 200)
    assert.deepEqual(preview.data.questions.map((q) => q.prompt), [
      'How many children were in your room at close?',
      'Any incidents to report?',
      'Anything else?',
    ])
    assert.equal(preview.data.statement, 'How was it?')
  })

  await t.test('filing answers every required question, and the report keeps them', async () => {
    const report = await myDayEnd(sunil)
    // the third is optional; the other two are not
    const short = await api('POST', `/api/task-instances/${report.id}/submit`, {
      token: sunil, body: { completion: { answers: { ratio: '12' } } },
    })
    assert.equal(short.status, 422)
    assert.deepEqual(short.data.missing, ['incidents'])

    const done = await api('POST', `/api/task-instances/${report.id}/submit`, {
      token: sunil, body: { completion: { answers: { incidents: 'no' } } },
    })
    assert.equal(done.status, 200, 'the first answer was merged, not replaced')
    assert.equal(done.data.status, 'approved')

    // it lands with the ancestor — HQ, since Sunil's school hangs off it
    const inbox = (await api('GET', '/api/tasks/day-end/received', { token: meera })).data
    const filed = inbox.reports.find((r) => r.byName === 'Sunil Kumar')
    assert.ok(filed, 'it reached the person above him')
    assert.equal(filed.answers.ratio, 12)
    assert.equal(filed.answers.incidents, 'no')
    // the report carries its OWN copy of the questions, so it stays legible
    // after the form is rewritten or deleted
    assert.deepEqual(filed.questions.map((q) => q.id), ['ratio', 'incidents', 'note'])
  })
})

// ---------------------------------------------------------------------------
test('day-end forms: an edit reaches the template and tomorrow, never tonight', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()
  await enableDayEnd(JH)

  const meera = await login('superadmin@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)
  const { getDb } = await import('../db.js')

  await api('GET', '/api/tasks/my', { token: anjali })

  const template = () => getDb().tasks.find((x) => x.systemKey === `day_end_report:${JH}`)
  const hers = (date) => getDb().taskInstances.find((i) => (
    i.assigneeUserId === 'u-teacher' && i.serviceDate === date
    && (getDb().tasks.find((x) => x.id === i.taskId)?.systemKey || '').startsWith('day_end_report')
  ))

  await t.test('with no form, the template carries the built-in single note', () => {
    assert.deepEqual(promptsOf(template()), ['note'])
    assert.deepEqual(promptsOf(hers(today)), ['note'])
  })

  await t.test('a new form reaches the template and every FUTURE occurrence', async () => {
    const res = await api('POST', '/api/day-end-forms', {
      token: meera, body: { name: 'JH', nodeId: JH, questions: QUESTIONS },
    })
    assert.equal(res.status, 201)
    await api('GET', '/api/tasks/my', { token: meera })

    assert.deepEqual(promptsOf(template()), ['ratio', 'incidents', 'note'])
    assert.deepEqual(promptsOf(hers(addDays(today, 1))), ['ratio', 'incidents', 'note'])
  })

  await t.test('but TONIGHT’s report keeps the questions it was assigned under', () => {
    // The same rule every other template edit follows (isRewritable: untouched
    // AND a later service date). Changing the questions under someone who is
    // halfway through answering them is the thing the snapshot exists to stop.
    assert.deepEqual(promptsOf(hers(today)), ['note'])
  })

  await t.test('deleting the form falls the future back to the built-in note', async () => {
    const forms = (await api('GET', '/api/day-end-forms', { token: meera })).data
    const jh = forms.find((f) => f.name === 'JH')
    await api('DELETE', `/api/day-end-forms/${jh.id}`, { token: meera })
    await api('GET', '/api/tasks/my', { token: meera })

    assert.deepEqual(promptsOf(template()), ['note'])
    assert.deepEqual(promptsOf(hers(addDays(today, 1))), ['note'])
  })
})

// ---------------------------------------------------------------------------
test('day-end forms: the most specific match wins', async (t) => {
  const { pickDayEndForm, dayEndCondition, BUILT_IN_QUESTIONS } = await import('../tasks/dayend.js')

  const forms = [
    { id: 'f-global', name: 'Everyone', nodeId: null, levelId: null, questions: [] },
    { id: 'f-role', name: 'Teachers everywhere', nodeId: null, levelId: 'lvl-teacher', questions: [] },
    { id: 'f-node', name: 'Jubilee Hills', nodeId: JH, levelId: null, questions: [] },
    { id: 'f-both', name: 'JH teachers', nodeId: JH, levelId: 'lvl-teacher', questions: [] },
  ]

  await t.test('school AND role beats school, beats role, beats everybody', () => {
    assert.equal(pickDayEndForm(JH, 'lvl-teacher', forms).id, 'f-both')
    assert.equal(pickDayEndForm(JH, 'lvl-daycare', forms).id, 'f-node')
    assert.equal(pickDayEndForm(GB, 'lvl-teacher', forms).id, 'f-role')
    assert.equal(pickDayEndForm(GB, 'lvl-daycare', forms).id, 'f-global')
  })

  await t.test('nothing matching at all is the built-in note, not a crash', () => {
    assert.equal(pickDayEndForm(JH, 'lvl-teacher', []), null)
    assert.deepEqual(dayEndCondition(null).questions, BUILT_IN_QUESTIONS)
    assert.equal(dayEndCondition(null).mode, 'answers')
    // NOT mode 'both': there is no signal a day-end report completes on. The
    // roll-up is computed and frozen at submission by fileDayEndReport; it does
    // not gate anything, and inventing a capability for it to check would be a
    // fiction the capability registry would then have to carry.
    assert.equal(dayEndCondition(null).system, null)
  })
})
