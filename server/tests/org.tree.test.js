// UNIT tests for the ancestry engine — no HTTP, no routes. These call
// server/org/tree.js directly, because canManage is the invariant the whole
// Tasks module rests on and it must be provable on its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const tmp = path.join(os.tmpdir(), `school-crm-tree-${process.pid}-${Date.now()}.json`)
process.env.SCHOOL_CRM_DB = tmp

const { initDb, find, insert, update } = await import('../db.js')
const tree = await import('../org/tree.js')
const {
  buildOrgIndex, canManage, canManagePosition, getDownline, getAncestors,
  isAncestorNode, canCreateLevel, canAdministerNode, levelUsableAt,
  positionsOfUser, primaryPosition, subtreeNodeIds, wouldCreateCycle,
  rebuildSubtreePaths, branchIdOfNode, describePosition,
} = tree

initDb()

const user = (id) => find('users', id)
const pos = (id) => buildOrgIndex().positionById.get(id)
const node = (id) => buildOrgIndex().nodeById.get(id)

test('seeded two-school example is shaped as specified', () => {
  const idx = buildOrgIndex()
  assert.equal(idx.root.id, 'node-hq')
  assert.equal(idx.root.depth, 0)

  // franchise branch: HQ -> Franchise (Owner tier) -> School
  const franchise = node('node-own-jh')
  const jh = node('node-sch-jh')
  assert.equal(franchise.type, 'franchise')
  assert.equal(franchise.depth, 1)
  assert.equal(jh.depth, 2)
  assert.equal(jh.isFranchise, true)
  assert.deepEqual(jh.path, ['node-hq', 'node-own-jh', 'node-sch-jh'])
  assert.equal(describePosition(pos('pos-prakash')).tier, 'School Owner')

  // non-franchise branch: HQ -> School, no Owner tier at all
  const gb = node('node-sch-gb')
  assert.equal(gb.depth, 1)
  assert.equal(gb.isFranchise, false)
  assert.deepEqual(gb.path, ['node-hq', 'node-sch-gb'])
  assert.equal(idx.positionsByNode.get('node-sch-gb').some((p) => p.levelId === 'lvl-owner'), false)

  // depth is STORED on the position, not derived at read time
  assert.equal(pos('pos-anjali').depth, 2)
  assert.equal(pos('pos-divya').depth, 1)
  assert.deepEqual(pos('pos-anjali').nodePath, ['node-hq', 'node-own-jh', 'node-sch-jh'])
  assert.equal(branchIdOfNode(jh), 'br-jh')
})

// ===========================================================================
// THE ACCEPTANCE CRITERION for the module.
// ===========================================================================
test('ACCEPTANCE: an HQ Coordinator manages teachers on BOTH branches despite different depths', () => {
  const coordinator = user('u-coord')                 // Nandita Rao, HQ, depth 0
  const franchiseTeacher = pos('pos-anjali')          // JH,  depth 2 (Owner tier in between)
  const plainTeacher = pos('pos-divya')               // GB,  depth 1 (no Owner tier)

  // the two teachers really are at different depths — that is the whole point
  assert.notEqual(franchiseTeacher.depth, plainTeacher.depth)
  assert.equal(franchiseTeacher.depth, 2)
  assert.equal(plainTeacher.depth, 1)

  // …and the coordinator reaches both, with no depth arithmetic anywhere
  assert.equal(canManage(coordinator, { positionId: 'pos-anjali' }), true)
  assert.equal(canManage(coordinator, { positionId: 'pos-divya' }), true)
  assert.equal(canManage(coordinator, { userId: 'u-teacher' }), true)
  assert.equal(canManage(coordinator, { userId: 'u-teacher-gb' }), true)

  // reach comes from ancestry, not from the level number
  const hq = node('node-hq')
  assert.equal(isAncestorNode(hq, node('node-sch-jh')), true)
  assert.equal(isAncestorNode(hq, node('node-sch-gb')), true)

  // both teachers appear in one downline call, tagged with their own depth
  const downline = getDownline(coordinator)
  const jhTeacher = downline.find((p) => p.id === 'pos-anjali')
  const gbTeacher = downline.find((p) => p.id === 'pos-divya')
  assert.ok(jhTeacher && gbTeacher)
  assert.equal(jhTeacher.depth, 2)
  assert.equal(gbTeacher.depth, 1)

  // and the coordinator is in both teachers' ancestor lines
  assert.ok(getAncestors(user('u-teacher')).some((p) => p.id === 'pos-nandita'))
  assert.ok(getAncestors(user('u-teacher-gb')).some((p) => p.id === 'pos-nandita'))
})

