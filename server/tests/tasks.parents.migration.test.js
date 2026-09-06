// Migration of an EXISTING database off the day-care-specific parent action.
//
// Like tasks.migration.test.js this writes a db.json by hand and boots the
// store against it, because the whole point is what happens to rows that were
// written before the change. The interesting row is the RUN log: it is what
// stops an action firing twice, and it is keyed by module.action — leave those
// keys behind and every lunch already sent becomes eligible to send again.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const tmp = path.join(os.tmpdir(), `school-crm-parents-${process.pid}-${Date.now()}.json`)
process.env.SCHOOL_CRM_DB = tmp

const oldAction = (extra = {}) => ({
  moduleKey: 'daycare', actionKey: 'notifyParents',
  paramBinding: { sectionId: { source: 'assignee.section' }, date: { source: 'instance.serviceDate' } },
  onFailure: 'warn', when: { answer: 'yes' },
  ...extra,
})

const legacy = {
  _feesMoneyV2: true, _orgV1: true,
  _tasksV2: true, _tasksV3: true, _tasksV4: true, _tasksV5: true, _tasksV6: true, _tasksV7: true,
  _counters: {},
  tasks: [
    {
      id: 'task-lunch', title: 'Day-care lunch served', status: 'active',
      recurrence: { freq: 'daily', startDate: '2026-08-01', byWeekday: [], interval: 1 },
      onComplete: { actions: [oldAction()] },
      createdByUserId: 'u-sudhir', createdAt: '2026-08-01T04:00:00.000Z',
    },
    {
      // an author who had already overridden the wording keeps it
      id: 'task-lunch-custom', title: 'Snack served', status: 'active',
      recurrence: { freq: 'none', startDate: '2026-08-02' },
      onComplete: { actions: [oldAction({ config: { message: 'Own words about {child}.' } })] },
      createdByUserId: 'u-sudhir', createdAt: '2026-08-02T04:00:00.000Z',
    },
    {
      id: 'task-untouched', title: 'No hooks at all', status: 'active',
      recurrence: { freq: 'none', startDate: '2026-08-03' },
      onComplete: { actions: [] },
      createdByUserId: 'u-sudhir', createdAt: '2026-08-03T04:00:00.000Z',
    },
  ],
  taskInstances: [
    {
      id: 'ti-lunch-yesterday', taskId: 'task-lunch', serviceDate: '2026-08-18', occurrenceKey: '2026-08-18',
      status: 'approved', assigneeUserId: 'u-gayatri', submissionRound: 1, attachmentIds: [],
      onComplete: { actions: [oldAction()] },
    },
  ],
  taskActionRuns: [
    {
      id: 'tar-1', instanceId: 'ti-lunch-yesterday', key: 'daycare.notifyParents',
      moduleKey: 'daycare', actionKey: 'notifyParents', status: 'sent',
      recipients: ['u-parent-1'], at: '2026-08-18T08:00:00.000Z',
    },
  ],
}

fs.writeFileSync(tmp, JSON.stringify(legacy, null, 2))

const { getDb, find } = await import('../db.js')
const { loadCapabilities, getAction } = await import('../capabilities/index.js')
const { previousRun } = await import('../tasks/actions.js')

test('tasks V8: one way to tell parents, and nothing sends twice because of it', async (t) => {
  t.after(() => { try { fs.unlinkSync(tmp) } catch { /* already gone */ } })
  loadCapabilities()

  await t.test('the day-care action no longer exists anywhere in the registry', () => {
    assert.equal(getAction('daycare', 'notifyParents'), null)
    assert.ok(getAction('parents', 'notify'), 'the generic one is the only one left')
  })

  await t.test('templates are re-pointed and given the sentence they used to imply', () => {
    const a = find('tasks', 'task-lunch').onComplete.actions[0]
    assert.equal(a.moduleKey, 'parents')
    assert.equal(a.actionKey, 'notify')
    assert.match(a.config.message, /lunch at day care/)
    // everything else about the hook survives
    assert.deepEqual(a.when, { answer: 'yes' })
    assert.equal(a.onFailure, 'warn')
    assert.deepEqual(a.paramBinding.sectionId, { source: 'assignee.section' })
  })

  await t.test('a message somebody had already written is not overwritten', () => {
    const a = find('tasks', 'task-lunch-custom').onComplete.actions[0]
    assert.equal(a.config.message, 'Own words about {child}.')
  })

  await t.test('occurrences already generated carry the new hook too', () => {
    // onComplete is snapshotted onto every occurrence, so a template-only
    // rewrite would leave today's work still pointing at a deleted action
    const inst = find('taskInstances', 'ti-lunch-yesterday')
    assert.equal(inst.onComplete.actions[0].moduleKey, 'parents')
    assert.equal(inst.onComplete.actions[0].actionKey, 'notify')
  })

  await t.test('the run log moves with it, so yesterday’s lunch cannot be sent again', () => {
    const run = getDb().taskActionRuns[0]
    assert.equal(run.key, 'parents.notify')
    assert.equal(run.status, 'sent')
    assert.deepEqual(run.recipients, ['u-parent-1'], 'who was told is not lost')

    // the real check: the idempotency lookup finds it under the NEW key
    const inst = find('taskInstances', 'ti-lunch-yesterday')
    assert.ok(previousRun(inst.id, inst.onComplete.actions[0]), 'already run — skip')
  })

  await t.test('tasks with no parent hook are left exactly as they were', () => {
    assert.deepEqual(find('tasks', 'task-untouched').onComplete.actions, [])
  })
})
