// My team — the tasks I have handed out, and how they are going.
//
// A list, not a table. One line per task that answers "what, for whom, how
// often, how is it going" at a glance; everything else waits until you open it.
// The old five-column table spent most of its width on empty cells and kept
// four unlabelled icon buttons permanently in view.
import { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import {
  Stack, Group, Text, Card, Badge, Button, Modal, Checkbox, Alert, Loader,
  Progress, UnstyledButton,
} from '@mantine/core'
import { Pencil, Pause, Play, Ban, RefreshCw, ChevronDown, ChevronRight, Lock, AlertTriangle } from 'lucide-react'
import { useTasks, useInstances, useTaskProgress, useTaskAct } from '../../services/tasks/api'
import { useOrgLevels } from '../../services/org/api'
import { describeRecurrence } from '../../services/tasks/recurrence'
import { STATUS_LABEL, STATUS_COLOR } from '../../services/tasks/status'
import TaskCard from './TaskCard'

// "Every Teacher", "4 people", "Everyone at Jubilee Hills" — what a person would
// say out loud, not the name of the targeting mode.
function whoFor(task, levels) {
  const t = task.target || {}
  const except = t.excludePositionIds?.length
    ? `, except ${t.excludePositionIds.length} ${t.excludePositionIds.length === 1 ? 'person' : 'people'}`
    : ''

  // Named people win, whatever else the target also carries — the same rule the
  // resolver applies.
  const named = (t.positionIds?.length || 0) + (t.userIds?.length || 0)
  if (named) return named === 1 ? '1 person' : `${named} people`

  // levelIds is the current shape; levelId is what tasks saved before multi-role
  // targeting carry. Reading only the first made "every Teacher AND Day Care
  // Staff" read as "Every Teacher".
  const ids = t.levelIds?.length ? t.levelIds : [t.levelId].filter(Boolean)
  if (ids.length) {
    const names = ids.map((id) => levels.find((l) => l.id === id)?.name).filter(Boolean)
    if (!names.length) return `Everyone at that tier${except}`
    const roles = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    return `Every ${roles}${except}`
  }
  if (t.nodeIds?.length) return `Everyone at ${t.nodeIds.length === 1 ? 'that school' : `${t.nodeIds.length} schools`}${except}`
  return `Everyone below me${except}`
}

const barColor = (pct) => (pct >= 80 ? 'teal' : pct >= 50 ? 'marmalade' : 'berry')

// Opened: who has done it, who has not. The one question this page exists for.
function Detail({ task, onEdit, onPause, onCancel, onGenerate, busy }) {
  const { data, isLoading } = useTaskProgress(task.id)
  const { data: rows = [] } = useInstances({ taskId: task.id })
  const [showOccurrences, setShowOccurrences] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const recent = rows.filter((r) => r.serviceDate <= today).slice(-12)

  return (
    <Stack gap="sm" pl={26} pt={4} pb={6}>
      {task.description && <Text size="sm" c="dimmed">{task.description}</Text>}
      <Text size="xs" c="dimmed">{task.conditionSummary}</Text>

      {isLoading ? <Loader size="xs" /> : !data?.people?.length ? (
        <Text size="xs" c="dimmed">Nothing has been generated for this yet.</Text>
      ) : (
        <Stack gap={0}>
          {data.people.map((p) => (
            <Group key={p.positionId} gap="sm" align="center" wrap="wrap"
              py={7} style={{ borderTop: '1px solid var(--line)' }}>
              <div style={{ minWidth: 150 }}>
                <Text fw={700} size="sm">{p.userName}</Text>
                <Text size="xs" c="dimmed">{p.tier}</Text>
              </div>
              <Progress value={p.pct} color={barColor(p.pct)} w={84} size="sm" radius="xl" />
              <Text size="xs" style={{ minWidth: 44 }}>{p.done}/{p.total}</Text>
              {p.overdue > 0 && <Badge size="sm" variant="light" color="berry">{p.overdue} late</Badge>}
              <div style={{ flex: 1 }} />
              <Badge size="sm" variant="light" color={STATUS_COLOR[p.latestStatus]}>{STATUS_LABEL[p.latestStatus]}</Badge>
              <Text size="xs" c="dimmed">{p.latestServiceDate}</Text>
            </Group>
          ))}
        </Stack>
      )}

      <Group gap={6} wrap="wrap">
        {task.status !== 'cancelled' && (
          <>
            <Button size="compact-xs" variant="subtle" leftSection={<Pencil size={12} />} onClick={onEdit}>Edit</Button>
            <Button size="compact-xs" variant="subtle" onClick={onPause}
              leftSection={task.status === 'paused' ? <Play size={12} /> : <Pause size={12} />}>
              {task.status === 'paused' ? 'Resume' : 'Pause'}
            </Button>
            <Button size="compact-xs" variant="subtle" leftSection={<RefreshCw size={12} />}
              loading={busy} onClick={onGenerate}>Catch up</Button>
            <Button size="compact-xs" variant="subtle" color="berry" leftSection={<Ban size={12} />}
              onClick={onCancel}>Cancel</Button>
          </>
        )}
        {recent.length > 0 && (
          <Button size="compact-xs" variant="subtle" color="ink"
            onClick={() => setShowOccurrences(!showOccurrences)}>
            {showOccurrences ? 'Hide' : 'Show'} the last {recent.length} days
          </Button>
        )}
      </Group>

      {showOccurrences && (
        <div>
          {recent.map((inst) => <TaskCard key={inst.id} inst={inst} today={today} showAssignee />)}
        </div>
      )}
    </Stack>
  )
}

export default function AssignedByMe() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const { data: tasks = [], isLoading, isError, error } = useTasks()
  const { data: levels = [] } = useOrgLevels()
  const act = useTaskAct()
  const [open, setOpen] = useState(state?.openTaskId || null)
  const [confirm, setConfirm] = useState(null)
  const [showCancelled, setShowCancelled] = useState(false)

  if (isLoading) return <Loader size="sm" />
  if (isError) {
    return (
      <Alert color="berry" variant="light" icon={<AlertTriangle size={17} />}>
        {error?.message || 'Could not load tasks'}
      </Alert>
    )
  }

  const rows = tasks.filter((t) => showCancelled || t.status !== 'cancelled')
  if (!rows.length) {
    return (
      <Card withBorder padding="lg">
        <Stack gap="sm" align="center">
          <Text c="dimmed">You have not assigned anything yet.</Text>
          <Button onClick={() => navigate('/tasks/new')}>Assign your first task</Button>
        </Stack>
      </Card>
    )
  }

  return (
    <Stack gap="md">
      <Group gap="xs" wrap="wrap">
        <Button component={Link} to="/tasks/blocked" size="compact-xs" variant="subtle">Who is stuck</Button>
        <Button component={Link} to="/tasks/day-end/received" size="compact-xs" variant="subtle">Day-end reports</Button>
        <div style={{ flex: 1 }} />
        <Checkbox size="xs" label="Show cancelled" checked={showCancelled}
          onChange={(e) => setShowCancelled(e.currentTarget.checked)} />
      </Group>

      <Card withBorder padding={0}>
        {rows.map((task, i) => {
          const isOpen = open === task.id
          const Chevron = isOpen ? ChevronDown : ChevronRight
          return (
            <div key={task.id} style={{ borderTop: i ? '1px solid var(--line)' : 'none', padding: '12px 16px' }}>
              <UnstyledButton w="100%" onClick={() => setOpen(isOpen ? null : task.id)}>
                <Group gap="sm" align="center" wrap="nowrap">
                  <Chevron size={15} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Group gap={7} align="center" wrap="wrap">
                      <Text fw={700} size="sm">{task.title}</Text>
                      {task.isBlocking && (
                        <Badge size="sm" variant="light" color="orange" leftSection={<Lock size={9} />}>mandatory</Badge>
                      )}
                      {task.status === 'paused' && <Badge size="sm" variant="light" color="yellow">paused</Badge>}
                      {task.status === 'cancelled' && <Badge size="sm" variant="light" color="gray">cancelled</Badge>}
                    </Group>
                    <Text size="xs" c="dimmed" mt={2}>
                      {whoFor(task, levels)} · {describeRecurrence(task.recurrence)}
                      {task.requiresApproval && ' · needs sign-off'}
                      {task.requiresMedia && ` · ${task.minAttachments} photo${task.minAttachments > 1 ? 's' : ''}`}
                    </Text>
                  </div>
                  {!isOpen && task.progress?.total > 0 && (
                    <Group gap="xs" align="center" style={{ flexShrink: 0 }}>
                      {task.progress.overdue > 0 && (
                        <Badge size="sm" variant="light" color="berry">{task.progress.overdue} late</Badge>
                      )}
                      <Progress value={task.progress.pct} color={barColor(task.progress.pct)} w={84} size="sm" radius="xl" />
                      <Text size="xs" style={{ minWidth: 34, textAlign: 'right' }}>{task.progress.pct}%</Text>
                    </Group>
                  )}
                </Group>
              </UnstyledButton>

              {isOpen && (
                <Detail
                  task={task} busy={act.isPending}
                  onEdit={() => navigate(`/tasks/${task.id}/edit`)}
                  onPause={() => act.mutate({ path: `/tasks/${task.id}/pause`, success: task.status === 'paused' ? 'Resumed' : 'Paused' })}
                  onCancel={() => setConfirm(task)}
                  onGenerate={() => act.mutate({ path: '/tasks/generate', body: { taskId: task.id }, success: 'Up to date' })}
                />
              )}
            </div>
          )
        })}
      </Card>

      {confirm && (
        <Modal opened onClose={() => setConfirm(null)} title={`Cancel “${confirm.title}”?`}>
          <Stack gap="md">
            <Text size="sm">Anything unfinished is cancelled too. Work already done is kept.</Text>
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => setConfirm(null)}>Keep it</Button>
              <Button color="berry" loading={act.isPending} onClick={() => act.mutate(
                { path: `/tasks/${confirm.id}/cancel`, body: { reason: 'Cancelled by assigner' }, success: 'Task cancelled' },
                { onSuccess: () => setConfirm(null), onError: () => setConfirm(null) },
              )}>
                Cancel task
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  )
}
