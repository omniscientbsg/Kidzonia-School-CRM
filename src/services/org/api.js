// Data layer for the org tree. Every component talks to the org API through
// here, so swapping the transport (or pointing at a different backend) is a
// one-file change.
import { useGet, useAct } from '../../api/hooks'

export const orgPaths = {
  tree: '/org/tree',
  me: '/org/me',
  nodes: '/org/nodes',
  levels: '/org/levels',
  positions: '/org/positions',
  downline: '/org/downline',
  ancestors: '/org/ancestors',
  unplaced: '/org/unplaced-staff',
  importPositions: '/org/positions/import',
}

export function useOrgTree(opts) {
  return useGet(orgPaths.tree, opts)
}

export function useOrgMe(opts) {
  return useGet(orgPaths.me, opts)
}

export function useOrgLevels(usableAt) {
  return useGet(usableAt ? `${orgPaths.levels}?usableAt=${usableAt}` : orgPaths.levels)
}

export function useOrgPositions(query = '') {
  return useGet(query ? `${orgPaths.positions}?${query}` : orgPaths.positions)
}

// Everyone the signed-in user may assign work to.
export function useDownline({ nodeId, levelId, userId } = {}) {
  const qs = new URLSearchParams()
  if (nodeId) qs.set('nodeId', nodeId)
  if (levelId) qs.set('levelId', levelId)
  if (userId) qs.set('userId', userId)
  const suffix = qs.toString()
  return useGet(suffix ? `${orgPaths.downline}?${suffix}` : orgPaths.downline)
}

// The reporting line above someone, nearest boss first.
export function useAncestors(userId) {
  return useGet(userId ? `${orgPaths.ancestors}?userId=${userId}` : orgPaths.ancestors)
}

// Staff who exist in the user master but hold no position — they are invisible
// to Tasks until someone places them.
export function useUnplacedStaff() {
  return useGet(orgPaths.unplaced)
}

// One mutation hook for the whole module: invalidates every /org query plus
// tasks, whose target resolution depends on the tree.
export function useOrgAct() {
  return useAct(['/org', '/tasks', '/task-instances'])
}
