// Who is this task for?
//
// Three dependent steps — where, which roles, which people — each narrowing the
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
//
// Roles come from GET /org/downline/roles, which lists the roles that actually
// HAVE people in the chosen part of the tree. Listing every defined level was
// the reason the people list came back empty: levels are scoped at HQ, so a
// school offered "Managing Director" as a choice and picking it matched nobody.
import { useMemo } from 'react'
import { MultiSelect, Stack, Group, Text, Badge, Alert, Button, Loader } from '@mantine/core'
import { Users, Info, CheckCheck, X } from 'lucide-react'
import { useOrgTree, useDownline, useDownlineRoles } from '../../services/org/api'
import { flattenTree, NODE_TYPE_LABEL } from '../../services/org/tree'

// What the engine is told. The three lists now travel together instead of one
// winning by precedence, so "every Teacher at Jubilee Hills, except Renu" is one
// target rather than something the form could not say.
export function targetFromPick({ nodeIds = [], levelIds = [], positionIds = [], excludePositionIds = [], followJoiners }) {
  return {
    nodeIds, levelIds, positionIds, userIds: [],
    excludePositionIds,
    includeSubtree: true,
    // naming people freezes the list; a role stays live. The server derives the
    // same default, this is just so the read-back can say which.
    followJoiners: followJoiners ?? !positionIds.length,
  }
}

const listOf = (arr) =>
  arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`

// The sentence that tells someone what they have actually chosen. This is the
// whole point of the component.
export function describePick(pick, { nodes, levels, people }) {
  const { nodeIds = [], levelIds = [], positionIds = [], excludePositionIds = [] } = pick
  const where = nodeIds.length
    ? listOf(nodeIds.map((id) => nodes.find((n) => n.id === id)?.name).filter(Boolean))
    : 'anywhere below you'
  const nameOf = (id) => people.find((p) => p.id === id)?.userName
  const except = excludePositionIds.map(nameOf).filter(Boolean)
  const exceptClause = except.length ? `, except ${listOf(except)}` : ''

  if (positionIds.length) {
    const names = positionIds.map(nameOf).filter(Boolean)
    return {
      tone: 'fixed',
      text: names.length
        ? `${listOf(names)} — these ${names.length === 1 ? 'person' : 'people'}, and nobody else.`
        : 'Pick the people who should get this.',
    }
  }
  if (levelIds.length) {
    const named = levelIds.map((id) => levels.find((l) => l.levelId === id || l.id === id)?.name).filter(Boolean)
    const roles = named.length ? listOf(named) : 'that role'
    return {
      tone: 'role',
      text: `Every ${roles} at ${where}${exceptClause} — including anyone who joins later, and it stops for anyone who leaves.`,
    }
  }
  if (nodeIds.length) {
    return { tone: 'role', text: `Everyone at ${where}${exceptClause} — including people who join later.` }
  }
  return { tone: 'empty', text: 'Start by choosing where.' }
}

export default function TargetPicker({ value, onChange, preview }) {
  const { nodeIds = [], levelIds = [], positionIds = [], excludePositionIds = [] } = value
  const { data: tree } = useOrgTree()

  // Both lists are fetched NARROWED by what has been chosen, so the browser
  // never holds the whole organisation. /org/downline takes both filters and
  // reads several ids from each (downlinePositions in server/org/tree.js).
  const { data: roles = [], isLoading: rolesLoading } = useDownlineRoles({ nodeId: nodeIds })
  const { data: people = [], isLoading: peopleLoading } = useDownline({
    nodeId: nodeIds,
    levelId: levelIds,
  })

  const { flat } = useMemo(() => flattenTree(tree?.tree), [tree])
  const nodeOptions = flat.map((n) => ({
    value: n.id,
    label: `${n.name} · ${NODE_TYPE_LABEL[n.type] || n.type}`,
  }))

  const roleOptions = roles
    .filter((r) => r.levelId)
    .map((r) => ({ value: r.levelId, label: `${r.name} (${r.count})` }))

  const peopleOptions = people.map((p) => ({
    value: p.id,
    label: `${p.userName} — ${p.tier}${nodeIds.length === 1 ? '' : ` · ${p.nodeName}`}`,
  }))

  // Everyone the filters match, so exclusions can be picked from them by name
  // rather than from the whole organisation.
  const matched = preview?.people || []
  const excludeOptions = matched.map((p) => ({
    value: p.id,
    label: `${p.userName} — ${p.tier}${nodeIds.length === 1 ? '' : ` · ${p.nodeName}`}`,
  }))

  const said = describePick({ nodeIds, levelIds, positionIds, excludePositionIds }, { nodes: flat, levels: roles, people })
  const allPicked = people.length > 0 && positionIds.length === people.length

  return (
    <Stack gap="sm">
      <MultiSelect
        label="Where"
        placeholder="Everywhere below you"
        data={nodeOptions}
        value={nodeIds}
        searchable
        clearable
        nothingFoundMessage="No school matches that"
        // The three lists are independent now, so changing the place no longer
        // wipes what was chosen below it. Exclusions are cleared, because an
        // exclusion only means anything relative to what it is subtracted from.
        onChange={(v) => onChange({ ...value, nodeIds: v, excludePositionIds: [] })}
      />

      <MultiSelect
        label="Which roles"
        description="Only roles that have people where you chose"
        placeholder={rolesLoading ? 'Loading…' : 'Any role'}
        data={roleOptions}
        value={levelIds}
        searchable
        clearable
        rightSection={rolesLoading ? <Loader size={14} /> : undefined}
        nothingFoundMessage="No role there"
        onChange={(v) => onChange({ ...value, levelIds: v, excludePositionIds: [] })}
      />

      <div>
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
          rightSection={peopleLoading ? <Loader size={14} /> : undefined}
          nothingFoundMessage="Nobody matches"
          onChange={(v) => onChange({ ...value, positionIds: v })}
        />
        {people.length > 1 && (
          <Group gap={6} mt={6}>
            <Button
              size="compact-xs" variant="subtle" leftSection={<CheckCheck size={13} />}
              disabled={allPicked}
              onClick={() => onChange({ ...value, positionIds: people.map((p) => p.id) })}
            >
              Name all {people.length}
            </Button>
            {positionIds.length > 0 && (
              <Button
                size="compact-xs" variant="subtle" color="ink" leftSection={<X size={13} />}
                onClick={() => onChange({ ...value, positionIds: [] })}
              >
                Clear names
              </Button>
            )}
          </Group>
        )}
      </div>

      {!positionIds.length && matched.length > 1 && (
        <MultiSelect
          label="Except"
          description="Everyone above gets it apart from these — the exception you would otherwise have to make by naming everybody individually"
          placeholder="Nobody"
          data={excludeOptions}
          value={excludePositionIds}
          searchable
          clearable
          hidePickedOptions
          limit={50}
          maxDropdownHeight={220}
          nothingFoundMessage="Nobody matches"
          onChange={(v) => onChange({ ...value, excludePositionIds: v })}
        />
      )}

      <Alert
        variant="light"
        color={said.tone === 'fixed' ? 'sky' : said.tone === 'role' ? 'teal' : 'ink'}
        icon={said.tone === 'fixed' ? <Users size={16} /> : <Info size={16} />}
        p="xs"
      >
        <Text size="sm">{said.text}</Text>
        {allPicked && (
          <Text size="xs" c="dimmed" mt={4}>
            That is everyone in the role right now. Clear the names instead if you want joiners to be
            included automatically.
          </Text>
        )}
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