test('canManage: down yes, sideways no, up no, self no', () => {
  const meera = user('u-super')          // MD, HQ, rank 0
  const nandita = user('u-coord')        // HQ Co-ordinator, HQ, rank 10
  const prakash = user('u-owner')        // Owner, franchise node
  const lakshmi = user('u-principal')    // Principal, JH school
  const sudhir = user('u-sudhir')        // Vice Principal, JH school
  const anjali = user('u-teacher')       // Teacher, JH school
  const sunil = user('u-principal-gb')   // Principal, GB school

  // downward through the tree
  assert.equal(canManage(meera, { userId: 'u-teacher' }), true)
  assert.equal(canManage(prakash, { positionId: 'pos-lakshmi' }), true)
  assert.equal(canManage(lakshmi, { positionId: 'pos-anjali' }), true)

  // same node, senior rank wins
  assert.equal(canManage(meera, { positionId: 'pos-nandita' }), true)
  assert.equal(canManage(lakshmi, { positionId: 'pos-sudhir' }), true)
  assert.equal(canManage(sudhir, { positionId: 'pos-anjali' }), true)

  // upward is never allowed
  assert.equal(canManage(anjali, { positionId: 'pos-lakshmi' }), false)
  assert.equal(canManage(nandita, { positionId: 'pos-meera' }), false)
  assert.equal(canManage(sudhir, { positionId: 'pos-lakshmi' }), false)
  assert.equal(canManage(lakshmi, { positionId: 'pos-prakash' }), false)

  // peers: same node, same rank
  assert.equal(canManage(anjali, { positionId: 'pos-kavya' }), false)
  assert.equal(canManagePosition(pos('pos-anjali'), pos('pos-ravi')), false)   // teacher vs front desk
  assert.equal(canManagePosition(pos('pos-ravi'), pos('pos-anjali')), false)

  // self
  assert.equal(canManage(anjali, { positionId: 'pos-anjali' }), false)
  assert.equal(canManage(lakshmi, { userId: 'u-principal' }), false)

  // sibling subtrees never touch
  assert.equal(canManage(prakash, { positionId: 'pos-sunil' }), false)
  assert.equal(canManage(prakash, { positionId: 'pos-divya' }), false)
  assert.equal(canManage(sunil, { positionId: 'pos-anjali' }), false)
  assert.equal(canManage(lakshmi, { positionId: 'pos-divya' }), false)
})

test('getDownline / getAncestors are consistent inverses', () => {
  const everyone = ['u-super', 'u-coord', 'u-owner', 'u-principal', 'u-sudhir', 'u-teacher', 'u-principal-gb', 'u-teacher-gb']
  for (const actorId of everyone) {
    for (const targetId of everyone) {
      if (actorId === targetId) continue
      const reaches = getDownline(user(actorId)).some((p) => p.userId === targetId)
      const isAbove = getAncestors(user(targetId)).some((p) => p.userId === actorId)
      assert.equal(reaches, isAbove, `${actorId} -> ${targetId} disagreed between downline and ancestors`)
      assert.equal(reaches, canManage(user(actorId), { userId: targetId }), `${actorId} -> ${targetId} disagreed with canManage`)
    }
  }
})

test('getDownline: leaves have none, HQ has everyone, ordering is top-down', () => {
  assert.deepEqual(getDownline(user('u-teacher')), [])
  assert.deepEqual(getDownline(user('u-teacher-gb')), [])

  const md = getDownline(user('u-super'))
  assert.equal(md.length, buildOrgIndex().positions.length - 1)     // everyone but herself
  assert.ok(md.every((p, i) => i === 0 || md[i - 1].depth <= p.depth))

  const principal = getDownline(user('u-principal'))
  assert.ok(principal.every((p) => p.nodeId === 'node-sch-jh'))
  assert.ok(!principal.some((p) => p.id === 'pos-lakshmi'))
  assert.equal(getDownline(user('u-principal'), { levelId: 'lvl-teacher' }).length, 5)
})

test('getAncestors: nearest boss first, and it is the approval set', () => {
  const line = getAncestors(user('u-teacher')).map((p) => p.id)
  assert.deepEqual(line, ['pos-sudhir', 'pos-lakshmi', 'pos-prakash', 'pos-nandita', 'pos-meera'])

  // the non-franchise branch is one link shorter — no Owner tier exists there
  const gbLine = getAncestors(user('u-teacher-gb')).map((p) => p.id)
  assert.deepEqual(gbLine, ['pos-sunil', 'pos-nandita', 'pos-meera'])
  assert.ok(!gbLine.includes('pos-prakash'))

  assert.deepEqual(getAncestors(user('u-super')), [])                // the root answers to nobody
})

