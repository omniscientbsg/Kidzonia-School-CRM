// One target shape instead of five kinds.
//
// The old model picked ONE kind by precedence — named people beat roles beat
// nodes — so the assign form's three selects could never genuinely combine, and
// "every Teacher at Jubilee Hills plus Priya from HQ, except Renu" could not be
// expressed at all. These are the sentences that were previously impossible.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login, clearSeededTasks } from './helpers.js'
import { localToday } from '../tasks/time.js'

const TZ = 'Asia/Kolkata'

test('targeting: three lists that combine, minus the people you exclude', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()

  const lakshmi = await login('principal@kidzonia.com')   // Principal, Jubilee Hills
  const nandita = await login('nandita.rao@kidzonia.com') // HQ co-ordinator, sees both branches
  const today = localToday(TZ)

  const preview = (target, token = lakshmi) =>
    api('POST', '/api/tasks/preview-targets', { token, body: { target } })

  await t.test('a role at a place — the everyday case, unchanged', async () => {
    const res = await preview({ nodeIds: ['node-sch-jh'], levelIds: ['lvl-teacher'], followJoiners: true })
    assert.equal(res.data.count, 5)
    assert.ok(res.data.people.every((p) => p.tier === 'Teacher' || p.tier === 'Senior Teacher'))
  })

  await t.test('THE SENTENCE THAT WAS IMPOSSIBLE: a whole tier, except one person', async () => {
    const all = await preview({ nodeIds: ['node-sch-jh'], levelIds: ['lvl-teacher'], followJoiners: true })
    const renu = all.data.people.find((p) => p.userName === 'Renu Nair')
    assert.ok(renu, 'Renu is in the tier to begin with')

    const without = await preview({
      nodeIds: ['node-sch-jh'], levelIds: ['lvl-teacher'],
      excludePositionIds: [renu.id], followJoiners: true,
    })
    assert.equal(without.data.count, all.data.count - 1)
    assert.equal(without.data.people.some((p) => p.userName === 'Renu Nair'), false)
  })

  await t.test('several roles at once, which the old shape could only fake', async () => {
    const res = await preview({ nodeIds: ['node-sch-jh'], levelIds: ['lvl-teacher', 'lvl-daycare'], followJoiners: true })
    const tiers = [...new Set(res.data.people.map((p) => p.tier))].sort()
    assert.deepEqual(tiers, ['Day Care Staff', 'Senior Teacher', 'Teacher'])
  })

  await t.test('a place with no role named means everyone there', async () => {
    const res = await preview({ nodeIds: ['node-sch-jh'], levelIds: [], followJoiners: true })
    // used to be an error ("pick a tier"); an empty list is now "no filter"
    assert.ok(res.data.count >= 8)
    assert.equal(res.data.people.some((p) => p.userName === 'Lakshmi Devi'), false, 'never yourself')
  })

  await t.test('naming people wins over any filter — an instruction, not a filter', async () => {
    const anjali = (await preview({ nodeIds: ['node-sch-jh'], levelIds: ['lvl-teacher'], followJoiners: true }))
      .data.people.find((p) => p.userName === 'Anjali Rao')
    const res = await preview({
      // a tier AND one person: the person is what was meant
      nodeIds: ['node-sch-jh'], levelIds: ['lvl-teacher'],
      positionIds: [anjali.id], followJoiners: false,
    })
    assert.equal(res.data.count, 1)
    assert.equal(res.data.people[0].userName, 'Anjali Rao')
  })

  await t.test('nothing named at all is still "everyone below me"', async () => {
    const res = await preview({ nodeIds: [], levelIds: [], followJoiners: true }, nandita)
    // HQ co-ordinator reaches both branches, at every depth
    const nodes = [...new Set(res.data.people.map((p) => p.nodeName))]
    assert.ok(nodes.length >= 3, `expected both branches, got ${nodes.join(', ')}`)
  })

  await t.test('the rejection rule is unchanged: a named senior is an error, a broad match is not', async () => {
    // naming somebody out of reach must be shown to the assigner by name…
    const named = await preview({ positionIds: ['pos-nandita'], followJoiners: false })
    assert.equal(named.data.rejected.length, 1)
    assert.equal(named.data.rejected[0].reason, 'not_in_downline')

    // …but sweeping a whole place silently skips peers and seniors
    const broad = await preview({ nodeIds: ['node-hq'], levelIds: [], followJoiners: true })
    assert.deepEqual(broad.data.rejected, [])
  })

  await t.test('`kind` is derived from what was chosen, and is display-only now', async () => {
    const made = (target) => api('POST', '/api/tasks', {
      token: lakshmi,
      body: { title: 'x', target, recurrence: { freq: 'none', startDate: today } },
    })
    const a = await made({ nodeIds: ['node-sch-jh'], levelIds: ['lvl-teacher'], followJoiners: true })
    assert.equal(a.data.target.kind, 'node_level')
    const b = await made({ nodeIds: ['node-sch-jh'], levelIds: [], followJoiners: true })
    assert.equal(b.data.target.kind, 'node')
    const c = await made({ positionIds: ['pos-anjali'], followJoiners: false })
    assert.equal(c.data.target.kind, 'position')
    // and levelId is still written for anything reading the pre-multi-role field
    assert.equal(a.data.target.levelId, 'lvl-teacher')
  })

  await t.test('followJoiners defaults to today’s behaviour when nobody says', async () => {
    const made = (target) => api('POST', '/api/tasks', {
      token: lakshmi, body: { title: 'y', target, recurrence: { freq: 'none', startDate: today } },
    })
    // a role is live: whoever holds it next inherits the work
    const role = await made({ nodeIds: ['node-sch-jh'], levelIds: ['lvl-teacher'] })
    assert.equal(role.data.target.followJoiners, true)
    // named people are frozen: the list is the list
    const people = await made({ positionIds: ['pos-anjali'] })
    assert.equal(people.data.target.followJoiners, false)
  })

  await t.test('excluding without choosing anyone is refused rather than silently meaning nothing', async () => {
    const res = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: { title: 'z', target: { excludePositionIds: ['pos-anjali'], followJoiners: true }, recurrence: { freq: 'none', startDate: today } },
    })
    assert.equal(res.status, 422)
    assert.match(res.data.message, /once you have chosen who/)
  })

  await t.test('an exclusion survives the round trip and still applies at generation', async () => {
    const all = await preview({ nodeIds: ['node-sch-jh'], levelIds: ['lvl-teacher'], followJoiners: true })
    const renu = all.data.people.find((p) => p.userName === 'Renu Nair')
    const res = await api('POST', '/api/tasks', {
      token: lakshmi,
      body: {
        title: 'Everyone but Renu',
        target: { nodeIds: ['node-sch-jh'], levelIds: ['lvl-teacher'], excludePositionIds: [renu.id], followJoiners: true },
        recurrence: { freq: 'none', startDate: today },
      },
    })
    assert.equal(res.status, 201)
    assert.deepEqual(res.data.target.excludePositionIds, [renu.id])
    const rows = (await api('GET', `/api/task-instances?taskId=${res.data.id}`, { token: lakshmi })).data
    assert.equal(rows.length, all.data.count - 1)
    assert.equal(rows.some((i) => i.assigneeName === 'Renu Nair'), false)
  })
})

