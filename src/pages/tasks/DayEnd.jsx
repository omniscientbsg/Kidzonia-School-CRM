// Writing the Day-End report, and reading the ones your team sent you.
//
// The summary is rolled up by the server and shown read-only: the point is that
// nobody types their own numbers. What the person adds is the answers to their
// own school's form — one hardcoded "anything to flag?" box until day-end forms
// existed, and the same question for a teacher and a bus driver.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Stack, Group, Text, Title, Card, Badge, Button, TextInput, Alert, Loader, SimpleGrid,
} from '@mantine/core'
import { Sunset, CheckCircle2, Clock, AlertTriangle, Inbox, Check } from 'lucide-react'
import { fmtDateTime } from '../../api/hooks'
import { useDayEndPreview, useDayEndReceived, useTaskAct } from '../../services/tasks/api'
import QuestionFields, { unanswered } from './QuestionFields'

function Counts({ counts }) {
  const cells = [
    ['Completed', counts.completed, 'teal', CheckCircle2],
    ['Still open', counts.pending, 'yellow', Clock],
    ['Overdue', counts.overdue, 'berry', AlertTriangle],
    ['Awaiting sign-off', counts.awaitingApproval, 'plum', Clock],
  ]
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="lg" mb="sm">
      {cells.map(([label, value, tone, Icon]) => (
        <div key={label}>
          <Group gap={4} align="center">
            <Icon size={11} style={{ color: 'var(--ink-faint)' }} />
            <Text size="xs" c="dimmed">{label}</Text>
          </Group>
          <Group gap={6} align="baseline">
            <Text fw={700} size="xl" style={{ fontFamily: 'var(--font-display)', lineHeight: 1.1 }}>{value}</Text>
            {value > 0 && tone === 'berry' && <Badge size="sm" variant="light" color="berry">chase</Badge>}
          </Group>
        </div>
      ))}
    </SimpleGrid>
  )
}

