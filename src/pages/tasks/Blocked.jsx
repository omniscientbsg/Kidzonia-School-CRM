// The safety valve, made discoverable. Anyone with people below them can see
// who is held at the door and let them go — always with a reason, always audited.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Stack, Group, Text, Card, Badge, Button, Modal, Textarea, Alert, Loader, Anchor,
} from '@mantine/core'
import { Unlock, CalendarClock, Lock, AlertTriangle } from 'lucide-react'
import { useBlockedUsers, useTaskAct } from '../../services/tasks/api'
import { dueLabel } from '../../services/tasks/status'

export default function Blocked() {
  const { data: rows = [], isLoading, isError, error } = useBlockedUsers()
  const act = useTaskAct()
  const [modal, setModal] = useState(null)
  const [reason, setReason] = useState('')

  if (isLoading) return <Loader size="sm" />
  if (isError) {
    return (
      <Alert color="berry" variant="light" icon={<AlertTriangle size={17} />}>
        {error?.message || 'Could not load'}
      </Alert>
    )
  }
  if (!rows.length) {
    return (
      <Card withBorder padding="lg">
        <Text ta="center" c="dimmed">Nobody below you is held up by a mandatory task.</Text>
      </Card>
    )
  }

  const close = () => { setModal(null); setReason('') }

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed" maw={720}>
        These people cannot sign off until their mandatory work is done. You can release someone for
        today — the task stays on their list for tomorrow — or defer the task itself from its page.
        Both are recorded against your name.
      </Text>

      {rows.map((r) => (
        <Card withBorder padding="md" key={r.userId}>
          <Group justify="space-between" align="flex-start" wrap="wrap" mb="xs">
            <Group gap="xs" align="center" wrap="wrap">
              <Text fw={700} style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>{r.userName}</Text>
              <Text size="sm" c="dimmed">{r.tier} · {r.nodeName}</Text>
              {r.released
                ? <Badge size="sm" variant="light" color="teal">released today</Badge>
                : r.armed
                  ? <Badge size="sm" variant="light" color="berry" leftSection={<Lock size={10} />}>writes frozen</Badge>
                  : <Badge size="sm" variant="light" color="yellow">logout blocked</Badge>}
            </Group>
            {!r.released && (
              <Button size="compact-xs" variant="light" leftSection={<Unlock size={12} />}
                onClick={() => setModal({ userId: r.userId, name: r.userName, count: r.instances.length })}>
                Release for today
              </Button>
            )}
          </Group>

          {r.released && (
            <Text size="sm" c="dimmed" mb="xs">Released by {r.release.by} — {r.release.reason}</Text>
          )}

          <Stack gap={4}>
            {r.instances.map((i) => (
              <Group key={i.id} gap="xs" align="center" wrap="wrap">
                <CalendarClock size={12} style={{ color: 'var(--ink-faint)' }} />
                <Anchor component={Link} to={`/tasks/instances/${i.id}`} size="sm">{i.title}</Anchor>
                <Text size="xs" c="dimmed">{dueLabel(i)}</Text>
                {i.rejectionCount > 0 && <Badge size="sm" variant="light" color="berry">sent back</Badge>}
                {i.requiresApproval && <Badge size="sm" variant="light" color="yellow">needs sign-off</Badge>}
              </Group>
            ))}
          </Stack>
        </Card>
      ))}

      {modal && (
        <Modal opened onClose={close} title={`Release ${modal.name} for today`}>
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {modal.count} mandatory task{modal.count > 1 ? 's' : ''} stay{modal.count > 1 ? '' : 's'} on
              their list — this only lifts the sign-off lock for today, and they are told who released them.
            </Text>
            <Textarea
              label="Reason" required autosize minRows={3} data-autofocus
              placeholder="e.g. Sent home unwell; will pick this up tomorrow"
              value={reason} onChange={(e) => setReason(e.currentTarget.value)}
            />
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={close}>Cancel</Button>
              <Button
                leftSection={<Unlock size={13} />}
                disabled={!reason.trim()} loading={act.isPending}
                onClick={() => act.mutate(
                  { path: '/tasks/gate/release', body: { userId: modal.userId, reason }, success: `${modal.name} can sign off` },
                  { onSuccess: close },
                )}
              >
                Release
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  )
}
