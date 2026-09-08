// Migration of an EXISTING database to the type × nature schema.
//
// This file deliberately does not use helpers.js: it writes a pre-V5 db.json by
// hand and then boots the store against it, which is the only way to prove the
// forward mapping on rows that were written before the new fields existed.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const tmp = path.join(os.tmpdir(), `school-crm-migrate-${process.pid}-${Date.now()}.json`)
process.env.SCHOOL_CRM_DB = tmp

// A database as it stood before this slice: tasks with the two booleans and no
// nature, condition, origin or escalation field anywhere.
const legacy = {
  // every earlier migration already applied, so only V5 has anything to do
  _feesMoneyV2: true, _orgV1: true, _tasksV2: true, _tasksV3: true, _tasksV4: true,
  _counters: {},
  tasks: [
    {
      id: 'task-legacy-daily', title: 'Mark class attendance',
      recurrence: { freq: 'daily', startDate: '2026-08-01', byWeekday: [], interval: 1 },
      requiresMedia: false, requiresApproval: false, minAttachments: 0, mediaTypes: ['photo', 'document'],
      isBlocking: true, status: 'active', createdByUserId: 'u-principal', createdAt: '2026-08-01T04:00:00.000Z',
    },
    {
      id: 'task-legacy-oneoff', title: 'Photograph the new play area',
      recurrence: { freq: 'none', startDate: '2026-08-10' },
      requiresMedia: true, minAttachments: 3, mediaTypes: ['photo'], requiresApproval: true,
      isBlocking: false, status: 'active', createdByUserId: 'u-principal', createdAt: '2026-08-10T04:00:00.000Z',
    },
  ],
  taskInstances: [
    {
      id: 'ti-legacy-1', taskId: 'task-legacy-daily', serviceDate: '2026-08-18', occurrenceKey: '2026-08-18',
      status: 'approved', assigneeUserId: 'u-teacher', isBlocking: true, requiresMedia: false, requiresApproval: false,
      submissionRound: 1, attachmentIds: [],
    },
    {
      id: 'ti-legacy-2', taskId: 'task-legacy-oneoff', serviceDate: '2026-08-19', occurrenceKey: '2026-08-19',
      status: 'in_progress', assigneeUserId: 'u-teacher', isBlocking: false, requiresMedia: true, minAttachments: 3,
      mediaTypes: ['photo'], requiresApproval: true, submissionRound: 1, attachmentIds: [],
    },
    // an orphan whose template was hard-deleted long ago — it must still migrate
    { id: 'ti-orphan', taskId: 'task-gone', serviceDate: '2026-08-12', status: 'approved', assigneeUserId: 'u-teacher', requiresMedia: false, requiresApproval: false },
  ],
}

fs.writeFileSync(tmp, JSON.stringify(legacy, null, 2))

const { getDb, find } = await import('../db.js')
const { evaluateCondition } = await import('../tasks/conditions.js')

test('tasks V5 migration: old booleans map forward with no data loss', async (t) => {
  t.after(() => { try { fs.unlinkSync(tmp) } catch { /* already gone */ } })

  const db = getDb()

  await t.test('every task gains both axes', () => {
    const daily = find('tasks', 'task-legacy-daily')
    const oneOff = find('tasks', 'task-legacy-oneoff')
    // axis 1 — origin, read off the recurrence that was already there
    assert.equal(daily.origin, 'automated')
    assert.equal(oneOff.origin, 'manual')
    // axis 2 — how it completes. The old model asked nothing beyond the
    // assignee's word, so the faithful translation has no questions at all.
    assert.equal(daily.completionCondition.mode, 'answers')
    assert.deepEqual(daily.completionCondition.questions, [])
    assert.equal(daily.completionCondition.derivedFrom, 'legacy_boolean')
    assert.equal(oneOff.completionCondition.mode, 'answers')
  })

  await t.test('the old booleans are preserved, not consumed', () => {
    const oneOff = find('tasks', 'task-legacy-oneoff')
    assert.equal(oneOff.requiresMedia, true, 'still enforced where it always was')
    assert.equal(oneOff.minAttachments, 3)
    assert.deepEqual(oneOff.mediaTypes, ['photo'])
    assert.equal(oneOff.requiresApproval, true)
    // and they are mirrored into the condition so it reads truthfully alone
    assert.match(oneOff.completionCondition.statement, /3 photo files attached/)
    assert.match(oneOff.completionCondition.statement, /signed off by the approver/)

    const daily = find('tasks', 'task-legacy-daily')
    assert.equal(daily.requiresMedia, false)
    assert.equal(daily.isBlocking, true, 'the gate rule is untouched')
    assert.equal(daily.completionCondition.statement, 'Marked done by the assignee')
  })

  await t.test('the escalation field lands, empty and honest', () => {
    for (const t2 of db.tasks) {
      assert.equal(t2.escalationPolicyId, null)
      assert.deepEqual(t2.onComplete, { actions: [] })
      assert.deepEqual(t2.lockOnComplete, [])
      assert.equal(t2.systemKey, null)
    }
    // requiresApproval is what still triggers an approval; the ordered ancestor
    // stages arrive in the escalation slice and must not be faked here
    assert.equal(find('tasks', 'task-legacy-oneoff').requiresApproval, true)
  })

  await t.test('occurrences are migrated from their own template, not left to read it', () => {
    const one = find('taskInstances', 'ti-legacy-1')
    assert.equal(one.origin, 'automated')
    assert.equal(one.completionCondition.mode, 'answers')
    assert.equal(one.completion, null)
    // history is untouched
    assert.equal(one.status, 'approved')

    const two = find('taskInstances', 'ti-legacy-2')
    assert.match(two.completionCondition.statement, /3 photo files attached/)
    assert.equal(two.status, 'in_progress')
  })

  await t.test('an orphaned occurrence migrates from its own fields', () => {
    const orphan = find('taskInstances', 'ti-orphan')
    assert.equal(orphan.origin, 'manual')
    assert.equal(orphan.completionCondition.mode, 'answers')
  })

  await t.test('nothing migrated demands a step that did not exist before', () => {
    // the whole point: a migrated task must submit exactly as it did yesterday
    for (const inst of db.taskInstances) {
      assert.equal(evaluateCondition(inst).satisfied, true, `${inst.id} would have become unsubmittable`)
    }
  })

  await t.test('the migration is flagged and does not run twice', () => {
    assert.equal(db._tasksV5, true)
    const before = JSON.stringify(find('tasks', 'task-legacy-oneoff'))
    getDb()
    assert.equal(JSON.stringify(find('tasks', 'task-legacy-oneoff')), before)
  })
})
