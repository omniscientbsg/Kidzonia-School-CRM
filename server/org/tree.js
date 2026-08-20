// ============================================================================
// The org tree — the single authority for "who may act on whom".
//
// Levels are RELATIVE to a branch of the tree, never a global integer: a
// franchise school (HQ -> Franchise -> School) is one node deeper than a
// company-owned school (HQ -> School), yet permissions behave identically
// because every rule below is expressed as tree ancestry, not arithmetic.
//
// Rule of the house: no route compares depths by hand. Everything goes
// through canManage*/canAdministerNode/canCreateLevel.
// ============================================================================
import { list, find, update, getOrgRev } from '../db.js'

// which node types a node of a given type may hang under. 'hq' is root-only.
export const ALLOWED_PARENT_TYPES = {
  hq: [],
  region: ['hq', 'region'],
  franchise: ['hq', 'region'],
  school: ['hq', 'region', 'franchise'],
  department: ['school', 'department'],
}
export const NODE_TYPES = Object.keys(ALLOWED_PARENT_TYPES)

// a level's scopeKind restricts which node types may hold it
export const SCOPE_KIND_TYPES = {
  hq: ['hq', 'region'],
  franchise: ['franchise'],
  school: ['school', 'department'],
  any: NODE_TYPES,
}

// ---------------------------------------------------------------- index -----
let cache = null

// Maps over the org collections. Rebuilt whenever an org write bumps the rev,
// so callers never see a stale tree; the data is tiny (tens of nodes).
export function buildOrgIndex() {
  const rev = getOrgRev()
  if (cache && cache.rev === rev) return cache

  const nodes = list('orgNodes')
  const levels = list('orgLevels')
  const positions = list('orgPositions', (p) => p.active !== false && !p.endDate)

  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const levelById = new Map(levels.map((l) => [l.id, l]))
  const positionById = new Map(positions.map((p) => [p.id, p]))
  const childrenOf = new Map()
  const positionsByNode = new Map()
  const positionsByUser = new Map()

  for (const n of nodes) {
    if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, [])
    childrenOf.get(n.parentId).push(n)
  }
  for (const p of positions) {
    if (!positionsByNode.has(p.nodeId)) positionsByNode.set(p.nodeId, [])
    positionsByNode.get(p.nodeId).push(p)
    if (!positionsByUser.has(p.userId)) positionsByUser.set(p.userId, [])
    positionsByUser.get(p.userId).push(p)
  }
  for (const arr of positionsByNode.values()) arr.sort((a, b) => a.rank - b.rank)

  const root = nodes.find((n) => !n.parentId) || null
  cache = { rev, nodes, levels, positions, nodeById, levelById, positionById, childrenOf, positionsByNode, positionsByUser, root }
  return cache
}

export const orgIndex = buildOrgIndex

export function rootNode(idx = buildOrgIndex()) {
  return idx.root
}

export function nodeOfPosition(pos, idx = buildOrgIndex()) {
  return pos ? idx.nodeById.get(pos.nodeId) || null : null
}

// ------------------------------------------------------------- ancestry -----

// strict node ancestry, O(1) off the materialized path (root-first, inclusive)
export function isAncestorNode(a, b) {
  if (!a || !b || a.id === b.id) return false
  return b.depth > a.depth && b.path[a.depth] === a.id
}

export function isAncestorOrSelfNode(a, b) {
  return !!a && !!b && (a.id === b.id || isAncestorNode(a, b))
}

export function ancestorNodeIds(node) {
  return node ? node.path.slice(0, -1) : []
}

export function descendantNodes(nodeId, idx = buildOrgIndex()) {
  return idx.nodes.filter((n) => n.id !== nodeId && n.path.includes(nodeId))
}

export function subtreeNodeIds(nodeId, idx = buildOrgIndex()) {
  return [nodeId, ...descendantNodes(nodeId, idx).map((n) => n.id)]
}

// Every position a user currently holds. A super admin with no placement gets
// an implicit root position so an empty tree can still be bootstrapped — it is
// the ONLY role bypass, and it grants no more than sitting at the root does.
export function positionsOfUser(user, idx = buildOrgIndex()) {
  if (!user) return []
  const held = idx.positionsByUser.get(user.id) || []
  if (held.length) return held
  if (user.role === 'super_admin' && idx.root) {
    return [{
      id: `implicit:${user.id}`, implicit: true, userId: user.id,
      nodeId: idx.root.id, levelId: null, title: 'Super Admin',
      rank: -1, depth: 0, nodePath: [idx.root.id], isPrimary: true, active: true,
    }]
  }
  return []
}

