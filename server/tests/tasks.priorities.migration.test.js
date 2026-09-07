// Migration of an EXISTING database onto priorities-as-master-data.
//
// Like the other migration tests this writes a db.json by hand and boots the
// store against it, because the whole point is what happens to rows written
// before the change. The row that matters most is the OCCURRENCE: priority is
// snapshotted onto every one of them and the Today view sorts on it, so
// converting only the templates would leave every list sorting hundreds of
// occurrences as "unknown".
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const tmp = path.join(os.tmpdir(), `school-crm-prio-${process.pid}-${Date.now()}.json`)
process.env.SCHOOL_CRM_DB = tmp

const legacy = {
  _feesMoneyV2: true, _orgV1: true,
  _tasksV2: true, _tasksV3: true, _tasksV4: true, _tasksV5: true,
  _tasksV6: true, _tasksV7: true, _tasksV8: true,
  _counters: {},
  tasks: [
    { id: 'task-a', title: 'Urgent thing', priority: 'urgent', status: 'active',
      recurrence: { freq: 'daily', startDate: '2026-08-01', byWeekday: [], interval: 1 },
      createdByUserId: 'u-principal', createdAt: '2026-08-01T04:00:00.000Z' },
    { id: 'task-b', title: 'Ordinary thing', priority: 'normal', status: 'active',
      recurrence: { freq: 'none', startDate: '2026-08-02' },
      createdByUserId: 'u-principal', createdAt: '2026-08-02T04:00:00.000Z' },
    // written before `priority` existed at all
    { id: 'task-c', title: 'No priority at all', status: 'active',
      recurrence: { freq: 'none', startDate: '2026-08-03' },
      createdByUserId: 'u-principal', createdAt: '2026-08-03T04:00:00.000Z' },
  ],
  taskInstances: [
    { id: 'ti-a1', taskId: 'task-a', serviceDate: '2026-08-18', occurrenceKey: '2026-08-18',
      status: 'approved', assigneeUserId: 'u-teacher', priority: 'urgent', submissionRound: 1, attachmentIds: [] },
    { id: 'ti-b1', taskId: 'task-b', serviceDate: '2026-08-19', occurrenceKey: '2026-08-19',
      status: 'assigned', assigneeUserId: 'u-teacher', priority: 'low', submissionRound: 1, attachmentIds: [] },
    { id: 'ti-c1', taskId: 'task-c', serviceDate: '2026-08-20', occurrenceKey: '2026-08-20',
      status: 'assigned', assigneeUserId: 'u-teacher', submissionRound: 1, attachmentIds: [] },
  ],
}

fs.writeFileSync(tmp, JSON.stringify(legacy, null, 2))

const { getDb, find } = await import('../db.js')
const { priorityList, priorityIdOf, describePriority, resolvePriority } = await import('../tasks/priorities.js')

test('tasks V11: priorities become master data without reordering anything', async (t) => {
  t.after(() => { try { fs.unlinkSync(tmp) } catch { /* already gone */ } })

  await t.test('the four we always had are seeded, ranked, with one default', () => {
    const rows = priorityList()
    assert.deepEqual(rows.map((p) => p.id), ['prio-urgent', 'prio-high', 'prio-normal', 'prio-low'])
    assert.deepEqual(rows.map((p) => p.rank), [10, 20, 30, 40], 'gaps of 10 so a rung can be inserted between')
    assert.equal(rows.filter((p) => p.isDefault).length, 1)
    assert.equal(rows.find((p) => p.isDefault).id, 'prio-normal')
  })

  await t.test('templates are converted, and a task with no priority gets the default', () => {
    assert.equal(find('tasks', 'task-a').priority, 'prio-urgent')
    assert.equal(find('tasks', 'task-b').priority, 'prio-normal')
    assert.equal(find('tasks', 'task-c').priority, 'prio-normal')
  })

  await t.test('OCCURRENCES are converted too — the Today view sorts on the snapshot', () => {
    assert.equal(find('taskInstances', 'ti-a1').priority, 'prio-urgent')
    assert.equal(find('taskInstances', 'ti-b1').priority, 'prio-low')
    assert.equal(find('taskInstances', 'ti-c1').priority, 'prio-normal')
  })

  await t.test('the id keeps the old word, so an audit row stays legible', () => {
    // prio-urgent, not a uuid. Anyone reading a stored task or an audit entry
    // written either side of the migration sees the same word.
    for (const p of priorityList()) assert.match(p.id, /^prio-(urgent|high|normal|low)$/)
  })

  await t.test('order is by rank, never by name — a rename must not reorder', () => {
    const before = priorityList().map((p) => p.id)
    const urgent = find('taskPriorities', 'prio-urgent')
    urgent.name = 'Zzz drop everything'
    assert.deepEqual(priorityList().map((p) => p.id), before, 'renaming to sort last alphabetically changes nothing')
    urgent.name = 'Urgent'
  })

  await t.test('the legacy strings are still accepted on the way in', () => {
    // an un-updated client, the seed, and the migration itself all send them
    assert.equal(priorityIdOf('urgent'), 'prio-urgent')
    assert.equal(priorityIdOf('prio-high'), 'prio-high')
    assert.equal(priorityIdOf(undefined), 'prio-normal')
    assert.equal(priorityIdOf('nonsense'), 'prio-normal', 'falls back to the default rather than storing junk')
    assert.equal(resolvePriority('low').name, 'Low')
  })

  await t.test('a row renders without fetching the master', () => {
    assert.deepEqual(describePriority('prio-urgent'), {
      priorityId: 'prio-urgent', priorityName: 'Urgent', priorityColor: '#e5484d', priorityRank: 10,
    })
  })

  await t.test('the migration is flagged and converges if run again', () => {
    assert.equal(getDb()._tasksV11, true)
    // the second pass sees ids, which are not in the legacy map, and leaves them
    assert.equal(priorityIdOf(find('tasks', 'task-a').priority), 'prio-urgent')
  })
})
