// What one mode plus a list of questions buys that three natures could not.
//
// The old model made `mcq`, `custom` and `module_linked` MUTUALLY EXCLUSIVE, so
// a task could ask a question or check the system, never both, and never more
// than one question. These are the sentences that were previously impossible.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'
const ANJALI_SECTION = 'sec-jh-nursery-a'

test('completion: several questions, and a system check alongside them', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)

  // the demo seed marks today's register, which would satisfy the `both` case
  // below before it is exercised
  const { getDb } = await import('../db.js')
  getDb().attendanceRecords = getDb().attendanceRecords.filter((r) => !(r.sectionId === ANJALI_SECTION && r.date === today))

  const create = (body) => api('POST', '/api/tasks', {
    token: lakshmi,
    body: {
      target: { positionIds: ['pos-anjali'], followJoiners: false },
      recurrence: { freq: 'none', startDate: today },
      ...body,
    },
  })
  const firstInstance = async (taskId) => (await api('GET', `/api/task-instances?taskId=${taskId}`, { token: lakshmi })).data[0]

  await t.test('THE SENTENCE THAT WAS IMPOSSIBLE: three questions on one task', async () => {
    const created = await create({
      title: 'Close the nursery room',
      completionCondition: {
        mode: 'answers',
        questions: [
          {
            id: 'aired', type: 'yes_no', prompt: 'Was the room aired?',
            options: [{ value: 'yes', label: 'Yes', accepts: true }, { value: 'no', label: 'No' }],
            requiredAnswer: 'yes',
          },
          { id: 'checks', type: 'checklist', prompt: 'Before you lock up', items: [{ text: 'Cots stripped' }, { text: 'Lights off' }] },
          // optional: an unanswered optional question must not hold the submit
          { id: 'handover', type: 'text', prompt: 'Anything for the morning shift?', required: false },
        ],
      },
    })
    assert.equal(created.status, 201)
    assert.deepEqual(created.data.completionCondition.questions.map((q) => q.id), ['aired', 'checks', 'handover'])
    assert.deepEqual(created.data.completionCondition.questions[1].items.map((i) => i.id), ['cots-stripped', 'lights-off'])

    const inst = await firstInstance(created.data.id)
    // the questions are asked IN ORDER, and the first unanswered one is what
    // the message names — the old shape could only ever have one to name
    assert.equal(inst.condition.code, 'answer_required')
    assert.equal(inst.condition.message, 'Was the room aired?')

    // MERGE, NOT REPLACE. Saving one answer must not wipe the others; with one
    // question a total replacement was safe, with three it is data loss.
    await api('POST', `/api/task-instances/${inst.id}/answer`, { token: anjali, body: { answers: { aired: 'yes' } } })
    await api('POST', `/api/task-instances/${inst.id}/answer`, { token: anjali, body: { answers: { checks: ['cots-stripped', 'lights-off'] } } })
    const saved = (await api('GET', `/api/task-instances/${inst.id}`, { token: anjali })).data
    assert.equal(saved.completion.answers.aired, 'yes', 'the first answer survived the second save')
    assert.deepEqual(saved.completion.answers.checks, ['cots-stripped', 'lights-off'])

    // the handover note is optional, so that is the whole condition met
    const done = await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })
    assert.equal(done.status, 200)
    assert.equal(done.data.status, 'approved')
  })

  await t.test('a wrong answer to the SECOND question names that question', async () => {
    const created = await create({
      title: 'Two gates',
      completionCondition: {
        mode: 'answers',
        questions: [
          { id: 'one', type: 'yes_no', prompt: 'Register signed?', options: [{ value: 'yes', label: 'Yes', accepts: true }, { value: 'no', label: 'No' }] },
          { id: 'two', type: 'yes_no', prompt: 'Keys returned?', options: [{ value: 'yes', label: 'Yes', accepts: true }, { value: 'no', label: 'No' }] },
        ],
      },
    })
    const inst = await firstInstance(created.data.id)
    await api('POST', `/api/task-instances/${inst.id}/answer`, { token: anjali, body: { answers: { one: 'yes', two: 'no' } } })
    const refused = await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })
    assert.equal(refused.status, 422)
    assert.equal(refused.data.error, 'answer_not_accepted')
    assert.deepEqual(refused.data.missing, ['two'], 'the id of the question that is in the way')
  })

  await t.test('THE OTHER IMPOSSIBLE ONE: mode `both` — the system AND a question', async () => {
    const created = await create({
      title: 'Attendance, with a word about the day',
      completionCondition: {
        mode: 'both',
        system: {
          moduleKey: 'attendance', signalKey: 'isMarked',
          paramBinding: { sectionId: { source: 'assignee.section' }, date: { source: 'instance.serviceDate' } },
        },
        questions: [{ id: 'note', type: 'text', prompt: 'Anything to flag about today?' }],
      },
    })
    assert.equal(created.status, 201)
    assert.equal(created.data.completionCondition.mode, 'both')

    const inst = await firstInstance(created.data.id)
    const hers = (await api('GET', `/api/task-instances/${inst.id}`, { token: anjali })).data
    // THE SYSTEM CHECK RUNS FIRST. An unjudgeable or unmet signal must not be
    // masked by a missing answer the person can still go and give.
    assert.equal(inst.condition.satisfied, false)
    assert.equal(inst.condition.code, 'module_not_done')
    // …and unlike mode `system`, this one DOES have something to type
    assert.equal(hers.can.answer, true, 'a both task asks the questions it declares')

    const typed = await api('POST', `/api/task-instances/${inst.id}/answer`, {
      token: anjali, body: { answers: { note: 'Two children left early.' } },
    })
    assert.equal(typed.status, 200, 'not refused as a derived answer')

    // the answer alone is not enough — the signal still has to hold
    const early = await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })
    assert.equal(early.status, 422)
    assert.equal(early.data.error, 'module_not_done')

    const roster = (await api('GET', `/api/attendance?sectionId=${ANJALI_SECTION}&date=${today}`, { token: anjali })).data
    await api('POST', '/api/attendance', {
      token: anjali,
      body: { sectionId: ANJALI_SECTION, date: today, records: roster.map((c) => ({ studentId: c.studentId, status: 'present' })) },
    })

    const done = await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })
    assert.equal(done.status, 200)
    assert.equal(done.data.status, 'approved')
    assert.equal(done.data.completion.answers.note, 'Two children left early.')
    // the pull guard still ran and still froze what satisfied it
    assert.equal(done.data.completionEvidence.moduleKey, 'attendance')
  })

  await t.test('a `both` task with no questions is refused rather than silently a system check', async () => {
    const bad = await create({
      title: 'Neither one thing nor the other',
      completionCondition: {
        mode: 'both',
        system: { moduleKey: 'attendance', signalKey: 'isMarked' },
        questions: [],
      },
    })
    assert.equal(bad.status, 422)
    assert.match(bad.data.message, /needs at least one question/)
  })

  await t.test('mode `system` still refuses a hand-typed answer', async () => {
    const created = await create({
      title: 'Attendance only',
      completionCondition: {
        mode: 'system',
        questions: [],
        system: { moduleKey: 'attendance', signalKey: 'isMarked' },
      },
    })
    const inst = (await api('GET', `/api/task-instances/${(await firstInstance(created.data.id)).id}`, { token: anjali })).data
    assert.equal(inst.can.answer, false, 'a derived answer is never typed by the assignee')
    const byHand = await api('POST', `/api/task-instances/${inst.id}/answer`, { token: anjali, body: { answers: { anything: 'yes' } } })
    assert.equal(byHand.status, 422)
    assert.equal(byHand.data.error, 'derived_answer')
  })

  await t.test('a question type nothing publishes is refused, not stored', async () => {
    const bad = await create({
      title: 'Interpretive dance',
      completionCondition: { mode: 'answers', questions: [{ id: 'x', type: 'interpretive_dance', prompt: 'Well?' }] },
    })
    assert.equal(bad.status, 422)
    assert.match(bad.data.message, /type must be one of/)
  })

  await t.test('an answer to a question the condition never asked is dropped, not stored', async () => {
    const created = await create({
      title: 'One question only',
      completionCondition: { mode: 'answers', questions: [{ id: 'note', type: 'text', prompt: 'How did it go?' }] },
    })
    const inst = await firstInstance(created.data.id)
    const saved = await api('POST', `/api/task-instances/${inst.id}/answer`, {
      token: anjali, body: { answers: { note: 'Fine', invented: 'nonsense' } },
    })
    assert.deepEqual(Object.keys(saved.data.completion.answers), ['note'])
  })
})

