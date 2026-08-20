import { Router } from 'express'
import { list, find, insert, update, softDelete } from '../db.js'
import { requireAuth, requirePermission, staffOnly } from '../auth.js'
import { auditOrg } from '../audit.js'
import { staffMaster, staffById } from '../users/service.js'
import {
  buildOrgIndex, positionsOfUser, primaryPosition, describePosition,
  canManage, canAdministerNode, canCreateNodeUnder, canCreateLevel,
  levelUsableAt, downlinePositions, getDownline, getAncestors, descendantNodes, subtreeNodeIds,
  computePath, rebuildSubtreePaths, wouldCreateCycle,
  ALLOWED_PARENT_TYPES, NODE_TYPES, SCOPE_KIND_TYPES,
} from '../org/tree.js'

const router = Router()
router.use(requireAuth, staffOnly)

const forbidden = (res, msg = 'Not in your downline') =>
  res.status(403).json({ error: 'not_in_downline', message: msg })

// ============================================================================
// Read: tree, my placement, assignable downline
// ============================================================================

// Nested tree from a root (defaults to the org root). Each node carries its
// positions so the chart can render tiers without an N+1 walk.
router.get('/org/tree', (req, res) => {
  const idx = buildOrgIndex()
  const rootId = req.query.rootId || idx.root?.id
  if (!rootId) return res.json(null)
  const root = idx.nodeById.get(rootId)
  if (!root) return res.status(404).json({ error: 'Not found' })

  const build = (node) => ({
    ...node,
    canAdminister: canAdministerNode(req.user, node, idx),
    positions: (idx.positionsByNode.get(node.id) || []).map((p) => ({ ...describePosition(p, idx), manageable: canManage(req.user, p, idx) })),
    children: (idx.childrenOf.get(node.id) || [])
      .filter((c) => c.active !== false || req.query.includeInactive === 'true')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(build),
  })
  const tree = build(root)
  res.json({ tree, canAdminister: canAdministerNode(req.user, root, idx) })
})

// Who am I in the tree? Drives every "can I do this" hint in the UI.
router.get('/org/me', (req, res) => {
  const idx = buildOrgIndex()
  const positions = positionsOfUser(req.user, idx).map((p) => describePosition(p, idx))
  const primary = primaryPosition(req.user, idx)
  const downline = downlinePositions(req.user, {}, idx)
  res.json({
    userId: req.user.id,
    name: req.user.name,
    positions,
    primaryPositionId: primary?.id || null,
    depth: primary?.depth ?? null,
    tier: primary ? describePosition(primary, idx).tier : null,
    downlineCount: downline.length,
    downlineNodeIds: primary ? subtreeNodeIds(primary.nodeId, idx).filter((id) => id !== primary.nodeId) : [],
    canAssign: downline.length > 0,
  })
})

// Everyone this caller may assign work to (optionally narrowed).
router.get('/org/downline', (req, res) => {
  const idx = buildOrgIndex()
  const target = req.query.userId ? find('users', req.query.userId) : req.user
  if (!target) return res.status(404).json({ error: 'Not found' })
  // looking at someone else's downline is itself an act on them
  if (target.id !== req.user.id && !canManage(req.user, { userId: target.id }, idx)) return forbidden(res)
  res.json(getDownline(target, { nodeId: req.query.nodeId || null, levelId: req.query.levelId || null }, idx))
})

// The reporting line above someone — nearest boss first. Also the set that may
// approve their work.
router.get('/org/ancestors', (req, res) => {
  const idx = buildOrgIndex()
  const target = req.query.userId ? find('users', req.query.userId) : req.user
  if (!target) return res.status(404).json({ error: 'Not found' })
  res.json(getAncestors(target, idx))
})

// Debug/UX helper — mirrors the exact server check the mutations run.
router.get('/org/can-manage', (req, res) => {
  const { positionId, userId, nodeId } = req.query
  const target = positionId ? { positionId } : userId ? { userId } : nodeId ? { nodeId } : null
  if (!target) return res.status(400).json({ error: 'positionId, userId or nodeId required' })
  res.json({ allowed: canManage(req.user, target) })
})

// ============================================================================
// Nodes
// ============================================================================
router.get('/org/nodes', (req, res) => {
  const where = {}
  for (const f of ['type', 'parentId', 'branchId']) if (req.query[f] !== undefined) where[f] = req.query[f]
  res.json(list('orgNodes', where))
})

