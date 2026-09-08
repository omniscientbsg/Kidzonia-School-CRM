// One occurrence, as it appears in every list. Clicking opens the detail page.
//
// It reads at 360px: the badges wrap, the meta line wraps, and the actions drop
// under the title rather than squeezing it. Nothing is truncated — a task whose
// title you cannot read is a task nobody does.
import { useNavigate } from 'react-router-dom'
import { Card, Group, Text, Badge } from '@mantine/core'
import { Camera, ShieldCheck, Lock, Repeat } from 'lucide-react'
import { isNotable, priorityTone, priorityLabel, dueLabel, daysLate, statusLabel, statusColor } from '../../services/tasks/status'
import { describeRecurrence } from '../../services/tasks/recurrence'
import Countdown from './Countdown'

const Meta = ({ children }) => <Text component="span" size="xs" c="dimmed">{children}</Text>

export default function TaskCard({ inst, today, showAssignee = false, actions = null }) {
  const navigate = useNavigate()
  const late = daysLate(inst, today)
  // the one place colour carries meaning on this card: late, or mandatory
  const edge = inst.status === 'overdue' ? 'var(--berry)' : inst.isBlocking ? 'var(--marmalade)' : 'transparent'

  return (
    <Card
      withBorder padding="sm" radius="sm" mb="xs"
      style={{ cursor: 'pointer', borderLeft: `3px solid ${edge}` }}
      onClick={() => navigate(`/tasks/instances/${inst.id}`)}
    >
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs" mb={6}>
        <Group gap={7} align="center" wrap="wrap" style={{ flex: 1, minWidth: 0 }}>
          <Text fw={700} size="sm" style={{ fontFamily: 'var(--font-display)' }}>{inst.title}</Text>
          <Badge size="sm" variant="light" color={statusColor(inst)}>{statusLabel(inst)}</Badge>
          {isNotable(inst) && <Badge size="sm" variant="light" color={priorityTone(inst)}>{priorityLabel(inst)}</Badge>}
          {inst.isBlocking && (
            <Badge size="sm" variant="light" color="orange" leftSection={<Lock size={9} />}>blocks logout</Badge>
          )}
        </Group>
        {actions && <Group gap={6} onClick={(e) => e.stopPropagation()}>{actions}</Group>}
      </Group>

      <Group gap="xs" wrap="wrap" align="center">
        <Meta>{dueLabel(inst, today)}{late > 0 ? ` · ${late} day${late > 1 ? 's' : ''} late` : ''}</Meta>
        <Countdown inst={inst} />
        {showAssignee && <Meta>· {inst.assigneeName} ({inst.assigneeTier}) · {inst.nodeName}</Meta>}
        {!showAssignee && inst.assignedByName && <Meta>· from {inst.assignedByName}</Meta>}
        {inst.requiresMedia && (
          <Meta><Camera size={11} style={{ verticalAlign: -1 }} /> {inst.minAttachments} {inst.mediaTypes?.join('/')}</Meta>
        )}
        {inst.requiresApproval && (
          <Meta><ShieldCheck size={11} style={{ verticalAlign: -1 }} /> needs approval</Meta>
        )}
        {inst.recurrence?.freq && inst.recurrence.freq !== 'none' && (
          <Meta><Repeat size={11} style={{ verticalAlign: -1 }} /> {describeRecurrence(inst.recurrence)}</Meta>
        )}
        {inst.categoryName && <Meta>· {inst.categoryName}</Meta>}
        {(inst.tagNames || []).map((t) => (
          <Badge key={t} size="xs" variant="light" color="gray">{t}</Badge>
        ))}
      </Group>

      {inst.rejectionCount > 0 && !inst.submittedAt && inst.status !== 'approved' && inst.lastComment && (
        <Text size="xs" c="berry" mt="xs">Sent back: {inst.lastComment}</Text>
      )}
      {inst.status === 'deferred' && (
        <Text size="xs" c="dimmed" mt="xs">
          Deferred to {inst.deferredTo}{inst.deferReason ? ` — ${inst.deferReason}` : ''}
        </Text>
      )}
    </Card>
  )
}