test('invariant #2: levels can only be created BELOW your own level', () => {
  const lakshmi = user('u-principal')     // Principal, rank 10, at node-sch-jh
  const jh = node('node-sch-jh')

  assert.equal(canCreateLevel(lakshmi, jh, 60), true)     // junior tier at her own school
  assert.equal(canCreateLevel(lakshmi, jh, 11), true)
  assert.equal(canCreateLevel(lakshmi, jh, 10), false)    // a peer of herself
  assert.equal(canCreateLevel(lakshmi, jh, 0), false)     // a boss of herself

  // an ancestor may define any rank in a subtree below them
  assert.equal(canCreateLevel(user('u-coord'), jh, 0), true)
  assert.equal(canCreateLevel(user('u-super'), node('node-hq'), 5), true)
  // …but not at or above their own rank at their OWN node
  assert.equal(canCreateLevel(user('u-coord'), node('node-hq'), 10), false)
  assert.equal(canCreateLevel(user('u-coord'), node('node-hq'), 5), false)
  assert.equal(canCreateLevel(user('u-coord'), node('node-hq'), 11), true)

  // A leaf is bound by the same rule and nothing more: she may not mint a peer
  // or a boss, but a strictly junior tier below her satisfies invariant #2.
  // Teachers are kept out of level administration entirely by the coarse
  // `org:create` module gate on the route — the tree is not where that lives.
  assert.equal(canCreateLevel(user('u-teacher'), jh, 40), false)
  assert.equal(canCreateLevel(user('u-teacher'), jh, 10), false)
  assert.equal(canCreateLevel(user('u-teacher'), jh, 99), true)
  assert.equal(canCreateLevel(user('u-teacher'), node('node-sch-gb'), 99), false)   // still only her subtree
})

test('invariant #3: scope is your own subtree — never HQ, never a sibling school', () => {
  const lakshmi = user('u-principal')
  assert.equal(canCreateLevel(lakshmi, node('node-hq'), 99), false)         // cannot reach up to HQ
  assert.equal(canCreateLevel(lakshmi, node('node-sch-gb'), 99), false)     // cannot reach sideways
  assert.equal(canCreateLevel(lakshmi, node('node-own-jh'), 99), false)     // nor her own parent

  // HQ defines levels for HQ *and* for schools; a school-scoped level stays put
  const hqLevel = { id: 'l1', scopeNodeId: 'node-hq', scopeKind: 'school', rank: 40 }
  const jhLevel = { id: 'l2', scopeNodeId: 'node-sch-jh', scopeKind: 'school', rank: 60 }
  assert.equal(levelUsableAt(hqLevel, node('node-sch-jh')), true)
  assert.equal(levelUsableAt(hqLevel, node('node-sch-gb')), true)
  assert.equal(levelUsableAt(jhLevel, node('node-sch-jh')), true)
  assert.equal(levelUsableAt(jhLevel, node('node-sch-gb')), false)          // invisible to the sibling
  assert.equal(levelUsableAt(jhLevel, node('node-hq')), false)

  // scopeKind keeps HQ tiers off school nodes and vice versa
  const mdLevel = buildOrgIndex().levelById.get('lvl-md')
  assert.equal(levelUsableAt(mdLevel, node('node-hq')), true)
  assert.equal(levelUsableAt(mdLevel, node('node-sch-jh')), false)

  // node administration follows the same rule
  assert.equal(canAdministerNode(lakshmi, node('node-sch-jh')), true)       // top of her own node
  assert.equal(canAdministerNode(lakshmi, node('node-sch-gb')), false)
  assert.equal(canAdministerNode(lakshmi, node('node-hq')), false)
  assert.equal(canAdministerNode(user('u-teacher'), node('node-sch-jh')), false)
})