router.get('/org/nodes/:id', (req, res) => {
  const node = find('orgNodes', req.params.id)
  if (!node) return res.status(404).json({ error: 'Not found' })
  const idx = buildOrgIndex()
  res.json({
    ...node,
    positions: (idx.positionsByNode.get(node.id) || []).map((p) => describePosition(p, idx)),
    childCount: (idx.childrenOf.get(node.id) || []).length,
    canAdminister: canAdministerNode(req.user, node, idx),
  })
})

router.post('/org/nodes', requirePermission('org', 'create'), (req, res) => {
  const idx = buildOrgIndex()
  const { type, name, parentId } = req.body || {}
  if (!name || !type) return res.status(422).json({ error: 'name and type are required' })
  if (!NODE_TYPES.includes(type)) return res.status(422).json({ error: `type must be one of ${NODE_TYPES.join(', ')}` })

  if (!parentId) {
    if (idx.root) return res.status(422).json({ error: 'root_exists', message: 'The tree already has an HQ root' })
    if (type !== 'hq') return res.status(422).json({ error: 'The root node must be of type hq' })
  }
  const parent = parentId ? idx.nodeById.get(parentId) : null
  if (parentId && !parent) return res.status(422).json({ error: 'Unknown parentId' })
  if (parent && !ALLOWED_PARENT_TYPES[type].includes(parent.type)) {
    return res.status(422).json({ error: `A ${type} node cannot sit under a ${parent.type} node` })
  }
  if (parent && !canCreateNodeUnder(req.user, parent, idx)) return forbidden(res, 'You may only create nodes below your own')
  if (type === 'school' && !req.body.branchId) return res.status(422).json({ error: 'school nodes need a branchId' })

  const id = req.body.id || undefined
  const row = insert('orgNodes', {
    ...(id ? { id } : {}),
    type,
    name,
    code: req.body.code || null,
    parentId: parentId || null,
    path: [],
    depth: 0,
    branchId: req.body.branchId || null,
    isFranchise: !!req.body.isFranchise,
    timezone: req.body.timezone || parent?.timezone || 'Asia/Kolkata',
    settings: {
      blockingLogoutEnabled: req.body.settings?.blockingLogoutEnabled ?? true,
      workWeek: req.body.settings?.workWeek || parent?.settings?.workWeek || [1, 2, 3, 4, 5, 6],
    },
    active: true,
  }, req.user.id)
  const path = computePath(parent, row.id)
  const saved = update('orgNodes', row.id, { path, depth: path.length - 1 }, req.user.id)
  auditOrg(req, 'org.node.create', 'orgNodes', saved.id, { after: saved, positionId: primaryPosition(req.user)?.id })
  res.status(201).json(saved)
})

router.put('/org/nodes/:id', requirePermission('org', 'edit'), (req, res) => {
  const idx = buildOrgIndex()
  const node = idx.nodeById.get(req.params.id)
  if (!node) return res.status(404).json({ error: 'Not found' })
  if (!canAdministerNode(req.user, node, idx)) return forbidden(res, 'You may only edit nodes below your own')
  const before = { ...node }
  const patch = {}
  for (const f of ['name', 'code', 'branchId', 'isFranchise', 'timezone', 'active']) {
    if (req.body[f] !== undefined) patch[f] = req.body[f]
  }
  if (req.body.settings) patch.settings = { ...node.settings, ...req.body.settings }
  const row = update('orgNodes', node.id, patch, req.user.id)
  auditOrg(req, 'org.node.update', 'orgNodes', node.id, { before, after: row, positionId: primaryPosition(req.user)?.id })
  res.json(row)
})