// ---------------------------------------------------------------------------
test('old targets keep resolving without being migrated', async (t) => {
  await startServer()
  t.after(stopServer)
  await clearSeededTasks()
  const lakshmi = await login('principal@kidzonia.com')
  const meera = await login('superadmin@kidzonia.com')

  const preview = (target, token = lakshmi) =>
    api('POST', '/api/tasks/preview-targets', { token, body: { target } })

  // The read-time shim keys off `followJoiners` being absent. These are the five
  // shapes as they were stored before _tasksV10, sent raw.
  await t.test('kind: position', async () => {
    const res = await preview({ kind: 'position', positionIds: ['pos-anjali'], userIds: [], nodeIds: [], levelId: null })
    assert.equal(res.data.count, 1)
  })
  await t.test('kind: user expands to every hat that person wears', async () => {
    const res = await preview({ kind: 'user', userIds: ['u-teacher'], positionIds: [], nodeIds: [], levelId: null })
    assert.equal(res.data.count, 1)
    assert.equal(res.data.people[0].userName, 'Anjali Rao')
  })
  await t.test('kind: node', async () => {
    const res = await preview({ kind: 'node', nodeIds: ['node-sch-jh'], positionIds: [], userIds: [], levelId: null, includeSubtree: true })
    assert.ok(res.data.count >= 8)
  })
  await t.test('kind: node_level, with the pre-multi-role single levelId', async () => {
    const res = await preview({ kind: 'node_level', nodeIds: ['node-sch-jh'], levelId: 'lvl-teacher', positionIds: [], userIds: [] })
    assert.equal(res.data.count, 5)
  })
  await t.test('kind: downline', async () => {
    const res = await preview({ kind: 'downline', nodeIds: [], positionIds: [], userIds: [], levelId: null }, meera)
    assert.ok(res.data.count >= 12, 'the whole tree below the MD')
  })
})