test('placing a person stores depth + ancestry, and a move rewrites both', () => {
  const before = pos('pos-divya')
  assert.equal(before.depth, 1)
  assert.deepEqual(before.nodePath, ['node-hq', 'node-sch-gb'])

  // GB converts to a franchise: re-parent it under the JH franchise holding
  assert.equal(wouldCreateCycle('node-own-jh', 'node-sch-jh'), true)       // guard first
  assert.equal(wouldCreateCycle('node-sch-gb', 'node-own-jh'), false)
  update('orgNodes', 'node-sch-gb', { parentId: 'node-own-jh' })
  rebuildSubtreePaths('node-sch-gb')

  const after = pos('pos-divya')
  assert.equal(after.depth, 2)
  assert.deepEqual(after.nodePath, ['node-hq', 'node-own-jh', 'node-sch-gb'])
  assert.equal(canManage(user('u-owner'), { positionId: 'pos-divya' }), true)   // owner now reaches GB
  assert.ok(getAncestors(user('u-teacher-gb')).some((p) => p.id === 'pos-prakash'))

  // put it back and the reach disappears again
  update('orgNodes', 'node-sch-gb', { parentId: 'node-hq' })
  rebuildSubtreePaths('node-sch-gb')
  assert.equal(pos('pos-divya').depth, 1)
  assert.equal(canManage(user('u-owner'), { positionId: 'pos-divya' }), false)
})

test('a deeper subtree keeps working: department under a school', () => {
  const dept = insert('orgNodes', {
    type: 'department', name: 'JH Day Care Wing', parentId: 'node-sch-jh',
    path: ['node-hq', 'node-own-jh', 'node-sch-jh', 'node-dept-dc'], depth: 3,
    id: 'node-dept-dc', branchId: null, timezone: 'Asia/Kolkata', settings: {}, active: true,
  })
  const helper = insert('orgPositions', {
    id: 'pos-helper', userId: 'u-gayatri', nodeId: dept.id, levelId: 'lvl-daycare',
    rank: 40, nodePath: dept.path, depth: 3, isPrimary: false, endDate: null, active: true,
  })

  assert.equal(subtreeNodeIds('node-sch-jh').includes('node-dept-dc'), true)
  assert.equal(branchIdOfNode(dept), 'br-jh')                      // inherited from the school above
  assert.equal(canManagePosition(pos('pos-lakshmi'), helper), true)
  assert.equal(canManagePosition(pos('pos-anjali'), helper), true)  // teacher (d2) is above a d3 node
  assert.equal(canManagePosition(helper, pos('pos-anjali')), false)
  assert.equal(canManage(user('u-coord'), { positionId: 'pos-helper' }), true)
  assert.equal(canManage(user('u-principal-gb'), { positionId: 'pos-helper' }), false)

  update('orgPositions', 'pos-helper', { endDate: '2026-08-08', active: false })
})

test('multi-hat users and unplaced users', () => {
  // a second hat only ever adds reach
  insert('orgPositions', {
    id: 'pos-nandita-gb', userId: 'u-coord', nodeId: 'node-sch-gb', levelId: 'lvl-principal',
    rank: 10, nodePath: ['node-hq', 'node-sch-gb'], depth: 1, isPrimary: false, endDate: null, active: true,
  })
  assert.equal(positionsOfUser(user('u-coord')).length, 2)
  assert.equal(primaryPosition(user('u-coord')).id, 'pos-nandita')     // shallowest stays primary
  assert.equal(canManage(user('u-coord'), { positionId: 'pos-divya' }), true)
  assert.equal(canManage(user('u-coord'), { positionId: 'pos-meera' }), false)  // still cannot reach up
  update('orgPositions', 'pos-nandita-gb', { endDate: '2026-08-08', active: false })

  // a staff member with no position has no authority at all
  const ghost = insert('users', { id: 'u-ghost', name: 'Unplaced Person', role: 'teacher', branchId: 'br-jh', active: true })
  assert.deepEqual(positionsOfUser(ghost), [])
  assert.deepEqual(getDownline(ghost), [])
  assert.equal(canManage(ghost, { positionId: 'pos-anjali' }), false)
  assert.equal(canManage(user('u-principal'), { userId: 'u-ghost' }), false)   // unreachable, not "below"

  // the super admin bootstrap hat is root-equivalent and nothing more
  const bootstrap = { id: 'u-boot', name: 'Bootstrap', role: 'super_admin' }
  const [implicit] = positionsOfUser(bootstrap)
  assert.equal(implicit.nodeId, 'node-hq')
  assert.equal(implicit.implicit, true)
  assert.equal(canManage(bootstrap, { positionId: 'pos-meera' }), true)
  assert.equal(canManage(bootstrap, { positionId: 'pos-divya' }), true)
})

test.after(() => {
  try { fs.unlinkSync(tmp) } catch { /* already gone */ }
})