// Re-parent a node (e.g. a school converts to a franchise). Rewrites the
// materialized paths of the whole subtree so ancestry stays O(1).
router.post('/org/nodes/:id/move', requirePermission('org', 'edit'), (req, res) => {
  const idx = buildOrgIndex()
  const node = idx.nodeById.get(req.params.id)
  const parent = idx.nodeById.get(req.body?.parentId)
  if (!node) return res.status(404).json({ error: 'Not found' })
  if (!parent) return res.status(422).json({ error: 'Unknown parentId' })
  if (!node.parentId) return res.status(422).json({ error: 'The root node cannot be moved' })
  if (wouldCreateCycle(node.id, parent.id, idx)) {
    return res.status(409).json({ error: 'cycle', message: 'A node cannot be moved inside its own subtree' })
  }
  if (!ALLOWED_PARENT_TYPES[node.type].includes(parent.type)) {
    return res.status(422).json({ error: `A ${node.type} node cannot sit under a ${parent.type} node` })
  }
  if (!canAdministerNode(req.user, node, idx)) return forbidden(res, 'That node is not below you')
  if (!canCreateNodeUnder(req.user, parent, idx)) return forbidden(res, 'That destination is not below you')

  const before = { ...node }
  update('orgNodes', node.id, { parentId: parent.id }, req.user.id)
  rebuildSubtreePaths(node.id, req.user.id)
  const after = find('orgNodes', node.id)
  auditOrg(req, 'org.node.move', 'orgNodes', node.id, { before, after, positionId: primaryPosition(req.user)?.id })
  res.json(after)
})

router.delete('/org/nodes/:id', requirePermission('org', 'delete'), (req, res) => {
  const idx = buildOrgIndex()
  const node = idx.nodeById.get(req.params.id)
  if (!node) return res.status(404).json({ error: 'Not found' })
  if (!node.parentId) return res.status(422).json({ error: 'The root node cannot be deleted' })
  if (!canAdministerNode(req.user, node, idx)) return forbidden(res)
  if (descendantNodes(node.id, idx).length) return res.status(409).json({ error: 'has_children', message: 'Move or remove child nodes first' })
  if ((idx.positionsByNode.get(node.id) || []).length) return res.status(409).json({ error: 'has_positions', message: 'End the positions at this node first' })
  softDelete('orgNodes', node.id, req.user.id)
  auditOrg(req, 'org.node.deactivate', 'orgNodes', node.id, { before: node, positionId: primaryPosition(req.user)?.id })
  res.json({ ok: true })
})

// ============================================================================
// Levels (tiers). Creatable only strictly below the actor.
// ============================================================================
router.get('/org/levels', (req, res) => {
  const idx = buildOrgIndex()
  const rows = list('orgLevels')
  const nodeId = req.query.usableAt
  const node = nodeId ? idx.nodeById.get(nodeId) : null
  const filtered = node ? rows.filter((l) => levelUsableAt(l, node)) : rows
  res.json(filtered
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((l) => ({ ...l, canCreateBelow: canCreateLevel(req.user, idx.nodeById.get(l.scopeNodeId), l.rank + 1, idx) })))
})

router.post('/org/levels', requirePermission('org', 'create'), (req, res) => {
  const idx = buildOrgIndex()
  const { name, scopeNodeId, scopeKind = 'school', rank } = req.body || {}
  if (!name) return res.status(422).json({ error: 'name is required' })
  if (rank === undefined || rank === null || Number.isNaN(Number(rank))) return res.status(422).json({ error: 'rank is required' })
  if (!SCOPE_KIND_TYPES[scopeKind]) return res.status(422).json({ error: `scopeKind must be one of ${Object.keys(SCOPE_KIND_TYPES).join(', ')}` })
  const scopeNode = idx.nodeById.get(scopeNodeId)
  if (!scopeNode) return res.status(422).json({ error: 'Unknown scopeNodeId' })
  if (!canCreateLevel(req.user, scopeNode, Number(rank), idx)) {
    return res.status(403).json({ error: 'level_above_own', message: 'Levels can only be created strictly below your own' })
  }
  const row = insert('orgLevels', {
    ...(req.body.id ? { id: req.body.id } : {}),
    name,
    code: req.body.code || name.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
    scopeNodeId,
    scopeKind,
    rank: Number(rank),
    color: req.body.color || null,
    createdByPositionId: primaryPosition(req.user, idx)?.id || null,
    active: true,
  }, req.user.id)
  auditOrg(req, 'org.level.create', 'orgLevels', row.id, { after: row, positionId: row.createdByPositionId })
  res.status(201).json(row)
})

