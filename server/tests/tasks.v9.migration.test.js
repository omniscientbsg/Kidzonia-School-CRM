// _tasksV9: three mutually exclusive natures become one mode plus questions.
//
// Written by hand against a pre-migration db.json, like tasks.migration.test.js
// and tasks.parents.migration.test.js, because the whole point is what happens
// to rows that already exist. This one rewrites the taskInstances SNAPSHOT as
// well as the templates — the snapshot is what an in-flight occurrence is
// judged against — which is what makes it the riskiest migration in the
// redesign.
//
// The live database only carries 5 of the 8 statuses, so the fixture below
// carries all 8: a status the migration skips is a row nobody can submit.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const tmp = path.join(os.tmpdir(), `school-crm-v9-${process.pid}-${Date.now()}.json`)
process.env.SCHOOL_CRM_DB = tmp

const MCQ = {
  nature: 'mcq',
  mcq: {
    question: 'Did you give food to the day-care children?',
    options: [{ value: 'yes', label: 'Yes', accepts: true }, { value: 'no', label: 'No', accepts: true }],
    requiredAnswer: 'yes',
    requireMedia: true,
  },
  moduleLinked: null, custom: null, derivedFrom: null,
}

// three options, so it must NOT become the two-option yes/no widget
const CHOICE = {
  nature: 'mcq',
  mcq: {
    question: 'How was the delivery?',
    options: [
      { value: 'full', label: 'Everything arrived', accepts: true },
      { value: 'part', label: 'Part of it', accepts: true },
      { value: 'none', label: 'Nothing arrived', accepts: false },
    ],
    requiredAnswer: 'full',
    requireMedia: false,
  },
  moduleLinked: null, custom: null, derivedFrom: null,
}

const CUSTOM = {
  nature: 'custom',
  mcq: null, moduleLinked: null,
  custom: {
    statement: 'Room is stripped, aired and locked.',
    checklist: [
      { id: 'cots', text: 'Cots stripped', required: true },
      { id: 'windows', text: 'Windows opened', required: false },
    ],
    requireNote: true,
    noteLabel: 'Anything to flag?',
  },
  derivedFrom: null,
}

// the no-op condition every pre-nature task was mapped to by _tasksV5
const BARE = {
  nature: 'custom',
  mcq: null, moduleLinked: null,
  custom: { statement: 'Marked done by the assignee', checklist: [], requireNote: false, noteLabel: 'What did you do?' },
  derivedFrom: 'legacy_boolean',
}

const LINKED = {
  nature: 'module_linked',
  mcq: null, custom: null,
  moduleLinked: {
    moduleKey: 'attendance', signalKey: 'isMarked',
    paramBinding: { sectionId: { source: 'assignee.section' }, date: { source: 'instance.serviceDate' } },
    derivedMcq: { question: 'Attendance marked?', readOnly: true },
    autoSubmit: true,
  },
  derivedFrom: null,
}

const notifyParents = () => ({
  moduleKey: 'parents', actionKey: 'notify',
  paramBinding: { sectionId: { source: 'assignee.section' }, date: { source: 'instance.serviceDate' } },
  config: { message: '{child} was given lunch at day care on {date}.' },
  onFailure: 'warn',
  when: { answer: 'yes' },        // no questionId — this is the row that matters
})

const task = (id, condition, extra = {}) => ({
  id, title: id, status: 'active',
  recurrence: { freq: 'daily', startDate: '2026-08-01', byWeekday: [], interval: 1 },
  completionCondition: condition,
  onComplete: { actions: [] },
  lockOnComplete: [],
  createdByUserId: 'u-sudhir', createdAt: '2026-08-01T04:00:00.000Z',
  ...extra,
})

const ALL_STATUSES = ['assigned', 'in_progress', 'submitted', 'approved', 'overdue', 'deferred', 'cancelled', 'rejected']

