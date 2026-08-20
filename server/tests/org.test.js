import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, stopServer, api, login } from './helpers.js'

test('org: tree, ancestry and level scoping', async (t) => {
  await startServer()
  t.after(stopServer)

  const meera = await login('superadmin@kidzonia.com')      // HQ Managing Director
  const nandita = await login('nandita.rao@kidzonia.com')   // HQ Co-ordinator
  const prakash = await login('prakash.reddy@kidzonia.com') // Franchise owner (JH)
  const lakshmi = await login('principal@kidzonia.com')     // Principal, JH school
  const sunil = await login('principal.gb@kidzonia.com')    // Principal, GB school
  const anjali = await login('teacher@kidzonia.com')        // Teacher, JH school

  await t.test('seeded tree: franchise branch is deeper than the company-owned one', async () => {
    const { status, data } = await api('GET', '/api/org/tree', { token: meera })
    assert.equal(status, 200)
    assert.equal(data.tree.id, 'node-hq')
    assert.equal(data.tree.depth, 0)
    const own = data.tree.children.find((c) => c.id === 'node-own-jh')
    const gb = data.tree.children.find((c) => c.id === 'node-sch-gb')
    assert.equal(own.depth, 1)
    assert.equal(own.type, 'franchise')
    assert.equal(gb.depth, 1)
    assert.equal(gb.type, 'school')
    const jh = own.children[0]
    assert.equal(jh.id, 'node-sch-jh')
    assert.equal(jh.depth, 2)                                    // one deeper: owner tier exists
    assert.deepEqual(jh.path, ['node-hq', 'node-own-jh', 'node-sch-jh'])
  })

  await t.test('/org/me reports the tier label and depth', async () => {
    const { data } = await api('GET', '/api/org/me', { token: lakshmi })
    assert.equal(data.tier, 'Principal')
    assert.equal(data.depth, 2)
    assert.ok(data.canAssign)

    const teacher = await api('GET', '/api/org/me', { token: anjali })
    assert.equal(teacher.data.tier, 'Teacher')
    assert.equal(teacher.data.depth, 2)
    assert.equal(teacher.data.downlineCount, 0)                  // leaf: nobody below
    assert.equal(teacher.data.canAssign, false)
  })

  await t.test('downline: ancestors reach down, peers and superiors do not', async () => {
    const can = async (token, positionId) =>
      (await api('GET', `/api/org/can-manage?positionId=${positionId}`, { token })).data.allowed

    // HQ co-ordinator reaches both branches despite their different depths
    assert.equal(await can(nandita, 'pos-anjali'), true)          // franchise branch, depth 2
    assert.equal(await can(nandita, 'pos-divya'), true)           // non-franchise branch, depth 1
    assert.equal(await can(nandita, 'pos-prakash'), true)
    // owner only owns his own subtree
    assert.equal(await can(prakash, 'pos-lakshmi'), true)
    assert.equal(await can(prakash, 'pos-sunil'), false)          // sibling school
    assert.equal(await can(prakash, 'pos-divya'), false)
    // principal -> own teachers, not the other school's
    assert.equal(await can(lakshmi, 'pos-anjali'), true)
    assert.equal(await can(sunil, 'pos-anjali'), false)
    // upward and sideways are always false
    assert.equal(await can(anjali, 'pos-lakshmi'), false)         // superior
    assert.equal(await can(anjali, 'pos-kavya'), false)           // peer, same node+rank
    assert.equal(await can(anjali, 'pos-anjali'), false)          // self
    assert.equal(await can(lakshmi, 'pos-prakash'), false)        // own ancestor
    assert.equal(await can(nandita, 'pos-meera'), false)          // senior at the same node
    assert.equal(await can(meera, 'pos-nandita'), true)           // same node, senior rank wins
  })

  await t.test('/org/downline and /org/ancestors over HTTP', async () => {
    // the acceptance case, end to end: one call, both branches, different depths
    const { status, data } = await api('GET', '/api/org/downline', { token: nandita })
    assert.equal(status, 200)
    const jhTeacher = data.find((p) => p.id === 'pos-anjali')
    const gbTeacher = data.find((p) => p.id === 'pos-divya')
    assert.equal(jhTeacher.depth, 2)
    assert.equal(gbTeacher.depth, 1)

    const line = await api('GET', '/api/org/ancestors', { token: anjali })
    assert.deepEqual(line.data.map((p) => p.tier), ['Vice Principal', 'Principal', 'School Owner', 'HQ School Co-ordinator', 'Managing Director'])

    // the non-franchise branch is one link shorter
    const gbLine = await api('GET', '/api/org/ancestors', { token: await login('teacher.gb@kidzonia.com') })
    assert.deepEqual(gbLine.data.map((p) => p.tier), ['Principal', 'HQ School Co-ordinator', 'Managing Director'])

    // reading someone else's downline is itself gated by canManage
    const peek = await api('GET', '/api/org/downline?userId=u-principal', { token: nandita })
    assert.equal(peek.status, 200)
    assert.ok(peek.data.every((p) => p.nodeId === 'node-sch-jh'))
    const upward = await api('GET', '/api/org/downline?userId=u-coord', { token: anjali })
    assert.equal(upward.status, 403)
  })

  await t.test('same-node rank: principal outranks VP outranks teacher', async () => {
    const { data } = await api('GET', '/api/org/downline?nodeId=node-sch-jh', { token: lakshmi })
    const ids = data.map((p) => p.id)
    assert.ok(ids.includes('pos-sudhir'))                         // VP, rank 20
    assert.ok(ids.includes('pos-anjali'))
    assert.ok(!ids.includes('pos-lakshmi'))                       // never yourself
    const sudhir = await login('sudhir.kukreja@kidzonia.com')
    const vpView = await api('GET', '/api/org/downline', { token: sudhir })
    assert.ok(vpView.data.every((p) => p.id !== 'pos-lakshmi'))   // VP cannot reach the principal
    assert.ok(vpView.data.some((p) => p.id === 'pos-anjali'))
  })

  await t.test('levels can only be created strictly below your own', async () => {
    // Principal (school node, rank 10) may add a rank-60 tier at her school
    const ok = await api('POST', '/api/org/levels', {
      token: lakshmi,
      body: { name: 'Lab Assistant', scopeNodeId: 'node-sch-jh', scopeKind: 'school', rank: 60 },
    })
    assert.equal(ok.status, 201)
    assert.equal(ok.data.scopeNodeId, 'node-sch-jh')

    // …but not a peer or a superior tier at her own node
    const peer = await api('POST', '/api/org/levels', {
      token: lakshmi,
      body: { name: 'Co-Principal', scopeNodeId: 'node-sch-jh', scopeKind: 'school', rank: 10 },
    })
    assert.equal(peer.status, 403)
    assert.equal(peer.data.error, 'level_above_own')

    // …and never at HQ or a sibling school
    const atHq = await api('POST', '/api/org/levels', {
      token: lakshmi,
      body: { name: 'HQ Analyst', scopeNodeId: 'node-hq', scopeKind: 'hq', rank: 99 },
    })
    assert.equal(atHq.status, 403)
    const atSibling = await api('POST', '/api/org/levels', {
      token: lakshmi,
      body: { name: 'GB Helper', scopeNodeId: 'node-sch-gb', scopeKind: 'school', rank: 99 },
    })
    assert.equal(atSibling.status, 403)
  })

  await t.test('a school-scoped level is invisible to sibling schools', async () => {
    const jh = await api('GET', '/api/org/levels?usableAt=node-sch-jh', { token: meera })
    const gb = await api('GET', '/api/org/levels?usableAt=node-sch-gb', { token: meera })
    assert.ok(jh.data.some((l) => l.name === 'Lab Assistant'))
    assert.ok(!gb.data.some((l) => l.name === 'Lab Assistant'))
    assert.ok(gb.data.some((l) => l.name === 'Teacher'))          // HQ-scoped levels reach everywhere
    // HQ-only tiers never show up at a school node
    assert.ok(!gb.data.some((l) => l.name === 'Managing Director'))
  })

  await t.test('positions: placed below you only, level must be in scope', async () => {
    const labLevel = (await api('GET', '/api/org/levels?usableAt=node-sch-jh', { token: lakshmi }))
      .data.find((l) => l.name === 'Lab Assistant')

    const placed = await api('POST', '/api/org/positions', {
      token: lakshmi,
      body: { userId: 'u-renu', nodeId: 'node-sch-jh', levelId: labLevel.id, title: 'Lab Assistant' },
    })
    assert.equal(placed.status, 409)                              // already holds a position there
    assert.equal(placed.data.error, 'duplicate_position')

    // a teacher cannot place anyone
    const byTeacher = await api('POST', '/api/org/positions', {
      token: anjali,
      body: { userId: 'u-frontdesk', nodeId: 'node-sch-jh', levelId: labLevel.id },
    })
    assert.equal(byTeacher.status, 403)

    // a school-scoped level cannot be used at another school
    const wrongScope = await api('POST', '/api/org/positions', {
      token: meera,
      body: { userId: 'u-teacher-gb', nodeId: 'node-sch-gb', levelId: labLevel.id },
    })
    assert.equal(wrongScope.status, 422)
    assert.equal(wrongScope.data.error, 'level_out_of_scope')
  })

  await t.test('nodes: created below you, type rules enforced', async () => {
    const dept = await api('POST', '/api/org/nodes', {
      token: lakshmi,
      body: { type: 'department', name: 'JH Day Care Wing', parentId: 'node-sch-jh' },
    })
    assert.equal(dept.status, 201)
    assert.deepEqual(dept.data.path, ['node-hq', 'node-own-jh', 'node-sch-jh', dept.data.id])
    assert.equal(dept.data.depth, 3)
    assert.equal(dept.data.timezone, 'Asia/Kolkata')

    // a school cannot hang under a department
    const bad = await api('POST', '/api/org/nodes', {
      token: meera,
      body: { type: 'school', name: 'Nope', parentId: dept.data.id, branchId: 'br-jh' },
    })
    assert.equal(bad.status, 422)

    // a principal cannot create a node at HQ or under a sibling school
    const upward = await api('POST', '/api/org/nodes', {
      token: lakshmi,
      body: { type: 'region', name: 'South Region', parentId: 'node-hq' },
    })
    assert.equal(upward.status, 403)
    const sibling = await api('POST', '/api/org/nodes', {
      token: lakshmi,
      body: { type: 'department', name: 'GB Wing', parentId: 'node-sch-gb' },
    })
    assert.equal(sibling.status, 403)

    // and a second root is impossible
    const secondRoot = await api('POST', '/api/org/nodes', { token: meera, body: { type: 'hq', name: 'Other HQ' } })
    assert.equal(secondRoot.status, 422)
    assert.equal(secondRoot.data.error, 'root_exists')
  })

  await t.test('moving a node rewrites the subtree paths; cycles are refused', async () => {
    const cycle = await api('POST', '/api/org/nodes/node-own-jh/move', {
      token: meera,
      body: { parentId: 'node-sch-jh' },                          // into its own subtree
    })
    assert.equal(cycle.status, 409)
    assert.equal(cycle.data.error, 'cycle')

    // GB converts to a franchise: re-parent it under the JH franchise holding
    const moved = await api('POST', '/api/org/nodes/node-sch-gb/move', { token: meera, body: { parentId: 'node-own-jh' } })
    assert.equal(moved.status, 200)
    assert.deepEqual(moved.data.path, ['node-hq', 'node-own-jh', 'node-sch-gb'])
    assert.equal(moved.data.depth, 2)

    // the owner now reaches the GB principal purely because ancestry changed
    const reach = await api('GET', '/api/org/can-manage?positionId=pos-sunil', { token: prakash })
    assert.equal(reach.data.allowed, true)
    const positions = await api('GET', '/api/org/positions?nodeId=node-sch-gb', { token: meera })
    assert.equal(positions.data.find((p) => p.id === 'pos-sunil').depth, 2) // denormalized copy moved too

    // put it back
    await api('POST', '/api/org/nodes/node-sch-gb/move', { token: meera, body: { parentId: 'node-hq' } })
    const back = await api('GET', '/api/org/can-manage?positionId=pos-sunil', { token: prakash })
    assert.equal(back.data.allowed, false)
  })

  await t.test('ending a position removes the reach', async () => {
    const before = await api('GET', '/api/org/can-manage?positionId=pos-divya', { token: sunil })
    assert.equal(before.data.allowed, true)
    const ended = await api('POST', '/api/org/positions/pos-divya/end', { token: sunil, body: { reason: 'Moved to HQ' } })
    assert.equal(ended.status, 200)
    const after = await api('GET', '/api/org/can-manage?positionId=pos-divya', { token: sunil })
    assert.equal(after.data.allowed, false)
    const audit = await api('GET', '/api/audit-log', { token: meera })
    assert.ok(audit.data.some((a) => a.action === 'org.position.end' && a.reason === 'Moved to HQ'))
  })
})
