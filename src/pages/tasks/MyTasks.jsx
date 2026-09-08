// Everything on this person's plate, grouped by when it is wanted.
//
// Due today / This week / Upcoming / Overdue, plus the two states that are not
// waiting on the assignee at all (submitted, deferred).
//
// Plain headings. Emoji in a section header reads as decoration, and made six
// groups look like six unrelated widgets.
import { useState } from 'react'
import { SimpleGrid, Stack, Group, Text, Card, Button, Alert, Loader, SegmentedControl } from '@mantine/core'
import { Play, Send, Lock, AlertTriangle } from 'lucide-react'
import { useMyTasks, useTaskAct } from '../../services/tasks/api'
import TaskCard from './TaskCard'

const GROUPS = [
  { key: 'overdue', title: 'Late' },
  { key: 'dueToday', title: 'Today' },
  { key: 'thisWeek', title: 'Later this week' },
  { key: 'upcoming', title: 'After that' },
  { key: 'waiting', title: 'Waiting on someone else' },
  { key: 'deferred', title: 'Pushed to another day' },
]

function Actions({ inst, act }) {
  return (
    <>
      {inst.can?.start && (
        <Button size="compact-xs" variant="light" leftSection={<Play size={12} />}
          onClick={() => act.mutate({ path: `/task-instances/${inst.id}/start`, success: 'Started' })}>
          Start
        </Button>
      )}
      {inst.can?.submit && !inst.requiresMedia && (
        <Button size="compact-xs" leftSection={<Send size={12} />}
          onClick={() => act.mutate({
            path: `/task-instances/${inst.id}/submit`,
            success: inst.requiresApproval ? 'Sent for approval' : 'Completed',
          })}>
          {inst.requiresApproval ? 'Submit' : 'Mark done'}
        </Button>
      )}
    </>
  )
}

// A number and what it counts. Not a card each: four bordered boxes across the
// top of a list of bordered cards is four more things to look past.
function Count({ label, value, tone, sub }) {
  return (
    <div>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={700} size="xl" c={tone} style={{ fontFamily: 'var(--font-display)', lineHeight: 1.1 }}>{value}</Text>
      {sub && <Text size="xs" c="dimmed">{sub}</Text>}
    </div>
  )
}

function Section({ title, rows, today, act }) {
  return (
    <div>
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={8} style={{ letterSpacing: 0.4 }}>
        {title} ({rows.length})
      </Text>
      {rows.map((inst) => (
        <TaskCard key={inst.id} inst={inst} today={today} actions={<Actions inst={inst} act={act} />} />
      ))}
    </div>
  )
}

export default function MyTasks() {
  const { data, isLoading, isError, error } = useMyTasks({ poll: 60000 })
  const act = useTaskAct()
  const [view, setView] = useState('list')

  if (isLoading) return <Loader size="sm" />
  if (isError) {
    return (
      <Alert color="berry" variant="light" icon={<AlertTriangle size={17} />}>
        {error?.message || 'Could not load your tasks'}
      </Alert>
    )
  }

  const { today, timezone, doneToday = 0, blockingOpen = 0 } = data || {}
  const groups = GROUPS.map((g) => ({ ...g, rows: data?.[g.key] || [] })).filter((g) => g.rows.length)
  const nothing = !groups.length

  return (
    <Stack gap="md">
      <Card withBorder padding="md">
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="lg">
          <Count label="Overdue" value={data.overdue.length} tone={data.overdue.length ? 'berry' : 'teal'} />
          <Count label="Due today" value={data.dueToday.length} tone="marmalade" sub={timezone} />
          <Count label="This week" value={data.thisWeek.length} tone="sky" sub={`through ${data.weekEnd}`} />
          <Count label="Done today" value={doneToday} tone="teal" />
        </SimpleGrid>
      </Card>

      {blockingOpen > 0 && (
        <Alert color="marmalade" variant="light" icon={<Lock size={16} />} p="xs">
          <Text size="sm">
            <b>{blockingOpen} mandatory task{blockingOpen > 1 ? 's' : ''}</b> must be finished before
            you can log out today.
          </Text>
        </Alert>
      )}

      <Group justify="flex-end">
        <SegmentedControl
          size="xs" value={view} onChange={setView}
          data={[{ label: 'List', value: 'list' }, { label: 'Board', value: 'board' }]}
        />
      </Group>

      {nothing && (
        <Card withBorder padding="lg">
          <Text ta="center" c="dimmed">Nothing assigned to you right now.</Text>
        </Card>
      )}

      {view === 'list' ? (
        <Stack gap="lg">
          {groups.map((g) => <Section key={g.key} title={g.title} rows={g.rows} today={today} act={act} />)}
        </Stack>
      ) : (
        // one column on a phone, as many as fit on a desk
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" style={{ alignItems: 'start' }}>
          {groups.map((g) => <Section key={g.key} title={g.title} rows={g.rows} today={today} act={act} />)}
        </SimpleGrid>
      )}
    </Stack>
  )
}
