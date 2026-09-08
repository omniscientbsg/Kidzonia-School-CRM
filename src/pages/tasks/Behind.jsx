// Finish before today.
//
// Mandatory work left over from a strictly EARLIER day. This is the only screen
// in the module that should ever be red, and its tab is hidden entirely when the
// list is empty — a permanently visible empty warning trains people to stop
// reading it.
//
// Note this is `armed`, not `blocked`. Blocked is the wider "holds your sign-off
// tonight" list, which includes work due today and is shown in the Today banner.
// Armed is the subset from an earlier day, and it is the one that has already
// frozen this person's writes everywhere else in the app. Two different lists.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Stack, Group, Text, Card, Button, Alert, Loader, Badge, Textarea, Modal } from '@mantine/core'
import { AlertTriangle, Lock, CheckCircle2, HandHelping } from 'lucide-react'
import { useLogoutCheck, useTaskAct } from '../../services/tasks/api'
import { dueLabel, statusLabel, statusColor } from '../../services/tasks/status'

export default function Behind() {
  const navigate = useNavigate()
  const { data: gate, isLoading } = useLogoutCheck()
  const act = useTaskAct()
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')

  if (isLoading) return <Loader />

  const rows = gate?.staleInstances || []

  if (!rows.length) {
    return (
      <Card withBorder padding="lg">
        <Group gap="sm" justify="center">
          <CheckCircle2 size={18} style={{ color: 'var(--mantine-color-teal-6)' }} />
          <Text>Nothing is left over. Anything due today is on <b>Today</b>.</Text>
        </Group>
      </Card>
    )
  }

  return (
    <Stack gap="md">
      <Alert color="berry" variant="light" icon={<AlertTriangle size={17} />}
        title={`${rows.length} mandatory ${rows.length === 1 ? 'task' : 'tasks'} from an earlier day`}>
        <Text size="sm">
          Until these are done you cannot save anything anywhere else in the app — attendance, fees,
          the diary. Finishing any of them unlocks it straight away. If something has genuinely made
          them impossible, ask your manager to release you.
        </Text>
      </Alert>

      {gate?.released && (
        <Alert color="teal" variant="light" icon={<HandHelping size={16} />}>
          <Text size="sm">
            {gate.release?.by} released you for today{gate.release?.reason ? ` — ${gate.release.reason}` : ''}.
            The work stays on your list for tomorrow.
          </Text>
        </Alert>
      )}

      {rows.map((i) => (
        <Card withBorder padding="md" key={i.id} style={{ borderLeft: '3px solid var(--berry)' }}>
          <Group align="flex-start" wrap="nowrap">
            <div style={{ flex: 1 }}>
              <Group gap="xs">
                <Text fw={700}>{i.title}</Text>
                <Badge color="marmalade" variant="light" leftSection={<Lock size={10} />}>mandatory</Badge>
                <Badge color={statusColor(i) === 'red' ? 'berry' : 'ink'} variant="light">{statusLabel(i)}</Badge>
                {i.rejectionCount > 0 && <Badge color="berry" variant="light">sent back</Badge>}
              </Group>
              <Text size="sm" c="dimmed" mt={2}>
                For {i.serviceDate} · {dueLabel(i)}
                {i.assignedByName ? ` · from ${i.assignedByName}` : ''}
                {i.requiresApproval ? ' · needs sign-off' : ''}
              </Text>
            </div>
            <Button size="xs" onClick={() => navigate(`/tasks/instances/${i.id}`)}>Open</Button>
          </Group>
        </Card>
      ))}

      <Group>
        <Button variant="default" leftSection={<HandHelping size={15} />} onClick={() => setAsking(true)}>
          Ask to be released
        </Button>
      </Group>

      <Modal opened={asking} onClose={() => setAsking(false)} title="Ask to be released for today">
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Everyone above you is told. The tasks stay on your list — this only lifts the lock for
            today, and it is recorded against whoever releases you.
          </Text>
          <Textarea label="What has come up?" required autoFocus
            placeholder="e.g. Sent home unwell; I will pick these up in the morning"
            value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setAsking(false)}>Cancel</Button>
            <Button disabled={!reason.trim()} loading={act.isPending}
              onClick={() => act.mutate(
                { path: '/tasks/gate/request-release', body: { reason }, success: 'Your managers have been told' },
                { onSuccess: () => { setAsking(false); setReason('') } },
              )}>
              Send
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
