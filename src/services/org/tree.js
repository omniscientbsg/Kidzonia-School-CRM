// Client-side MIRROR of server/org/tree.js. Kept in sync by hand, exactly like
// services/fees/money.js — it exists so the UI can hide impossible actions.
// It is never the authority: every mutation is re-checked on the server.

export const NODE_TYPE_LABEL = {
  hq: 'HQ',
  region: 'Region',
  franchise: 'Franchise',
  school: 'School',
  department: 'Department',
}

export const ALLOWED_PARENT_TYPES = {
  hq: [],
  region: ['hq', 'region'],
  franchise: ['hq', 'region'],
  school: ['hq', 'region', 'franchise'],
  department: ['school', 'department'],
}

export const SCOPE_KIND_TYPES = {
  hq: ['hq', 'region'],
  franchise: ['franchise'],
  school: ['school', 'department'],
  any: Object.keys(ALLOWED_PARENT_TYPES),
}

export const SCOPE_KIND_LABEL = {
  hq: 'HQ tiers',
  franchise: 'Franchise tiers',
  school: 'School tiers',
  any: 'Any node',
}

// strict ancestry off the materialized path — root-first, inclusive of self
export function isAncestorNode(a, b) {
  if (!a || !b || a.id === b.id) return false
  return b.depth > a.depth && b.path[a.depth] === a.id
}

export function isAncestorOrSelfNode(a, b) {
  return !!a && !!b && (a.id === b.id || isAncestorNode(a, b))
}

export function canManagePosition(actorPos, targetPos, nodeById) {
  if (!actorPos || !targetPos || actorPos.id === targetPos.id) return false
  if (actorPos.nodeId === targetPos.nodeId) return actorPos.rank < targetPos.rank
  return isAncestorNode(nodeById[actorPos.nodeId], nodeById[targetPos.nodeId])
}

// `myPositions` comes from GET /org/me
export function canManageAny(myPositions, targetPos, nodeById) {
  return (myPositions || []).some((p) => canManagePosition(p, targetPos, nodeById))
}

export function canAdministerNode(myPositions, node, nodeById, positionsByNode = {}) {
  if (!node) return false
  return (myPositions || []).some((p) => {
    if (isAncestorNode(nodeById[p.nodeId], node)) return true
    if (p.nodeId !== node.id) return false
    const top = (positionsByNode[node.id] || []).slice().sort((a, b) => a.rank - b.rank)[0]
    return !top || p.rank <= top.rank
  })
}

export function canCreateNodeUnder(myPositions, parentNode, nodeById) {
  return (myPositions || []).some((p) => isAncestorOrSelfNode(nodeById[p.nodeId], parentNode))
}

// levels may only be defined strictly below your own level
export function canCreateLevel(myPositions, scopeNode, rank, nodeById) {
  if (!scopeNode) return false
  return (myPositions || []).some((p) => {
    if (isAncestorNode(nodeById[p.nodeId], scopeNode)) return true
    if (p.nodeId !== scopeNode.id) return false
    return Number(rank) > p.rank
  })
}

export function levelUsableAt(level, node) {
  if (!level || !node) return false
  if (!node.path.includes(level.scopeNodeId)) return false
  return (SCOPE_KIND_TYPES[level.scopeKind] || SCOPE_KIND_TYPES.any).includes(node.type)
}

// flatten the nested /org/tree payload into an id -> node map + ordered list
export function flattenTree(tree) {
  const flat = []
  const walk = (n, parent = null) => {
    flat.push({ ...n, parentName: parent?.name || null })
    for (const c of n.children || []) walk(c, n)
  }
  if (tree) walk(tree)
  const nodeById = Object.fromEntries(flat.map((n) => [n.id, n]))
  const positionsByNode = Object.fromEntries(flat.map((n) => [n.id, n.positions || []]))
  return { flat, nodeById, positionsByNode }
}
