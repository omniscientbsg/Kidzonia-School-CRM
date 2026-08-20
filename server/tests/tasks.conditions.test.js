import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday } from '../tasks/time.js'
import { normalizeTask } from '../tasks/model.js'
import { evaluateCondition, describeCondition, legacyCondition } from '../tasks/conditions.js'
import { catalogue, describeSignal } from '../capabilities/index.js'

const TZ = 'Asia/Kolkata'

test('task natures: mcq, custom and module_linked', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const anjali = await login('teacher@kidzonia.com')
  const today = localToday(TZ)

  // the demo seed marks today's registers, which would satisfy the
  // module-linked cases below before they are even exercised
  const { getDb } = await import('../db.js')
  getDb().attendanceRecords = getDb().attendanceRecords.filter((r) => !(r.sectionId === 'sec-jh-nursery-a' && r.date === today))

  const create = (body) => api('POST', '/api/tasks', { token: lakshmi, body: { target: { kind: 'position', positionIds: ['pos-anjali'] }, recurrence: { freq: 'none', startDate: today }, ...body } })
  const firstInstance = async (taskId) => (await api('GET', `/api/task-instances?taskId=${taskId}`, { token: lakshmi })).data[0]

  // ------------------------------------------------------------------ axes --
  await t.test('origin and nature are independent axes', async () => {
    // pure unit: a recurring task may carry any nature, and a one-off likewise
    const daily = normalizeTask({ title: 'x', target: { kind: 'position', positionIds: ['p'] }, recurrence: { freq: 'daily' }, completionCondition: { nature: 'mcq', mcq: { question: 'Done?', requiredAnswer: 'yes' } } })
    assert.equal(daily.task.origin, 'automated')
    assert.equal(daily.task.completionCondition.nature, 'mcq')

    const oneOff = normalizeTask({ title: 'x', target: { kind: 'position', positionIds: ['p'] }, recurrence: { freq: 'none' }, completionCondition: { nature: 'module_linked', moduleLinked: { moduleKey: 'attendance', signalKey: 'isMarked' } } })
    assert.equal(oneOff.task.origin, 'manual')
    assert.equal(oneOff.task.completionCondition.nature, 'module_linked')
    assert.deepEqual(oneOff.errors, [])

    // origin is derived from the recurrence, never from the nature
    assert.equal(normalizeTask({ title: 'x', target: { kind: 'position', positionIds: ['p'] }, recurrence: { freq: 'weekly', byWeekday: [1] } }).task.origin, 'automated')
  })

  // ------------------------------------------------------------------- mcq --
  await t.test('mcq: only an accepting answer completes the task', async () => {
    const created = await create({
      title: 'Fire drill',
      completionCondition: {
        nature: 'mcq',
        mcq: {
          question: 'Did you run the fire drill with your class?',
          options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
          requiredAnswer: 'yes',
        },
      },
    })
    assert.equal(created.status, 201)
    assert.match(created.data.conditionSummary, /answers “Yes”/)

    const inst = await firstInstance(created.data.id)
    assert.equal(inst.completionCondition.nature, 'mcq')
    assert.equal(inst.condition.satisfied, false)
    assert.equal(inst.condition.code, 'answer_required')

    // submitting with no answer is refused
    const bare = await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })
    assert.equal(bare.status, 422)
    assert.equal(bare.data.error, 'answer_required')

    // the wrong answer is refused, and says what would be accepted
    const said = await api('POST', `/api/task-instances/${inst.id}/answer`, { token: anjali, body: { answer: 'no' } })
    assert.equal(said.status, 200)
    assert.equal(said.data.completion.answer, 'no')
    const refused = await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })
    assert.equal(refused.status, 422)
    assert.equal(refused.data.error, 'answer_not_accepted')
    assert.match(refused.data.message, /needs “Yes”/)
    assert.match(refused.data.message, /ask your manager/i)      // never a dead end

    // an answer outside the option set is not storable
    await api('POST', `/api/task-instances/${inst.id}/answer`, { token: anjali, body: { answer: 'maybe' } })
    assert.equal((await api('GET', `/api/task-instances/${inst.id}`, { token: anjali })).data.completion.answer, 'maybe')
    assert.equal((await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })).data.error, 'invalid_answer')

    // and the accepting answer goes through
    await api('POST', `/api/task-instances/${inst.id}/answer`, { token: anjali, body: { answer: 'yes' } })
    const done = await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })
    assert.equal(done.status, 200)
    assert.equal(done.data.status, 'approved')
    assert.equal(done.data.completion.answer, 'yes')
  })

  await t.test('mcq: the answer and the submit can arrive together', async () => {
    const created = await create({
      title: 'Lights and fans off',
      completionCondition: { nature: 'mcq', mcq: { question: 'All off?', requiredAnswer: 'yes' } },
    })
    const inst = await firstInstance(created.data.id)
    const done = await api('POST', `/api/task-instances/${inst.id}/submit`, {
      token: anjali, body: { completion: { answer: 'yes' } },
    })
    assert.equal(done.status, 200)
    assert.equal(done.data.status, 'approved')
  })

  await t.test('mcq: requireMedia drives the existing proof rule, not a second one', async () => {
    const created = await create({
      title: 'Display board refreshed',
      completionCondition: { nature: 'mcq', mcq: { question: 'Refreshed?', requiredAnswer: 'yes', requireMedia: true } },
    })
    // it sets the SAME fields the rest of the engine enforces
    assert.equal(created.data.requiresMedia, true)
    assert.equal(created.data.minAttachments, 1)

    const inst = await firstInstance(created.data.id)
    const blocked = await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali, body: { completion: { answer: 'yes' } } })
    assert.equal(blocked.status, 422)
    assert.equal(blocked.data.error, 'proof_required')
  })

  await t.test('mcq: an unknown requiredAnswer is rejected at creation', async () => {
    const bad = await create({
      title: 'Bad options',
      completionCondition: {
        nature: 'mcq',
        mcq: { question: 'Well?', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], requiredAnswer: 'zzz' },
      },
    })
    assert.equal(bad.status, 422)
    assert.match(bad.data.message, /not one of the options/)
  })

  // ---------------------------------------------------------------- custom --
  await t.test('custom: the checklist and the note are both enforced', async () => {
    const created = await create({
      title: 'Close the nap room',
      completionCondition: {
        nature: 'custom',
        custom: {
          statement: 'Room is stripped, aired and locked.',
          checklist: [
            { text: 'Cots stripped', required: true },
            { text: 'Windows opened for 20 minutes', required: true },
            { text: 'Spare linen restocked', required: false },
          ],
          requireNote: true,
          noteLabel: 'Anything to flag?',
        },
      },
    })
    assert.equal(created.status, 201)
    const cond = created.data.completionCondition.custom
    assert.deepEqual(cond.checklist.map((c) => c.id), ['cots-stripped', 'windows-opened-for-20-minutes', 'spare-linen-restocked'])

    const inst = await firstInstance(created.data.id)
    const nothing = await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })
    assert.equal(nothing.data.error, 'checklist_incomplete')
    assert.match(nothing.data.message, /Cots stripped, Windows opened/)

    // the optional item is genuinely optional; the note is not
    await api('POST', `/api/task-instances/${inst.id}/answer`, {
      token: anjali, body: { checked: ['cots-stripped', 'windows-opened-for-20-minutes'] },
    })
    const noNote = await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })
    assert.equal(noNote.data.error, 'note_required')
    assert.equal(noNote.data.message, 'Anything to flag?')

    const done = await api('POST', `/api/task-instances/${inst.id}/submit`, {
      token: anjali,
      body: { completion: { checked: ['cots-stripped', 'windows-opened-for-20-minutes'], note: 'Blind in the corner is broken' } },
    })
    assert.equal(done.status, 200)
    assert.equal(done.data.status, 'approved')
    assert.equal(done.data.completion.note, 'Blind in the corner is broken')
  })

  await t.test('custom: ticks the condition never asked for are dropped, not stored', async () => {
    const created = await create({
      title: 'Petty cash count',
      completionCondition: { nature: 'custom', custom: { statement: 'Counted and signed', checklist: [{ text: 'Counted', required: true }] } },
    })
    const inst = await firstInstance(created.data.id)
    const saved = await api('POST', `/api/task-instances/${inst.id}/answer`, {
      token: anjali, body: { checked: ['counted', 'invented-item'], note: 'ignored' },
    })
    assert.deepEqual(saved.data.completion.checked, ['counted'])
  })

  await t.test('custom with no clauses behaves exactly as the old model did', async () => {
    const created = await create({ title: 'Drop the register at the office' })
    // no condition sent at all -> the legacy no-op condition
    assert.equal(created.data.completionCondition.nature, 'custom')
    assert.equal(created.data.completionCondition.derivedFrom, 'default')
    const inst = await firstInstance(created.data.id)
    assert.equal(inst.condition.satisfied, true)
    const done = await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })
    assert.equal(done.status, 200)
    assert.equal(done.data.status, 'approved')
  })

  // --------------------------------------------------------- module linked --
  await t.test('module_linked binds, previews, and refuses a hand-typed answer', async () => {
    const created = await create({
      title: 'Mark class attendance',
      completionCondition: {
        nature: 'module_linked',
        moduleLinked: {
          moduleKey: 'attendance',
          signalKey: 'isMarked',
          paramBinding: { sectionId: { source: 'assignee.section' }, date: { source: 'instance.serviceDate' } },
          derivedMcq: { question: 'Attendance marked?' },
        },
      },
    })
    assert.equal(created.status, 201)
    assert.equal(
      created.data.conditionSummary,
      'Completes when attendance is marked for the assignee’s class on the task’s date',
    )
    // the derived answer is read-only by construction, not by configuration
    assert.equal(created.data.completionCondition.moduleLinked.derivedMcq.readOnly, true)

    const inst = await firstInstance(created.data.id)
    assert.equal(inst.can.answer, false, 'a derived answer is never typed by the assignee')
    assert.equal(inst.condition.satisfied, false)
    assert.equal(inst.condition.verifiable, true, 'attendance is a real signal now')

    // typing an answer by hand is refused
    const byHand = await api('POST', `/api/task-instances/${inst.id}/answer`, { token: anjali, body: { answer: 'yes' } })
    assert.equal(byHand.status, 422)
    assert.equal(byHand.data.error, 'derived_answer')

    const submitted = await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })
    assert.equal(submitted.status, 422)
    assert.equal(submitted.data.error, 'module_not_done')
  })

  await t.test('a binding to a signal that does not exist is refused', async () => {
    const bad = await create({
      title: 'Nonsense',
      completionCondition: { nature: 'module_linked', moduleLinked: { moduleKey: 'attendance', signalKey: 'isPurple' } },
    })
    assert.equal(bad.status, 422)
    assert.match(bad.data.message, /no such signal/)

    const strayParam = await create({
      title: 'Stray param',
      completionCondition: {
        nature: 'module_linked',
        moduleLinked: { moduleKey: 'attendance', signalKey: 'isMarked', paramBinding: { colour: { source: 'literal', value: 'red' } } },
      },
    })
    assert.equal(strayParam.status, 422)
    assert.match(strayParam.data.message, /not a parameter of that signal/)
  })

  await t.test('an action or lock no module has published cannot be selected', async () => {
    const bad = await create({
      title: 'Wishful thinking',
      completionCondition: { nature: 'custom', custom: { statement: 'x' } },
      onComplete: { actions: [{ moduleKey: 'daycare', actionKey: 'orderMorePuppies' }] },
    })
    assert.equal(bad.status, 422)
    assert.match(bad.data.message, /no such action/)
  })

  // ------------------------------------------------------------ registry ----
  await t.test('the capability registry drives the form, not a hardcoded list', async () => {
    const res = await api('GET', '/api/tasks/capabilities', { token: lakshmi })
    assert.equal(res.status, 200)
    const attendance = res.data.modules.find((m) => m.key === 'attendance')
    assert.ok(attendance, 'the stub module is published')
    const signal = attendance.signals.find((s) => s.key === 'isMarked')
    assert.equal(signal.implemented, true, 'attendance is a real, readable signal')
    assert.equal(signal.event, 'attendance.marked')
    assert.deepEqual(signal.params.map((p) => [p.name, p.bind]), [['sectionId', 'assignee.section'], ['date', 'instance.serviceDate']])
    // attendance publishes no action, and one lock — both read straight off the
    // descriptor, so the pickers follow whatever a module ships
    assert.deepEqual(attendance.actions, [])
    assert.deepEqual(attendance.guards.map((g) => [g.key, g.collection]), [['editRequiresApproval', 'attendanceRecords']])
    assert.ok(res.data.bindSources.some((b) => b.key === 'assignee.section'))

    const described = await api('POST', '/api/tasks/capabilities/describe', {
      token: lakshmi,
      body: { moduleKey: 'attendance', signalKey: 'isMarked', paramBinding: { sectionId: { source: 'literal', value: 'Jr KG A' } } },
    })
    assert.equal(described.data.sentence, 'Completes when attendance is marked for “Jr KG A” on the task’s date')
  })

  // ------------------------------------------------------------ snapshot ----
  await t.test('editing the template never rewrites a condition already in flight', async () => {
    const created = await create({
      title: 'Weekly stock check',
      recurrence: { freq: 'daily', startDate: today },
      completionCondition: { nature: 'mcq', mcq: { question: 'Stock counted?', requiredAnswer: 'yes' } },
    })
    const all = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: lakshmi })).data
    const todays = all.find((i) => i.serviceDate === today)
    const future = all.find((i) => i.serviceDate > today)

    // the assignee starts today's copy, so it is no longer untouched
    await api('POST', `/api/task-instances/${todays.id}/start`, { token: anjali })

    const edited = await api('PUT', `/api/tasks/${created.data.id}`, {
      token: lakshmi,
      body: { completionCondition: { nature: 'custom', custom: { statement: 'Counted and reconciled against the ledger' } } },
    })
    assert.equal(edited.status, 200)

    const after = (await api('GET', `/api/task-instances?taskId=${created.data.id}`, { token: lakshmi })).data
    assert.equal(after.find((i) => i.id === todays.id).completionCondition.nature, 'mcq', 'work in flight keeps the rule it was assigned under')
    assert.equal(after.find((i) => i.id === future.id).completionCondition.nature, 'custom', 'untouched future occurrences follow the template')
  })

  await t.test('sending work back clears the answer — a new round needs a fresh one', async () => {
    const created = await create({
      title: 'Parent callback log',
      requiresApproval: true,
      completionCondition: { nature: 'mcq', mcq: { question: 'All parents called?', requiredAnswer: 'yes' } },
    })
    const inst = await firstInstance(created.data.id)
    await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali, body: { completion: { answer: 'yes' } } })
    await api('POST', `/api/task-instances/${inst.id}/reject`, { token: lakshmi, body: { comment: 'Two are still pending' } })

    const back = (await api('GET', `/api/task-instances/${inst.id}`, { token: anjali })).data
    assert.equal(back.status, 'in_progress')
    assert.equal(back.completion, null, 'the previous answer does not carry into the new round')
    assert.equal(back.condition.satisfied, false)
    assert.equal((await api('POST', `/api/task-instances/${inst.id}/submit`, { token: anjali })).data.error, 'answer_required')
  })
})