function TaskList({ title, rows }) {
  if (!rows?.length) return null
  return (
    <div style={{ marginBottom: 10 }}>
      <Text size="xs" c="dimmed" mb={4}>{title}</Text>
      {rows.map((r) => (
        <Text key={r.id} size="xs" py={2}>
          • {r.title}{r.isBlocking ? ' (mandatory)' : ''}{r.serviceDate ? ` · ${r.serviceDate}` : ''}
        </Text>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- compose ----
export default function DayEnd() {
  const navigate = useNavigate()
  const { data, isLoading } = useDayEndPreview()
  const act = useTaskAct()
  // seeded from whatever was already saved against tonight's occurrence, so a
  // half-written report survives a refresh
  const [answers, setAnswers] = useState(null)

  if (isLoading) return <Loader size="sm" />
  if (!data) {
    return <Alert color="berry" variant="light" icon={<AlertTriangle size={17} />}>Could not load today</Alert>
  }

  if (data.alreadySubmitted || !data.instanceId) {
    return (
      <Card withBorder padding="lg">
        <Text ta="center" c="dimmed">
          {data.alreadySubmitted ? 'You have already filed today’s report.' : 'No day-end report is required for you.'}
        </Text>
      </Card>
    )
  }

  // Whatever this person's own form asks, keyed by question id. The questions
  // come off the SNAPSHOT on tonight's occurrence, not off the form as it
  // stands now — an edit made this afternoon must not change what they are
  // halfway through answering.
  const questions = data.questions || []
  const filled = answers ?? (data.answers || {})
  const stillNeeded = unanswered(questions, filled)

  const submit = () => act.mutate({
    path: `/task-instances/${data.instanceId}/submit`,
    body: { completion: { answers: filled } },
    success: 'Day-end report sent',
  }, { onSuccess: () => navigate('/tasks') })

  return (
    <Stack gap="md">
      <Group justify="space-between" align="baseline" wrap="wrap">
        <Group gap={7} align="center">
          <Sunset size={17} />
          <Title order={2} style={{ fontSize: 19 }}>Day-End Report</Title>
        </Group>
        <Text size="sm" c="dimmed">
          {data.date}{data.reportsTo ? ` · goes to ${data.reportsTo.name}` : ' · nobody above you to send it to'}
        </Text>
      </Group>

      <Card withBorder padding="md">
        <Group justify="space-between" wrap="wrap" mb="sm">
          <Text fw={700} size="sm">Your day</Text>
          <Text size="xs" c="dimmed">Rolled up automatically — you do not type these</Text>
        </Group>
        <Counts counts={data.summary.counts} />
        <TaskList title="Finished" rows={data.summary.completed} />
        <TaskList title="Still open" rows={data.summary.pending} />
        <TaskList title="Overdue" rows={data.summary.overdue} />
        <TaskList title="Waiting on someone else" rows={data.summary.awaitingApproval} />
      </Card>

      <Card withBorder padding="md">
        {data.statement && <Text size="sm" mb="sm">{data.statement}</Text>}
        <QuestionFields
          questions={questions}
          answers={filled}
          onChange={setAnswers}
          disabled={act.isPending}
        />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={() => navigate(-1)}>Back</Button>
          <Button disabled={stillNeeded.length > 0} loading={act.isPending} onClick={submit}>
            Send to {data.reportsTo?.name || 'file'}
          </Button>
        </Group>
      </Card>
    </Stack>
  )
}

// What they actually wrote, read back against the questions they were asked.
//
// The report carries its OWN copy of the questions, so one filed in March is
// still legible after the form has been rewritten or deleted. Reports written
// before day-end forms existed carry only `notes`, which is the fallback.
function Answers({ report }) {
  const questions = report.questions || []
  const answers = report.answers || {}
  if (!questions.length) {
    return report.notes
      ? <Text size="sm" mb="sm" style={{ borderLeft: '2px solid var(--line)', paddingLeft: 10 }}>{report.notes}</Text>
      : null
  }
  return (
    <div style={{ margin: '0 0 12px', borderLeft: '2px solid var(--line)', paddingLeft: 10 }}>
      {questions.map((q) => {
        const v = answers[q.id]
        const said = q.type === 'checklist'
          ? (q.items || []).filter((c) => (v || []).includes(c.id)).map((c) => c.text).join(', ')
          : (q.type === 'yes_no' || q.type === 'choose_one')
            ? ((q.options || []).find((o) => o.value === v)?.label || v)
            : v
        if (said === undefined || said === null || said === '') return null
        return (
          <div key={q.id} style={{ marginBottom: 6 }}>
            <Text size="xs" c="dimmed">{q.prompt}</Text>
            <Text size="sm">{String(said)}</Text>
          </div>
        )
      })}
    </div>
  )
}

// ----------------------------------------------------------------- inbox -----
export function DayEndReceived() {
  const { data, isLoading } = useDayEndReceived()
  const act = useTaskAct()
  const [comment, setComment] = useState({})

  if (isLoading) return <Loader size="sm" />
  if (!data) {
    return <Alert color="berry" variant="light" icon={<AlertTriangle size={17} />}>Could not load reports</Alert>
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="baseline" wrap="wrap">
        <Group gap={7} align="center">
          <Inbox size={17} />
          <Title order={2} style={{ fontSize: 19 }}>Day-end reports</Title>
        </Group>
        <Text size="sm" c="dimmed">{data.date} · {data.received} received</Text>
      </Group>

      {data.received > 0 && (
        <Card withBorder padding="md">
          <Text fw={700} size="sm" mb="sm">Across your team today</Text>
          <Counts counts={data.totals} />
        </Card>
      )}

      {data.outstanding.length > 0 && (
        <Card withBorder padding="md" style={{ borderLeft: '3px solid var(--marmalade)' }}>
          <Text fw={700} size="sm">Still to report</Text>
          <Text size="xs" c="dimmed" mt={4}>{data.outstanding.map((p) => p.name).join(', ')}</Text>
        </Card>
      )}

      {data.reports.length === 0 && (
        <Card withBorder padding="lg"><Text ta="center" c="dimmed">No reports in yet today.</Text></Card>
      )}

      {data.reports.map((r) => (
        <Card withBorder padding="md" key={r.id}>
          <Group justify="space-between" align="flex-start" wrap="wrap" mb="sm">
            <Group gap="xs" align="center" wrap="wrap">
              <Text fw={700} style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>{r.byName}</Text>
              <Text size="sm" c="dimmed">{r.byTier} · {r.nodeName}</Text>
              {r.acknowledgedAt && <Badge size="sm" variant="light" color="teal">read</Badge>}
            </Group>
            <Text size="xs" c="dimmed">{fmtDateTime(r.submittedAt)}</Text>
          </Group>
          <Counts counts={r.summary.counts} />
          <Answers report={r} />
          <TaskList title="Overdue" rows={r.summary.overdue} />
          {!r.acknowledgedAt && (
            <Group gap="xs" wrap="wrap" align="flex-end">
              <TextInput
                style={{ flex: 1, minWidth: 200 }} size="xs" placeholder="Reply (optional)"
                value={comment[r.id] || ''}
                onChange={(e) => setComment((c) => ({ ...c, [r.id]: e.currentTarget.value }))}
              />
              <Button size="xs" color="teal" leftSection={<Check size={12} />} onClick={() => act.mutate({
                path: `/tasks/day-end/${r.id}/acknowledge`,
                body: { comment: comment[r.id] || null },
                success: 'Marked as read',
              })}>
                Mark read
              </Button>
            </Group>
          )}
        </Card>
      ))}
    </Stack>
  )
}
