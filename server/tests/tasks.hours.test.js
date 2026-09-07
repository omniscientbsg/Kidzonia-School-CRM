// "End of the day" means the end of THAT PERSON's working day.
//
// The invariant every one of these guards: localDate(tz, dueAt) === serviceDate.
// The logout gate, the day-end roll-up and the end-of-day nudge all read it, so
// a shift end must never push a deadline into a different local day. That is why
// a day with no shift falls back to the end of the calendar day rather than
// rolling forward to the next working morning.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday, localDate, addDays, weekdayOf } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'
const EOD = '18:29:59.999Z'          // 23:59:59.999 Asia/Kolkata

// Set a working pattern the way a school would, straight on the position.
async function setPattern(positionId, { workWeek = null, hours = null } = {}) {
  const { getDb } = await import('../db.js')
  const pos = getDb().orgPositions.find((p) => p.id === positionId)
  pos.workWeek = workWeek
  pos.hours = hours
}
async function setNodeHours(nodeId, hours) {
  const { getDb } = await import('../db.js')
  const node = getDb().orgNodes.find((n) => n.id === nodeId)
  node.settings = { ...(node.settings || {}), hours }
}
const everyDay = (from, to) =>
  Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), { from, to }]))

test('a deadline lands at the end of the assignee’s working day', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')
  const today = localToday(TZ)

  const assign = (body) => api('POST', '/api/tasks', {
    token: lakshmi,
    body: { target: { kind: 'position', positionIds: ['pos-anjali'] }, recurrence: { freq: 'none', startDate: today }, ...body },
  })
  const firstOf = async (taskId) =>
    (await api('GET', `/api/task-instances?taskId=${taskId}`, { token: lakshmi })).data[0]

  await t.test('with no hours configured it is the end of the local day, exactly as before', async () => {
    await setPattern('pos-anjali', {})
    const res = await assign({ title: 'No hours anywhere' })
    const inst = await firstOf(res.data.id)
    assert.equal(inst.dueAt, `${today}T${EOD}`)
  })

  await t.test('the position’s own hours win', async () => {
    await setPattern('pos-anjali', { hours: everyDay('08:00', '16:00') })
    const res = await assign({ title: 'Her day ends at four' })
    const inst = await firstOf(res.data.id)
    // 16:00:59.999 IST — inclusive of the closing minute, so submitting at
    // exactly 16:00:00 is not late
    assert.equal(inst.dueAt, `${today}T10:30:59.999Z`)
    assert.equal(localDate(TZ, inst.dueAt), inst.serviceDate, 'THE invariant: still the same local day')
  })

  await t.test('the node’s hours are the fallback when the position sets none', async () => {
    await setPattern('pos-anjali', {})
    await setNodeHours('node-sch-jh', everyDay('08:00', '15:00'))
    const res = await assign({ title: 'School closes at three' })
    const inst = await firstOf(res.data.id)
    assert.equal(inst.dueAt, `${today}T09:30:59.999Z`)
  })

  await t.test('and the position beats the node when both are set', async () => {
    await setPattern('pos-anjali', { hours: everyDay('08:00', '17:00') })
    // node still says 15:00 from the previous case
    const res = await assign({ title: 'Hers, not the school’s' })
    const inst = await firstOf(res.data.id)
    assert.equal(inst.dueAt, `${today}T11:30:59.999Z`)
    await setNodeHours('node-sch-jh', null)
  })

  await t.test('a day with no shift falls back to the calendar day, not the next morning', async () => {
    // only Monday has a shift; the task is due today whatever day today is
    await setPattern('pos-anjali', { hours: { 1: { from: '08:00', to: '16:00' } } })
    const res = await assign({ title: 'Owed regardless' })
    const inst = await firstOf(res.data.id)
    const expected = weekdayOf(today) === 1 ? `${today}T10:30:59.999Z` : `${today}T${EOD}`
    assert.equal(inst.dueAt, expected)
    // this is the assertion that catches a future "roll to the next working day"
    assert.equal(localDate(TZ, inst.dueAt), inst.serviceDate)
  })

  await t.test('an explicit time is an explicit instruction and is NOT moved by a shift', async () => {
    await setPattern('pos-anjali', { hours: everyDay('08:00', '16:00') })
    const res = await assign({ title: 'By three, whatever time you leave', dueType: 'at_time', dueConfig: { time: '15:00' } })
    const inst = await firstOf(res.data.id)
    assert.equal(inst.dueAt, `${today}T09:30:00.000Z`, '15:00 IST — the shift end does not override it')
  })

  await t.test('an n-days window ends at the shift end of its LAST day', async () => {
    await setPattern('pos-anjali', { hours: everyDay('08:00', '16:00') })
    const res = await assign({ title: 'Three days', dueType: 'n_days', dueConfig: { days: 3 } })
    const inst = await firstOf(res.data.id)
    assert.equal(inst.dueAt, `${addDays(today, 3)}T10:30:59.999Z`)
  })

  await t.test('THE GATE IS UNCHANGED: late at 16:01, but not held at the door until the day is over', async () => {
    await setPattern('pos-anjali', { hours: everyDay('08:00', '16:00') })
    const res = await assign({ title: 'Mandatory, ends at four', isBlocking: true })
    const inst = await firstOf(res.data.id)
    const anjali = await login('teacher@kidzonia.com')

    // the deadline moved to 16:00 — that is the feature
    assert.equal(inst.dueAt, `${today}T10:30:59.999Z`)
    // …but blocking is a DAY comparison, so it does not fire mid-afternoon
    const gate = (await api('GET', '/api/tasks/logout-check', { token: anjali })).data
    assert.equal(gate.armed, false, 'nothing from an earlier day')
    // and a write elsewhere in the API is not refused
    const write = await api('POST', '/api/task-categories', { token: anjali, body: { name: 'x' } })
    assert.notEqual(write.status, 403)
  })

  await t.test('deferring lands on the new date’s shift end, not 23:59', async () => {
    await setPattern('pos-anjali', { hours: everyDay('08:00', '16:00') })
    const res = await assign({ title: 'Movable', dueType: 'n_days', dueConfig: { days: 5 } })
    const inst = await firstOf(res.data.id)
    const moved = await api('POST', `/api/task-instances/${inst.id}/defer`, {
      token: lakshmi,
      body: { to: addDays(today, 2), reason: 'Trip day' },
    })
    assert.equal(moved.status, 200)
    assert.equal(moved.data.dueAt, `${addDays(today, 2)}T10:30:59.999Z`)
  })

  await t.test('editing the template recomputes future occurrences at the shift end', async () => {
    await setPattern('pos-anjali', { hours: everyDay('08:00', '16:00') })
    const res = await assign({ title: 'Daily', recurrence: { freq: 'daily', startDate: today } })
    const tomorrow = addDays(today, 1)
    const before = (await api('GET', `/api/task-instances?taskId=${res.data.id}`, { token: lakshmi })).data
      .find((i) => i.serviceDate === tomorrow)
    assert.ok(before, 'tomorrow was generated')

    await setPattern('pos-anjali', { hours: everyDay('08:00', '14:00') })
    const edited = await api('PUT', `/api/tasks/${res.data.id}`, { token: lakshmi, body: { ...res.data, title: 'Daily, renamed' } })
    assert.equal(edited.status, 200)

    const after = (await api('GET', `/api/task-instances?taskId=${res.data.id}`, { token: lakshmi })).data
      .find((i) => i.serviceDate === tomorrow)
    assert.equal(after.dueAt, `${tomorrow}T08:30:59.999Z`, 'future work follows the new shift')
  })
})