router.put('/org/levels/:id', requirePermission('org', 'edit'), (req, res) => {
  const idx = buildOrgIndex()
  const level = idx.levelById.get(req.params.id)
  if (!level) return res.status(404).json({ error: 'Not found' })
  const scopeNode = idx.nodeById.get(level.scopeNodeId)
  const nextRank = req.body.rank !== undefined ? Number(req.body.rank) : level.rank
  if (!canCreateLevel(req.user, scopeNode, nextRank, idx)) return forbidden(res, 'That level is not below you')
  const before = { ...level }
  const patch = {}
  for (const f of ['name', 'code', 'color', 'active']) if (req.body[f] !== undefined) patch[f] = req.body[f]
  if (req.body.rank !== undefined) patch.rank = nextRank
  const row = update('orgLevels', level.id, patch, req.user.id)
  // rank drives the same-node tiebreak, so positions carry a denormalized copy
  if (patch.rank !== undefined) {
    for (const p of list('orgPositions', { levelId: level.id })) update('orgPositions', p.id, { rank: patch.rank }, req.user.id)
  }
  auditOrg(req, 'org.level.update', 'orgLevels', level.id, { before, after: row, positionId: primaryPosition(req.user, idx)?.id })
  res.json(row)
})

// ============================================================================
// Positions (a user placed at a node with a tier)
// ============================================================================
router.get('/org/positions', (req, res) => {
  const idx = buildOrgIndex()
  let rows = list('orgPositions', (p) => !p.endDate)
  if (req.query.nodeId) {
    const ids = new Set(req.query.includeSubtree === 'true' ? subtreeNodeIds(req.query.nodeId, idx) : [req.query.nodeId])
    rows = rows.filter((p) => ids.has(p.nodeId))
  }
  if (req.query.userId) rows = rows.filter((p) => p.userId === req.query.userId)
  if (req.query.levelId) rows = rows.filter((p) => p.levelId === req.query.levelId)
  res.json(rows.map((p) => ({ ...describePosition(p, idx), manageable: canManage(req.user, p, idx) })))
})

router.post('/org/positions', requirePermission('org', 'create'), (req, res) => {
  const idx = buildOrgIndex()
  const { userId, nodeId, levelId } = req.body || {}
  const user = find('users', userId)
  const node = idx.nodeById.get(nodeId)
  const level = idx.levelById.get(levelId)
  if (!user) return res.status(422).json({ error: 'Unknown userId' })
  if (!node) return res.status(422).json({ error: 'Unknown nodeId' })
  if (!level) return res.status(422).json({ error: 'Unknown levelId' })
  if (!levelUsableAt(level, node)) {
    return res.status(422).json({ error: 'level_out_of_scope', message: `${level.name} is not defined for this part of the tree` })
  }
  // placing someone is an act on the target node — it must be below the actor,
  // and the new position must land below the actor's own rank at that node
  if (!canCreateLevel(req.user, node, level.rank, idx)) return forbidden(res, 'You may only place people below your own level')
  if (list('orgPositions', (p) => p.userId === userId && p.nodeId === nodeId && !p.endDate).length) {
    return res.status(409).json({ error: 'duplicate_position', message: 'That user already holds a position at this node' })
  }
  const held = list('orgPositions', (p) => p.userId === userId && !p.endDate)
  const row = insert('orgPositions', {
    ...(req.body.id ? { id: req.body.id } : {}),
    userId,
    nodeId,
    levelId,
    title: req.body.title || null,
    rank: level.rank,
    nodePath: node.path,
    depth: node.depth,
    isPrimary: req.body.isPrimary !== undefined ? !!req.body.isPrimary : held.length === 0,
    startDate: req.body.startDate || new Date().toISOString().slice(0, 10),
    endDate: null,
    active: true,
  }, req.user.id)
  auditOrg(req, 'org.position.create', 'orgPositions', row.id, { after: row, positionId: primaryPosition(req.user, idx)?.id })
  res.status(201).json(describePosition(row))
})

router.put('/org/positions/:id', requirePermission('org', 'edit'), (req, res) => {
  const idx = buildOrgIndex()
  const pos = idx.positionById.get(req.params.id)
  if (!pos) return res.status(404).json({ error: 'Not found' })
  if (!canManage(req.user, pos, idx)) return forbidden(res)
  const before = { ...pos }
  const patch = {}
  if (req.body.title !== undefined) patch.title = req.body.title
  if (req.body.isPrimary !== undefined) patch.isPrimary = !!req.body.isPrimary
  if (req.body.levelId !== undefined && req.body.levelId !== pos.levelId) {
    const level = idx.levelById.get(req.body.levelId)
    const node = idx.nodeById.get(pos.nodeId)
    if (!level) return res.status(422).json({ error: 'Unknown levelId' })
    if (!levelUsableAt(level, node)) return res.status(422).json({ error: 'level_out_of_scope' })
    if (!canCreateLevel(req.user, node, level.rank, idx)) return forbidden(res, 'You may only assign levels below your own')
    patch.levelId = level.id
    patch.rank = level.rank
  }
  const row = update('orgPositions', pos.id, patch, req.user.id)
  auditOrg(req, 'org.position.update', 'orgPositions', pos.id, { before, after: row, positionId: primaryPosition(req.user, idx)?.id })
  res.json(describePosition(row))
})