export function primaryPosition(user, idx = buildOrgIndex()) {
  const positions = positionsOfUser(user, idx)
  if (!positions.length) return null
  return positions.find((p) => p.isPrimary) || positions.slice().sort((a, b) => a.depth - b.depth || a.rank - b.rank)[0]
}

// ------------------------------------------------------------- canManage ----

// THE invariant: an actor may act on a target iff the actor's node is a strict
// ancestor of the target's node, or they share a node and the actor is
// strictly senior there. Peers and superiors are always false; so is self.
export function canManagePosition(actorPos, targetPos, idx = buildOrgIndex()) {
  if (!actorPos || !targetPos) return false
  if (actorPos.id === targetPos.id) return false
  if (actorPos.nodeId === targetPos.nodeId) return actorPos.rank < targetPos.rank
  return isAncestorNode(nodeOfPosition(actorPos, idx), nodeOfPosition(targetPos, idx))
}

// target: a position row, a position id, or { userId } / { positionId } / { nodeId }
export function canManage(actorUser, target, idx = buildOrgIndex()) {
  const mine = positionsOfUser(actorUser, idx)
  if (!mine.length) return false

  if (typeof target === 'string') target = { positionId: target }
  if (target && target.nodeId && !target.userId && !target.positionId && !target.id) {
    return canAdministerNode(actorUser, idx.nodeById.get(target.nodeId), idx)
  }

  let targets
  if (target && target.id && target.nodeId) targets = [target]            // a position row
  else if (target && target.positionId) targets = [idx.positionById.get(target.positionId)].filter(Boolean)
  else if (target && target.userId) targets = idx.positionsByUser.get(target.userId) || []
  else return false

  if (!targets.length) return false
  // every hat the target wears must be reachable, so nobody is assigned work
  // through one position while outranking the actor through another
  return targets.every((t) => mine.some((m) => canManagePosition(m, t, idx)))
}

// May the actor change this node itself (rename, move, add children, delete)?
// Strict ancestor, or the most senior person sitting at the node.
export function canAdministerNode(actorUser, node, idx = buildOrgIndex()) {
  if (!node) return false
  const mine = positionsOfUser(actorUser, idx)
  return mine.some((p) => {
    const pNode = nodeOfPosition(p, idx)
    if (isAncestorNode(pNode, node)) return true
    if (p.nodeId !== node.id) return false
    const top = (idx.positionsByNode.get(node.id) || [])[0]
    return !top || p.rank <= top.rank
  })
}

// New nodes may only be created below the actor: at their own node or deeper.
export function canCreateNodeUnder(actorUser, parentNode, idx = buildOrgIndex()) {
  if (!parentNode) return false
  const mine = positionsOfUser(actorUser, idx)
  return mine.some((p) => isAncestorOrSelfNode(nodeOfPosition(p, idx), parentNode))
}

// Levels may only be defined strictly below the actor's own level: inside their
// subtree, and (at their own node) at a rank below theirs. HQ therefore defines
// levels for HQ and every school; a school defines levels only in its subtree.
export function canCreateLevel(actorUser, scopeNode, rank, idx = buildOrgIndex()) {
  if (!scopeNode) return false
  const mine = positionsOfUser(actorUser, idx)
  return mine.some((p) => {
    const pNode = nodeOfPosition(p, idx)
    if (isAncestorNode(pNode, scopeNode)) return true
    if (p.nodeId !== scopeNode.id) return false
    return Number(rank) > p.rank        // never mint a peer or a superior
  })
}

// A level is usable at a node when the node sits inside the level's scope
// subtree and the node's type matches the level's scopeKind.
export function levelUsableAt(level, node) {
  if (!level || !node) return false
  if (!node.path.includes(level.scopeNodeId)) return false
  return (SCOPE_KIND_TYPES[level.scopeKind] || SCOPE_KIND_TYPES.any).includes(node.type)
}

// Everyone the actor may act on, optionally narrowed to a node subtree / level.
export function downlinePositions(actorUser, { nodeId = null, levelId = null } = {}, idx = buildOrgIndex()) {
  const mine = positionsOfUser(actorUser, idx)
  if (!mine.length) return []
  let candidates = idx.positions
  if (nodeId) {
    const ids = new Set(subtreeNodeIds(nodeId, idx))
    candidates = candidates.filter((p) => ids.has(p.nodeId))
  }
  if (levelId) candidates = candidates.filter((p) => p.levelId === levelId)
  return candidates.filter((t) => mine.some((m) => canManagePosition(m, t, idx)))
}

