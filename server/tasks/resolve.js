// Turn an assignment target into concrete positions — and refuse anything that
// is not in the actor's downline. Resolution runs at CREATE time (to validate)
// and again at GENERATE time (so staff who joined later pick the task up).
//
// ONE SHAPE, not five kinds. The old model picked a single `kind` by precedence —
// named people beat roles beat nodes — so the three selects in the form could
// never genuinely combine, and "every Teacher at Jubilee Hills plus Priya from
// HQ, except Renu" was not expressible at all.
import { buildOrgIndex, positionsOfUser, canManagePosition, subtreeNodeIds, describePosition } from '../org/tree.js'

// One tier or several. Old targets stored a single `levelId`; new ones store
// `levelIds`. Everything downstream reads through here.
export function targetLevelIds(spec) {
  if (spec?.levelIds?.length) return spec.levelIds
  return spec?.levelId ? [spec.levelId] : []
}

// What `kind` used to encode, made explicit: whether the list is recomputed on
// every generation run or frozen at the moment it was saved.
//   position / user  were frozen
//   node / node_level / downline  were recomputed
// So the default is "frozen when people are named, live otherwise", which is
// exactly today's behaviour and changes nothing for an existing task.
export const defaultFollowJoiners = (spec) =>
  !((spec?.positionIds?.length || 0) + (spec?.userIds?.length || 0))

// `kind` survives as a DERIVED, display-only field so AssignedByMe and the audit
// log keep reading something sensible. Nothing resolves off it any more.
export function deriveKind(spec) {
  if (spec.positionIds?.length || spec.userIds?.length) return 'position'
  if (spec.levelIds?.length) return 'node_level'
  if (spec.nodeIds?.length) return 'node'
  return 'downline'
}

const EMPTY = {
  nodeIds: [], levelIds: [], positionIds: [], userIds: [], excludePositionIds: [],
  includeSubtree: true, followJoiners: true,
}

// READ-TIME SHIM, one release. `followJoiners` is the genuinely new field, so a
// stored target without it predates _tasksV10 and is read through its `kind`.
// Same pattern as targetLevelIds() above: pure, never writes, so a row the
// migration missed still resolves and still converts the next time it is saved.
export function targetSpec(target) {
  const t = target || {}
  if (t.followJoiners !== undefined) {
    return { ...EMPTY, ...t, levelIds: targetLevelIds(t) }
  }
  const levelIds = targetLevelIds(t)
  const base = { ...EMPTY, includeSubtree: t.includeSubtree !== false }
  switch (t.kind) {
    case 'position':
      return { ...base, positionIds: t.positionIds || [], followJoiners: false }
    case 'user':
      return { ...base, userIds: t.userIds || [], followJoiners: false }
    case 'node':
      return { ...base, nodeIds: t.nodeIds || [] }
    case 'node_level':
      return { ...base, nodeIds: t.nodeIds || [], levelIds }
    case 'downline':
      return base
    default: {
      // No kind and no followJoiners: the new shape, sent by a caller that did
      // not bother to say whether the list is live. Read the lists and derive
      // the answer rather than assuming — assuming `true` would quietly make a
      // named list of people behave like a role.
      const flat = {
        ...base,
        nodeIds: t.nodeIds || [], levelIds,
        positionIds: t.positionIds || [], userIds: t.userIds || [],
        excludePositionIds: t.excludePositionIds || [],
      }
      return { ...flat, followJoiners: defaultFollowJoiners(flat) }
    }
  }
}

// -> { allowed: [position], rejected: [{ positionId, userName, reason }] }
export function resolveTargets(target, actorUser, idx = buildOrgIndex()) {
  const mine = positionsOfUser(actorUser, idx)
  const spec = targetSpec(target)

  // NAMED PEOPLE WIN. Naming somebody is an instruction, not a filter: if the
  // form let you pick three people it must not then also sweep in a whole tier.
  const named = [
    ...(spec.positionIds || []).map((id) => idx.positionById.get(id)).filter(Boolean),
    ...(spec.userIds || []).flatMap((id) => idx.positionsByUser.get(id) || []),
  ]

  let candidates
  if (named.length) {
    candidates = named
  } else {
    // no nodes named means "anywhere below me", which is what node_level already
    // did when no nodes were given. Keep that.
    const scope = spec.nodeIds?.length ? spec.nodeIds : mine.map((p) => p.nodeId)
    const ids = new Set(scope.flatMap((n) => (spec.includeSubtree === false ? [n] : subtreeNodeIds(n, idx))))
    const levels = new Set(spec.levelIds || [])
    candidates = idx.positions.filter((p) => ids.has(p.nodeId) && (!levels.size || levels.has(p.levelId)))
  }

  // Exclusions are subtracted from whatever matched, however it matched — the
  // whole point of them is "that tier, except her".
  const excluded = new Set(spec.excludePositionIds || [])

  const seen = new Set()
  const unique = candidates
    .filter((p) => !excluded.has(p.id))
    // somebody who has left stops matching, whatever shape named them — done
    // here rather than per-branch so it cannot be forgotten in one of them
    .filter((p) => p.status !== 'left')
    .filter((p) => (seen.has(p.id) ? false : seen.add(p.id)))

  const allowed = []
  const rejected = []
  for (const p of unique) {
    if (mine.some((m) => canManagePosition(m, p, idx))) allowed.push(p)
    else if (named.length) {
      // an explicit pick that is out of reach is an error the assigner must see;
      // a broad match (a whole node / tier) simply skips peers and superiors
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