const legacy = {
  _feesMoneyV2: true, _orgV1: true,
  _tasksV2: true, _tasksV3: true, _tasksV4: true, _tasksV5: true,
  _tasksV6: true, _tasksV7: true, _tasksV8: true,
  _counters: {},
  tasks: [
    task('task-mcq', MCQ, { onComplete: { actions: [notifyParents()] } }),
    task('task-choice', CHOICE),
    task('task-custom', CUSTOM),
    task('task-bare', BARE),
    task('task-linked', LINKED),
  ],
  taskInstances: [
    // one occurrence per status, all off the MCQ template, each with an answer
    ...ALL_STATUSES.map((status, i) => ({
      id: `ti-${status}`, taskId: 'task-mcq',
      serviceDate: `2026-08-${String(10 + i).padStart(2, '0')}`,
      occurrenceKey: `2026-08-${String(10 + i).padStart(2, '0')}`,
      status, assigneeUserId: 'u-gayatri', submissionRound: 1, attachmentIds: [],
      completionCondition: MCQ,
      onComplete: { actions: [notifyParents()] },
      completion: { answer: i % 2 ? 'no' : 'yes', checked: [], note: null, at: '2026-08-10T09:00:00.000Z', byUserId: 'u-gayatri' },
    })),
    {
      id: 'ti-custom', taskId: 'task-custom', serviceDate: '2026-08-20', occurrenceKey: '2026-08-20',
      status: 'approved', assigneeUserId: 'u-gayatri', submissionRound: 1, attachmentIds: [],
      completionCondition: CUSTOM,
      onComplete: { actions: [] },
      completion: { answer: null, checked: ['cots'], note: 'Blind is broken', at: '2026-08-20T09:00:00.000Z', byUserId: 'u-gayatri' },
    },
    {
      // nobody has touched it: `completion` is null and must stay null
      id: 'ti-untouched', taskId: 'task-custom', serviceDate: '2026-08-21', occurrenceKey: '2026-08-21',
      status: 'assigned', assigneeUserId: 'u-gayatri', submissionRound: 1, attachmentIds: [],
      completionCondition: CUSTOM, onComplete: { actions: [] }, completion: null,
    },
    {
      id: 'ti-linked', taskId: 'task-linked', serviceDate: '2026-08-22', occurrenceKey: '2026-08-22',
      status: 'assigned', assigneeUserId: 'u-anjali', submissionRound: 1, attachmentIds: [],
      completionCondition: LINKED, onComplete: { actions: [] }, completion: null,
    },
  ],
}

fs.writeFileSync(tmp, JSON.stringify(legacy, null, 2))

const { getDb, find } = await import('../db.js')
const { evaluateCondition, systemSpec, hasQuestions, conditionMode, answerValue, writtenNote, readCondition } = await import('../tasks/conditions.js')
const { actionApplies } = await import('../tasks/actions.js')

