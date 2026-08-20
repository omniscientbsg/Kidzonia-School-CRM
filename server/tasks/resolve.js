// Turn an assignment target into concrete positions — and refuse anything that
// is not in the actor's downline. Resolution runs at CREATE time (to validate)
// and again at GENERATE time (so staff who joined later pick the task up).
import { buildOrgIndex, positionsOfUser, canManagePosition, subtreeNodeIds, describePosition } from '../org/tree.js'

// -> { allowed: [position], rejected: [{ positionId, userName, reason }] }
export function resolveTargets(target, actorUser, idx = buildOrgIndex()) {
  const mine = positionsOfUser(actorUser, idx)
  const spec = target || {}
  let candidates

  switch (spec.kind) {
    case 'position':
      candidates = (spec.positionIds || []).map((id) => idx.positionById.get(id)).filter(Boolean)
      break
    case 'user':
      candidates = (spec.userIds || []).flatMap((id) => idx.positionsByUser.get(id) || [])
      break
    case 'node': {
      const ids = new Set((spec.nodeIds || []).flatMap((n) => (spec.includeSubtree === false ? [n] : subtreeNodeIds(n, idx))))
      candidates = idx.positions.filter((p) => ids.has(p.nodeId))
      break
    }
    case 'node_level': {
      // no nodes named = "everyone at this tier below me", e.g. all Principals
      // under an HQ co-ordinator, across both branches at once
      const scope = spec.nodeIds?.length ? spec.nodeIds : mine.map((p) => p.nodeId)
      const ids = new Set(scope.flatMap((n) => subtreeNodeIds(n, idx)))
      candidates = idx.positions.filter((p) => ids.has(p.nodeId) && p.levelId === spec.levelId)
      break
    }
    case 'downline':
      candidates = idx.positions
      break
    default:
      candidates = []
  }

  // de-dupe: a node target plus an explicit person can name the same position
  const seen = new Set()
  const unique = candidates.filter((p) => (seen.has(p.id) ? false : seen.add(p.id)))

  const allowed = []
  const rejected = []
  for (const p of unique) {
    if (mine.some((m) => canManagePosition(m, p, idx))) allowed.push(p)
    else if (spec.kind !== 'downline' && spec.kind !== 'node' && spec.kind !== 'node_level') {
      // an explicit pick that is out of reach is an error the assigner must see;
      // broad targets (a whole node / tier) simply skip peers and superiors
      rejected.push({ positionId: p.id, userName: describePosition(p, idx).userName, reason: 'not_in_downline' })
    }
  }
  return { allowed, rejected }
}

export function previewTargets(target, actorUser, idx = buildOrgIndex()) {
  const { allowed, rejected } = resolveTargets(target, actorUser, idx)
  const described = allowed.map((p) => describePosition(p, idx))
  const byNode = {}
  for (const d of described) {
    byNode[d.nodeName] = byNode[d.nodeName] || { nodeName: d.nodeName, nodeId: d.nodeId, people: [] }
    byNode[d.nodeName].people.push({ positionId: d.id, userName: d.userName, tier: d.tier })
  }
  return {
    count: described.length,
    people: described,
    byNode: Object.values(byNode).sort((a, b) => a.nodeName.localeCompare(b.nodeName)),
    rejected,
  }
}
