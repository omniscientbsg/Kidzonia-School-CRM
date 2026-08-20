// Who is this task for?
//
// Three dependent steps — where, which role, which people — each narrowing the
// next. The old picker dumped every person in the downline as an identical row
// of chips: unusable past a dozen staff, impossible at a thousand, and with no
// visual difference between a selected name and an unselected one.
//
// STOPPING EARLY IS A REAL CHOICE, not a shortcut. Stop at a role and the task
// belongs to the role — whoever holds it next inherits it, and leavers drop off.
// Go down to names and the list is frozen. The engine has always supported both
// (`node`, `node_level`, `position` in server/tasks/resolve.js); the old form
// buried the difference in a dropdown labelled "Assign to", so nobody could
// have known which one they were choosing.
import { useMemo } from 'react'
import { Select, MultiSelect, Stack, Group, Text, Badge, Alert } from '@mantine/core'
import { Users, Info } from 'lucide-react'
import { useOrgTree, useOrgLevels, useDownline } from '../../services/org/api'
import { flattenTree, NODE_TYPE_LABEL } from '../../services/org/tree'

// what the engine will be told, derived from how far down the person went
export function targetFromPick({ nodeIds, levelId, positionIds }) {
  if (positionIds?.length) {
    return { kind: 'position', positionIds, nodeIds: [], levelId: null, userIds: [], includeSubtree: true }
  }
  if (levelId) {
    return { kind: 'node_level', levelId, nodeIds: nodeIds || [], positionIds: [], userIds: [], includeSubtree: true }
  }
  if (nodeIds?.length) {
    return { kind: 'node', nodeIds, levelId: null, positionIds: [], userIds: [], includeSubtree: true }
  }
  return { kind: 'position', positionIds: [], nodeIds: [], levelId: null, userIds: [], includeSubtree: true }
}

// The sentence that tells someone what they have actually chosen. This is the
// whole point of the component.
export function describePick({ nodeIds, levelId, positionIds }, { nodes, levels, people }) {
  const where = nodeIds?.length
    ? nodeIds.map((id) => nodes.find((n) => n.id === id)?.name).filter(Boolean).join(', ')
    : 'anywhere below you'

  if (positionIds?.length) {
    const names = positionIds.map((id) => people.find((p) => p.id === id)?.userName).filter(Boolean)
    return {
      tone: 'fixed',
      text: names.length
        ? `${names.join(', ')} — these ${names.length === 1 ? 'person' : 'people'}, and nobody else.`
        : 'Pick the people who should get this.',
    }
  }
  if (levelId) {
    const role = levels.find((l) => l.id === levelId)?.name || 'that role'
    return {
      tone: 'role',
      text: `Every ${role} at ${where} — including anyone who joins later, and it stops for anyone who leaves.`,
    }
  }
  if (nodeIds?.length) {
    return { tone: 'role', text: `Everyone at ${where} — including people who join later.` }
  }
  return { tone: 'empty', text: 'Start by choosing where.' }
}

export default function TargetPicker({ value, onChange, preview }) {
  const { nodeIds = [], levelId = null, positionIds = [] } = value
  const { data: tree } = useOrgTree()
  const { data: levels = [] } = useOrgLevels()

  // the people list is fetched NARROWED by what has been chosen, so the browser
  // never holds the whole organisation — /org/downline already takes both
  // filters (getDownline in server/org/tree.js). Narrowing by node only works
  // for a single school; with several picked the role filter still does the
  // heavy lifting and the rest is filtered client-side.
  const { data: allPeople = [], isLoading: peopleLoading } = useDownline({
    nodeId: nodeIds.length === 1 ? nodeIds[0] : undefined,
    levelId: levelId || undefined,
  })
  const people = useMemo(
    () => (nodeIds.length > 1 ? allPeople.filter((p) => nodeIds.includes(p.nodeId)) : allPeople),
    [allPeople, nodeIds],
  )

  const { flat } = useMemo(() => flattenTree(tree?.tree), [tree])
  const nodeOptions = flat.map((n) => ({
    value: n.id,
    label: `${n.name} · ${NODE_TYPE_LABEL[n.type] || n.type}`,
  }))

  // only roles that exist somewhere in the chosen part of the tree
  const roleOptions = useMemo(() => {
    const scope = nodeIds.length ? flat.filter((n) => nodeIds.includes(n.id)) : flat
    return levels
      .filter((l) => scope.some((n) => n.path?.includes(l.scopeNodeId)))
      .sort((a, b) => a.rank - b.rank)
      .map((l) => ({ value: l.id, label: l.name }))
  }, [levels, flat, nodeIds])

  const peopleOptions = people.map((p) => ({
    value: p.id,
    label: `${p.userName} — ${p.tier}${nodeIds.length === 1 ? '' : ` · ${p.nodeName}`}`,
  }))

  const said = describePick({ nodeIds, levelId, positionIds }, { nodes: flat, levels, people })

  return (
    <Stack gap="sm">
      <MultiSelect
        label="Where"
        placeholder="Every school below you"
        data={nodeOptions}
        value={nodeIds}
        searchable
        clearable
        nothingFoundMessage="No school matches that"
        onChange={(v) => onChange({ nodeIds: v, levelId, positionIds: [] })}
      />

      <Select
        label="Which role"
        placeholder="Any role"
        data={roleOptions}
        value={levelId}
        searchable
        clearable
        nothingFoundMessage="No role there"
        onChange={(v) => onChange({ nodeIds, levelId: v, positionIds: [] })}
      />

      <MultiSelect
        label="Which people"
        description="Leave empty to give this to the whole role — new joiners included"
        placeholder={peopleLoading ? 'Loading…' : 'Everyone matching the above'}
        data={peopleOptions}
        value={positionIds}
        searchable
        clearable
        hidePickedOptions
        limit={50}
        maxDropdownHeight={260}
        nothingFoundMessage="Nobody matches"
        onChange={(v) => onChange({ nodeIds, levelId, positionIds: v })}
      />

      <Alert
        variant="light"
        color={said.tone === 'fixed' ? 'sky' : said.tone === 'role' ? 'teal' : 'ink'}
        icon={said.tone === 'fixed' ? <Users size={16} /> : <Info size={16} />}
        p="xs"
      >
        <Text size="sm">{said.text}</Text>
        {preview && (
          <Group gap={6} mt={6}>
            <Badge color={preview.count ? 'teal' : 'ink'} variant="light">
              {preview.count} {preview.count === 1 ? 'person' : 'people'} right now
            </Badge>
            {preview.rejected?.length > 0 && (
              <Badge color="berry" variant="light">
                not yours to assign: {preview.rejected.map((r) => r.userName).join(', ')}
              </Badge>
            )}
          </Group>
        )}
      </Alert>
    </Stack>
  )
}