test('tasks V9: one mode and a list of questions, in place of three natures', async (t) => {
  t.after(() => { try { fs.unlinkSync(tmp) } catch { /* already gone */ } })
  const db = getDb()

  await t.test('an MCQ becomes one question, and two options make it a yes/no', () => {
    const c = find('tasks', 'task-mcq').completionCondition
    assert.equal(c.mode, 'answers')
    assert.equal(c.system, null)
    assert.deepEqual(c.questions.map((q) => [q.id, q.type, q.required]), [['answer', 'yes_no', true]])
    assert.equal(c.questions[0].prompt, 'Did you give food to the day-care children?')
    // requiredAnswer survives PER QUESTION: both answers accept here, so "the
    // accepting option" is ambiguous without it — and it is what the action's
    // `when` gate defaults to
    assert.equal(c.questions[0].requiredAnswer, 'yes')
    assert.deepEqual(c.questions[0].options.map((o) => o.value), ['yes', 'no'])
  })

  await t.test('three options is a choose_one, not a yes/no', () => {
    const c = find('tasks', 'task-choice').completionCondition
    assert.equal(c.questions[0].type, 'choose_one')
    assert.equal(c.questions[0].requiredAnswer, 'full')
  })

  await t.test('requireMedia moves to proof, and only for the task that asked', () => {
    assert.equal(find('tasks', 'task-mcq').completionCondition.proof.required, true)
    assert.equal(find('tasks', 'task-choice').completionCondition.proof.required, false)
  })

  await t.test('a custom condition becomes a checklist question plus a note question', () => {
    const c = find('tasks', 'task-custom').completionCondition
    assert.equal(c.mode, 'answers')
    assert.deepEqual(c.questions.map((q) => [q.id, q.type]), [['checklist', 'checklist'], ['note', 'text']])
    assert.deepEqual(c.questions[0].items.map((x) => [x.id, x.required]), [['cots', true], ['windows', false]])
    assert.equal(c.questions[1].prompt, 'Anything to flag?')
    // the statement has no home in the question list and must not be lost — it
    // is what the condition summary reads and what the day-end template's own
    // wording lives in
    assert.equal(c.statement, 'Room is stripped, aired and locked.')
  })

  await t.test('the no-op condition asks nothing at all, exactly as before', () => {
    const c = find('tasks', 'task-bare').completionCondition
    assert.equal(c.mode, 'answers')
    assert.deepEqual(c.questions, [])
    assert.equal(c.statement, 'Marked done by the assignee')
    assert.equal(c.derivedFrom, 'legacy_boolean', 'still identifiable as migrated, not authored')
    assert.equal(evaluateCondition({ completionCondition: c }, {}).satisfied, true)
  })

  await t.test('a module-linked task becomes mode system, with nothing to type', () => {
    const c = find('tasks', 'task-linked').completionCondition
    assert.equal(c.mode, 'system')
    assert.deepEqual(c.questions, [])
    assert.equal(c.system.moduleKey, 'attendance')
    assert.equal(c.system.signalKey, 'isMarked')
    assert.deepEqual(c.system.paramBinding.sectionId, { source: 'assignee.section' })
    assert.equal(c.system.derivedMcq.readOnly, true)
    // and the predicates every caller now uses agree
    const inst = find('taskInstances', 'ti-linked')
    assert.ok(systemSpec(inst))
    assert.equal(hasQuestions(inst), false)
    assert.equal(conditionMode(inst), 'system')
  })

  await t.test('EVERY status is migrated — a skipped one is a row nobody can submit', () => {
    for (const status of ALL_STATUSES) {
      const inst = find('taskInstances', `ti-${status}`)
      assert.equal(inst.status, status, 'history is untouched')
      assert.equal(inst.completionCondition.mode, 'answers', status)
      assert.equal(inst.completionCondition.questions.length, 1, status)
      assert.equal(inst.completion.answers.answer, inst.id === 'ti-assigned' ? 'yes' : inst.completion.answers.answer)
      assert.ok(['yes', 'no'].includes(inst.completion.answers.answer), status)
    }
  })

  await t.test('answers move to being keyed by question id, and nothing else moves', () => {
    const inst = find('taskInstances', 'ti-custom')
    assert.deepEqual(inst.completion.answers, { checklist: ['cots'], note: 'Blind is broken' })
    assert.equal(inst.completion.at, '2026-08-20T09:00:00.000Z')
    assert.equal(inst.completion.byUserId, 'u-gayatri')
    // read back by id, never by field name
    assert.deepEqual(answerValue(inst, 'checklist'), ['cots'])
    assert.equal(writtenNote(inst), 'Blind is broken')
  })

  await t.test('an occurrence nobody has touched keeps a null completion', () => {
    assert.equal(find('taskInstances', 'ti-untouched').completion, null)
  })

  await t.test('THE ACTION GATE: `when` gains the question it belongs to', () => {
    // Matching on the answer alone stops matching once answers are keyed by id,
    // and this is the gate that stops parents being told "your child was fed"
    // after an explicit No.
    const hook = find('tasks', 'task-mcq').onComplete.actions[0]
    assert.deepEqual(hook.when, { questionId: 'answer', answer: 'yes' })

    const yes = find('taskInstances', 'ti-assigned')
    const no = find('taskInstances', 'ti-in_progress')
    assert.equal(yes.completion.answers.answer, 'yes')
    assert.equal(no.completion.answers.answer, 'no')
    assert.equal(actionApplies(yes, yes.onComplete.actions[0]), true)
    assert.equal(actionApplies(no, no.onComplete.actions[0]), false, 'an explicit No still does not tell the parents')
  })

  await t.test('THE SHARPEST HAZARD: the shim and the migration derive the same ids', () => {
    // readCondition() reads the OLD shape at request time; the migration WROTE
    // the new one. Slug the ids independently and a row one of them converted
    // disagrees with a row the other converted, orphaning a live
    // completion.answers key. This is the only cheap proof they agree.
    for (const [id, legacyShape] of [
      ['task-mcq', MCQ], ['task-choice', CHOICE], ['task-custom', CUSTOM],
      ['task-bare', BARE], ['task-linked', LINKED],
    ]) {
      const migrated = find('tasks', id).completionCondition
      const shimmed = readCondition(legacyShape)
      assert.equal(shimmed.mode, migrated.mode, id)
      assert.deepEqual(shimmed.questions.map((q) => q.id), migrated.questions.map((q) => q.id), id)
      assert.deepEqual(shimmed.questions.map((q) => q.type), migrated.questions.map((q) => q.type), id)
      assert.equal(shimmed.statement, migrated.statement, id)
      assert.equal(!!shimmed.system, !!migrated.system, id)
    }
  })

  await t.test('the mapper is idempotent — a partly migrated database converges', () => {
    // readCondition() hands a row that is already in the new shape straight
    // back, which is what makes re-running safe if a migration is interrupted
    for (const t2 of db.tasks) {
      const again = readCondition(t2.completionCondition)
      assert.deepEqual(again.questions, t2.completionCondition.questions, t2.id)
      assert.equal(again.mode, t2.completionCondition.mode, t2.id)
    }
  })

  await t.test('nothing outside completion was touched', () => {
    assert.equal(find('tasks', 'task-mcq').title, 'task-mcq')
    assert.equal(find('tasks', 'task-mcq').recurrence.freq, 'daily')
    assert.equal(db.taskInstances.length, ALL_STATUSES.length + 3)
  })
})