// ---------------------------------------------------------------------------
test('condition evaluation and legacy mapping (unit)', async () => {
  const mcq = {
    nature: 'mcq',
    mcq: { question: 'Done?', options: [{ value: 'yes', label: 'Yes', accepts: true }, { value: 'na', label: 'Not applicable', accepts: true }, { value: 'no', label: 'No', accepts: false }], requiredAnswer: 'yes' },
  }
  // more than one option may complete a task — "Yes" or "Not applicable"
  assert.equal(evaluateCondition({ completionCondition: mcq }, { answer: 'na' }).satisfied, true)
  assert.equal(evaluateCondition({ completionCondition: mcq }, { answer: 'no' }).satisfied, false)
  assert.match(describeCondition(mcq), /“Yes” or “Not applicable”/)

  // a legacy task maps to a custom condition that reads truthfully and does not
  // change what submit requires
  const legacy = legacyCondition({ requiresMedia: true, minAttachments: 2, mediaTypes: ['photo'], requiresApproval: true })
  assert.equal(legacy.nature, 'custom')
  assert.equal(legacy.derivedFrom, 'legacy_boolean')
  assert.match(legacy.custom.statement, /2 photo files attached/)
  assert.match(legacy.custom.statement, /signed off by the approver/)
  assert.equal(evaluateCondition({ completionCondition: legacy }, {}).satisfied, true, 'the old model added no extra step')

  // the registry describes a binding without any task existing
  assert.equal(
    describeSignal('attendance', 'isMarked', {}),
    'attendance is marked for the assignee’s class on the task’s date',
  )
  assert.equal(catalogue().modules.length >= 1, true)
})