// Positions are ended, never deleted — history (and old task instances) keep
// pointing at them.
router.post('/org/positions/:id/end', requirePermission('org', 'delete'), (req, res) => {
  const idx = buildOrgIndex()
  const pos = idx.positionById.get(req.params.id)
  if (!pos) return res.status(404).json({ error: 'Not found' })
  if (!canManage(req.user, pos, idx)) return forbidden(res)
  const before = { ...pos }
  const row = update('orgPositions', pos.id, {
    endDate: req.body?.endDate || new Date().toISOString().slice(0, 10),
    active: false,
  }, req.user.id)
  auditOrg(req, 'org.position.end', 'orgPositions', pos.id, { before, after: row, reason: req.body?.reason || null, positionId: primaryPosition(req.user, idx)?.id })
  res.json({ ok: true })
})

// ============================================================================
// Importing from the user master.
//
// People are NEVER re-registered for the Tasks module. They already exist in
// `users`; placing them is just adding an orgPositions row that points at the
// same id. These two endpoints make that explicit: see who is not yet placed,
// then place them in bulk.
// ============================================================================

// Staff in the master who hold no active position — invisible to Tasks until
// someone places them, which is the easiest trap to fall into after a new hire.
router.get('/org/unplaced-staff', (req, res) => {
  const idx = buildOrgIndex()
  const placed = new Set(idx.positions.map((p) => p.userId))
  const rows = staffMaster()
    .filter((u) => u.active !== false && !placed.has(u.id))
    .filter((u) => !req.scope.branchId || !u.branchId || u.branchId === req.scope.branchId)
    .map((u) => ({
      id: u.id, name: u.name, role: u.role, designation: u.designation || null,
      employeeId: u.employeeId || null, branchId: u.branchId || null, email: u.email,
    }))
  res.json(rows.sort((a, b) => a.name.localeCompare(b.name)))
})

// Place several existing users at one node/tier in a single action.
router.post('/org/positions/import', requirePermission('org', 'create'), (req, res) => {
  const idx = buildOrgIndex()
  const { userIds = [], nodeId, levelId } = req.body || {}
  const node = idx.nodeById.get(nodeId)
  const level = idx.levelById.get(levelId)
  if (!Array.isArray(userIds) || !userIds.length) return res.status(422).json({ error: 'Pick at least one person from the user master' })
  if (!node) return res.status(422).json({ error: 'Unknown nodeId' })
  if (!level) return res.status(422).json({ error: 'Unknown levelId' })
  if (!levelUsableAt(level, node)) {
    return res.status(422).json({ error: 'level_out_of_scope', message: `${level.name} is not defined for this part of the tree` })
  }
  if (!canCreateLevel(req.user, node, level.rank, idx)) return forbidden(res, 'You may only place people below your own level')

  const created = []
  const skipped = []
  for (const userId of userIds) {
    const user = staffById(userId)
    if (!user) { skipped.push({ userId, reason: 'not_in_user_master' }); continue }
    if (list('orgPositions', (p) => p.userId === userId && p.nodeId === nodeId && !p.endDate).length) {
      skipped.push({ userId, name: user.name, reason: 'already_placed_here' })
      continue
    }
    const held = list('orgPositions', (p) => p.userId === userId && !p.endDate)
    const row = insert('orgPositions', {
      userId, nodeId, levelId,
      title: null,
      rank: level.rank,
      nodePath: node.path,
      depth: node.depth,
      isPrimary: held.length === 0,
      startDate: new Date().toISOString().slice(0, 10),
      endDate: null,
      active: true,
    }, req.user.id)
    auditOrg(req, 'org.position.import', 'orgPositions', row.id, {
      after: row, positionId: primaryPosition(req.user, idx)?.id, reason: `Imported ${user.name} from the user master`,
    })
    created.push(describePosition(row))
  }
  res.status(201).json({ created, skipped, placed: created.length })
})

export default router