// ---------------------------------------------------------------------------
test('the logout gate opens the module a `both` task depends on', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)

  const { getDb } = await import('../db.js')
  getDb().attendanceRecords = getDb().attendanceRecords.filter((r) => !(r.sectionId === ANJALI_SECTION && r.date === yesterday))

  // Rule (3) of the gate: never block the thing the person has to do to get
  // unblocked. Under the old shape this read `nature === 'module_linked'`, so a
  // task that checked the system AND asked a question would have locked her out
  // of the module that unblocks her — the exact failure the rule exists for.
  const res = await api('POST', '/api/tasks', {
    token: lakshmi,
    body: {
      title: 'Attendance and a note (yesterday)',
      target: { positionIds: ['pos-anjali'], followJoiners: false },
      recurrence: { freq: 'none', startDate: yesterday },
      isBlocking: true,
      dueConfig: { startDate: yesterday, dueDate: yesterday },
      completionCondition: {
        mode: 'both',
        system: { moduleKey: 'attendance', signalKey: 'isMarked' },
        questions: [{ id: 'note', type: 'text', prompt: 'Anything to flag?' }],
      },
    },
  })
  assert.equal(res.status, 201)

  const id = (await api('GET', `/api/task-instances?taskId=${res.data.id}`, { token: lakshmi })).data[0].id
  const raw = getDb().taskInstances.find((i) => i.id === id)
  raw.serviceDate = yesterday
  raw.dueAt = new Date(Date.now() - 864e5).toISOString()
  raw.status = 'overdue'
  raw.conditionMet = false

  await t.test('the gate is armed', async () => {
    const blocked = await api('PUT', '/api/students/stu-1', { token: anjali, body: { firstName: 'Nope' } })
    assert.equal(blocked.status, 403)
    assert.equal(blocked.data.error, 'task_gate')
  })

  await t.test('but the module that clears it stays open', async () => {
    const roster = (await api('GET', `/api/attendance?sectionId=${ANJALI_SECTION}&date=${yesterday}`, { token: anjali })).data
    const marked = await api('POST', '/api/attendance', {
      token: anjali,
      body: { sectionId: ANJALI_SECTION, date: yesterday, records: roster.map((c) => ({ studentId: c.studentId, status: 'present' })) },
    })
    assert.equal(marked.status, 200)
    assert.equal(getDb().taskInstances.find((i) => i.id === id).conditionMet, true)
  })

  await t.test('and so does answering the question it also asks', async () => {
    const typed = await api('POST', `/api/task-instances/${id}/answer`, { token: anjali, body: { answers: { note: 'All present.' } } })
    assert.equal(typed.status, 200)
    const done = await api('POST', `/api/task-instances/${id}/submit`, { token: anjali })
    assert.equal(done.status, 200)
    assert.equal(done.data.status, 'approved')
  })
})