// Positions allowed to approve work done by `targetPos` — the assigner plus
// every ancestor. Approval only ever flows upward.
// ---- the two user-facing helpers everything else is expressed in terms of ---

// Everyone a user may act on, described for display. Union across all the hats
// they wear; de-duped, ordered top-down.
export function getDownline(actorUser, opts = {}, idx = buildOrgIndex()) {
  return downlinePositions(actorUser, opts, idx)
    .map((p) => describePosition(p, idx))
    .sort((a, b) => a.depth - b.depth || a.rank - b.rank || a.userName.localeCompare(b.userName))
}

// The reporting line above a user: every position that can manage them, nearest
// boss first. This is also the set allowed to approve their work.
export function getAncestors(targetUser, idx = buildOrgIndex()) {
  const mine = positionsOfUser(targetUser, idx)
  if (!mine.length) return []
  const seen = new Set()
  return idx.positions
    .filter((p) => mine.some((m) => canManagePosition(p, m, idx)))
    .filter((p) => (seen.has(p.id) ? false : seen.add(p.id)))
    .map((p) => describePosition(p, idx))
    .sort((a, b) => b.depth - a.depth || b.rank - a.rank)   // nearest first
}

export function approverPositionsFor(targetPos, idx = buildOrgIndex()) {
  if (!targetPos) return []
  return idx.positions.filter((p) => canManagePosition(p, targetPos, idx))
}

export function canApprove(actorUser, targetPos, namedApproverId = null, idx = buildOrgIndex()) {
  const mine = positionsOfUser(actorUser, idx)
  if (!mine.length) return false
  if (namedApproverId && mine.some((p) => p.id === namedApproverId)) return true
  return mine.some((p) => canManagePosition(p, targetPos, idx))
}

// ------------------------------------------------------- path maintenance ---

export function computePath(parentNode, id) {
  return parentNode ? [...parentNode.path, id] : [id]
}

// Recompute path/depth for a subtree after a move, then re-stamp the
// denormalized copies carried by positions in that subtree. One pass, no
// recursion into the db.
export function rebuildSubtreePaths(nodeId, userId = null) {
  const idx = buildOrgIndex()
  const node = idx.nodeById.get(nodeId)
  if (!node) return 0
  let touched = 0
  const walk = (n) => {
    const parent = n.parentId ? find('orgNodes', n.parentId) : null
    const path = computePath(parent, n.id)
    if (JSON.stringify(path) !== JSON.stringify(n.path)) {
      update('orgNodes', n.id, { path, depth: path.length - 1 }, userId)
      touched++
    }
    for (const p of list('orgPositions', { nodeId: n.id })) {
      update('orgPositions', p.id, { nodePath: path, depth: path.length - 1 }, userId)
    }
    for (const child of list('orgNodes', { parentId: n.id })) walk(child)
  }
  walk(node)
  return touched
}

// A move that would put a node inside its own subtree is a cycle.
export function wouldCreateCycle(nodeId, newParentId, idx = buildOrgIndex()) {
  if (nodeId === newParentId) return true
  const parent = idx.nodeById.get(newParentId)
  return !!parent && parent.path.includes(nodeId)
}

// The branch a node belongs to: its own, else the nearest ancestor's (a
// department inherits its school's branch). Null for HQ/region nodes.
export function branchIdOfNode(node, idx = buildOrgIndex()) {
  if (!node) return null
  for (let i = node.path.length - 1; i >= 0; i--) {
    const n = idx.nodeById.get(node.path[i])
    if (n?.branchId) return n.branchId
  }
  return null
}

// ------------------------------------------------------------- display ------

// Tier label for display; depth is only ever used for maths/sorting.
export function describePosition(pos, idx = buildOrgIndex()) {
  if (!pos) return null
  const node = nodeOfPosition(pos, idx)
  const level = pos.levelId ? idx.levelById.get(pos.levelId) : null
  const user = find('users', pos.userId)
  return {
    id: pos.id,
    userId: pos.userId,
    userName: user?.name || 'Unknown',
    nodeId: pos.nodeId,
    nodeName: node?.name || '',
    nodeType: node?.type || null,
    branchId: node?.branchId || null,
    timezone: node?.timezone || 'Asia/Kolkata',
    levelId: pos.levelId,
    tier: pos.title || level?.name || 'Unassigned',
    rank: pos.rank,
    depth: pos.depth,
    isPrimary: !!pos.isPrimary,
  }
}