// ---------------------------------------------------------------------------
test('the working pattern lives on the position, and the API can set it', async (t) => {
  await startServer()
  t.after(stopServer)
  const meera = await login('superadmin@kidzonia.com')

  await t.test('_orgV2 backfills to null, meaning inherit', async () => {
    const { getDb } = await import('../db.js')
    assert.equal(getDb()._orgV2, true)
    for (const p of getDb().orgPositions) {
      assert.ok('workWeek' in p && 'hours' in p && 'status' in p, `${p.id} is missing the working pattern`)
      assert.ok(['active', 'on_leave', 'left'].includes(p.status))
    }
  })

  await t.test('the list returns the pattern RESOLVED through the node fallback', async () => {
    const rows = (await api('GET', '/api/org/positions', { token: meera })).data
    const anjali = rows.find((p) => p.id === 'pos-anjali')
    // she sets none of her own, so she shows the school's Mon-Sat
    assert.equal(anjali.workWeekOwn, null)
    assert.deepEqual(anjali.workWeek, [1, 2, 3, 4, 5, 6], 'resolved, so no client reimplements the fallback')

    const gayatri = rows.find((p) => p.id === 'pos-gayatri')
    assert.ok(gayatri.hoursOwn, 'day care has its own hours in the seed')
    assert.equal(gayatri.hours['1'].to, '18:30')
  })

  await t.test('a working pattern can be set on an existing person', async () => {
    const res = await api('PUT', '/api/org/positions/pos-anjali', {
      token: meera,
      body: { workWeek: [1, 2, 3, 4, 5], hours: { 1: { from: '09:00', to: '15:30' } }, status: 'on_leave' },
    })
    assert.equal(res.status, 200)
    assert.deepEqual(res.data.workWeekOwn, [1, 2, 3, 4, 5])
    assert.equal(res.data.hoursOwn['1'].to, '15:30')
    assert.equal(res.data.status, 'on_leave')
  })

  await t.test('a shift that crosses midnight is refused rather than silently stored', async () => {
    // it cannot be represented without breaking localDate(tz, dueAt) === serviceDate
    const res = await api('PUT', '/api/org/positions/pos-anjali', {
      token: meera,
      body: { hours: { 1: { from: '22:00', to: '06:00' } } },
    })
    assert.equal(res.status, 422)
    assert.match(res.data.message, /crossing midnight|end after they start/)
  })

  await t.test('on_leave stays IN the org index — vanishing silently is worse', async () => {
    // filtering them out would remove the person from every downline, roll-up
    // and approval chain with no warning
    const rows = (await api('GET', '/api/org/positions', { token: meera })).data
    assert.ok(rows.some((p) => p.id === 'pos-anjali'), 'still listed')
    const preview = await api('POST', '/api/tasks/preview-targets', {
      token: await login('principal@kidzonia.com'),
      body: { target: { kind: 'node_level', nodeIds: ['node-sch-jh'], levelIds: ['lvl-teacher'] } },
    })
    assert.ok(preview.data.people.some((p) => p.id === 'pos-anjali'), 'still assignable while on leave')
  })

  await t.test('but someone who has LEFT stops matching every target shape', async () => {
    const lakshmi = await login('principal@kidzonia.com')
    const before = await api('POST', '/api/tasks/preview-targets', {
      token: lakshmi, body: { target: { kind: 'node_level', nodeIds: ['node-sch-jh'], levelIds: ['lvl-teacher'] } },
    })
    assert.ok(before.data.people.some((p) => p.id === 'pos-renu'))

    const ended = await api('POST', '/api/org/positions/pos-renu/end', { token: meera, body: { reason: 'Moved on' } })
    assert.equal(ended.status, 200)

    const after = await api('POST', '/api/tasks/preview-targets', {
      token: lakshmi, body: { target: { kind: 'node_level', nodeIds: ['node-sch-jh'], levelIds: ['lvl-teacher'] } },
    })
    assert.equal(after.data.people.some((p) => p.id === 'pos-renu'), false)
  })
})
