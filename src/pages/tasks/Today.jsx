// Where a login lands.
//
// Two questions, answered before anything else: what do I have to do today, and
// what is standing between me and going home. Everything is ordered worst-first
// by the server, so this file does no sorting of its own.
import { useNavigate } from 'react-router-dom'
import {
  Stack, Group, Text, Title, Card, Badge, Alert, Loader, UnstyledButton, Divider,
} from '@mantine/core'
import { AlertTriangle, CheckCircle2, Clock, Inbox, Lock, ChevronRight } from 'lucide-react'
import { useToday } from '../../services/tasks/api'
import { dueLabel, statusColor, statusLabel, isNotable, priorityTone, priorityLabel } from '../../services/tasks/status'
import Countdown from './Countdown'

function Row({ inst, onOpen, first }) {
  return (
    <UnstyledButton onClick={onOpen} w="100%" py={10} style={{ borderTop: first ? 'none' : '1px solid var(--line)' }}>
      <Group gap="sm" wrap="wrap" align="flex-start">
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* at most two badges: is it mandatory, and is it urgent. Everything
              else that used to be a pill is a word on the line below. */}
          <Group gap={7} align="center" wrap="wrap">
            <Text fw={700} size="sm">{inst.title}</Text>
            {inst.isBlocking && (
              <Badge size="sm" variant="light" color="orange" leftSection={<Lock size={9} />}>mandatory</Badge>
            )}
            {isNotable(inst) && (
              <Badge size="sm" variant="light" color={priorityTone(inst)}>{priorityLabel(inst)}</Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed" mt={2}>
            {inst.assignedByName ? `From ${inst.assignedByName} · ` : ''}{dueLabel(inst)}
            {inst.requiresApproval ? ' · needs sign-off' : ''}
          </Text>
        </div>
        <Group gap="xs" wrap="nowrap">
          <Badge size="sm" variant="light" color={statusColor(inst)}>{statusLabel(inst)}</Badge>
          <Countdown inst={inst} />
        </Group>
      </Group>
    </UnstyledButton>
  )
}

function Section({ icon: Icon, title, tone, rows, onOpen, empty }) {
  if (!rows.length) {
    return empty ? (
      <Card withBorder padding="lg"><Text ta="center" c="dimmed">{empty}</Text></Card>
    ) : null
  }
  return (
    <Card withBorder padding="md">
      <Group justify="space-between" mb={4}>
        <Group gap={6}>
          <Icon size={14} style={{ color: tone }} />
          <Text fw={700} size="sm">{title}</Text>
        </Group>
        <Text size="xs" c="dimmed">{rows.length}</Text>
      </Group>
      <Divider mb={2} />
      {rows.map((i, n) => <Row key={i.id} inst={i} first={n === 0} onOpen={() => onOpen(i.id)} />)}
    </Card>
  )
}

export default function Today() {
  const navigate = useNavigate()
  const { data, isLoading, isError, error } = useToday()

  if (isLoading) return <Loader size="sm" />
  if (isError) {
    return (
      <Alert color="berry" variant="light" icon={<AlertTriangle size={17} />}>
        {error?.message || 'Could not load today'}
      </Alert>
    )
  }

  const open = (id) => navigate(`/tasks/instances/${id}`)
  const { signOff } = data
  const nothing = !data.overdue.length && !data.dueToday.length

  return (
    <Stack gap="md">
      <Group justify="space-between" align="baseline" wrap="wrap">
        <Title order={2}>Today</Title>
        <Text size="sm" c="dimmed">{data.today} · {data.doneToday} done today</Text>
      </Group>

      {/* THE one accent block on this page: the only thing here that needs a
          decision. Everything else is a list. */}
      {signOff.count > 0 && (
        <Alert
          variant="light"
          color={signOff.released ? 'teal' : 'marmalade'}
          icon={<AlertTriangle size={16} />}
          title={signOff.released
            ? 'You have been released for today'
            : `${signOff.count} ${signOff.count === 1 ? 'thing' : 'things'} to finish before you sign off`}
        >
          {signOff.released ? (
            <Text size="sm">
              {signOff.release?.by} released you{signOff.release?.reason ? ` — ${signOff.release.reason}` : ''}.
            </Text>
          ) : (
            <Group gap={6} mt={2}>
              {signOff.items.map((i) => (
                <Badge key={i.id} variant="light" color="gray" style={{ cursor: 'pointer' }}
                  onClick={() => open(i.id)}>
                  {i.title}
                </Badge>
              ))}
            </Group>
          )}
        </Alert>
      )}

      <Section icon={AlertTriangle} tone="var(--berry)" title="Left over from before" rows={data.overdue} onOpen={open} />
      <Section icon={Clock} tone="var(--marmalade-deep)" title="On your plate today" rows={data.dueToday} onOpen={open}
        empty={nothing ? 'Nothing due today. Enjoy it.' : null} />
      <Section icon={CheckCircle2} tone="var(--teal)" title="Waiting on someone else" rows={data.waiting} onOpen={open} />
      <Section icon={Clock} tone="var(--ink-faint)" title="Coming up" rows={data.later.slice(0, 5)} onOpen={open} />

      {data.reportsWaiting > 0 && (
        <Card withBorder padding="md" style={{ cursor: 'pointer' }}
          onClick={() => navigate('/tasks/day-end/received')}>
          <Group gap="sm" wrap="nowrap">
            <Inbox size={15} style={{ color: 'var(--teal)' }} />
            <Text fw={700} size="sm" style={{ flex: 1 }}>
              {data.reportsWaiting} day-end report{data.reportsWaiting === 1 ? '' : 's'} from your team
            </Text>
            <Text size="xs" c="dimmed">Read them</Text>
            <ChevronRight size={14} style={{ color: 'var(--ink-faint)' }} />
          </Group>
        </Card>
      )}
    </Stack>
  )
}
