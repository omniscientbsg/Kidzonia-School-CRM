// One occurrence, in full: what it is, what it needs, and everything that has
// happened to it.
//
// It reads at 360px. The action row wraps, the facts grid drops to one column,
// and nothing is behind a hover.
import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  Stack, Group, Text, Title, Card, Badge, Button, ActionIcon, Modal, Textarea,
  TextInput, Select, Alert, Loader, SimpleGrid, Checkbox, Anchor, FileButton,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import {
  ArrowLeft, Play, Send, Check, X, CalendarClock, UserRoundCog, Ban, Paperclip,
  Trash2, ExternalLink, AlertTriangle,
} from 'lucide-react'
import { fmtDateTime } from '../../api/hooks'
import { mediaUrl } from '../../api/client'
import { useInstance, useTimeline, useTaskAct, uploadProof } from '../../services/tasks/api'
import { useDownline } from '../../services/org/api'
import { dueLabel, statusLabel, statusColor } from '../../services/tasks/status'
import Countdown from './Countdown'
import QuestionFields from './QuestionFields'

const ACTION_LABEL = {
  'instance.generate': 'Assigned',
  'instance.start': 'Started',
  'instance.answer': 'Answered',
  'instance.attach': 'Attached proof',
  'instance.detach': 'Removed proof',
  'instance.submit': 'Submitted',
  'instance.approve': 'Approved',
  'instance.reject': 'Sent back',
  'instance.defer': 'Deferred',
  'instance.cancel': 'Cancelled',
  'instance.reassign': 'Reassigned',
}

const toISO = (d) => (d instanceof Date && !Number.isNaN(+d) ? d.toISOString().slice(0, 10) : (d || ''))
const toDate = (s) => (s ? new Date(`${s}T00:00:00`) : null)

function PromptModal({ title, label, placeholder, confirmLabel, extra, busy, maxDate, note, onClose, onConfirm }) {
  const [text, setText] = useState('')
  const [date, setDate] = useState(null)
  return (
    <Modal opened onClose={onClose} title={title}>
      <Stack gap="md">
        {extra === 'date' && (
          <DateInput label="Defer to" required value={date} onChange={setDate}
            maxDate={maxDate ? toDate(maxDate) : undefined} placeholder="Pick a date" />
        )}
        {note && <Text size="xs" c="dimmed">{note}</Text>}
        <Textarea label={label} autosize minRows={3} data-autofocus placeholder={placeholder}
          value={text} onChange={(e) => setText(e.currentTarget.value)} />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={extra === 'date' && !date}
            onClick={() => onConfirm({ comment: text, reason: text, to: toISO(date) })}>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

// A module-linked answer. The Yes is DERIVED: it is a disabled control whose
// value is the signal, and there is no handler that could set it — doing the
// work in the module is the only thing that ticks it.
function DerivedAnswer({ inst }) {
  const derived = inst.condition?.derived || {}
  const on = !!derived.enabled
  const ev = inst.completionEvidence
  return (
    <Stack gap="xs" mb="md">
      <Group gap="xs" align="center" wrap="wrap">
        <Text fw={600} size="sm">{derived.question}</Text>
        <Badge size="sm" variant="light" color="gray">verified by the module</Badge>
      </Group>

      <Group gap="sm" align="center" wrap="wrap">
        <Checkbox
          checked={on} disabled readOnly label="Yes"
          title={on ? 'Read from the module' : 'This turns on by itself once the module says so'}
        />
        {!on && derived.cta?.route && (
          <Button component={Link} to={derived.cta.route} size="compact-xs" variant="light"
            leftSection={<ExternalLink size={12} />}>
            {derived.cta.label}
          </Button>
        )}
      </Group>

      <Text size="xs" c="dimmed">{inst.condition?.message}</Text>

      {ev && (
        <Alert variant="light" color="marmalade" p="xs">
          <Text size="xs">
            <b>Evidence</b> · {ev.count} record{ev.count === 1 ? '' : 's'} in {ev.moduleKey}
            {ev.markedAt ? ` · marked ${fmtDateTime(ev.markedAt)}` : ''}
            {ev.observedAt ? ` · verified ${fmtDateTime(ev.observedAt)}` : ''}
          </Text>
        </Alert>
      )}
    </Stack>
  )
}

// How this occurrence is judged. Reads the condition SNAPSHOTTED onto the
// occurrence — never the template's current one, so a task assigned last week
// keeps asking last week's questions.
//
// It used to branch on three mutually exclusive natures with a hand-written
// block each. It walks the question list now, so a task that asks a yes/no AND
// a checklist AND for a note renders without anybody adding a fourth branch.
function CompletionPanel({ inst, busy, onSave }) {
  const condition = inst.completionCondition || {}
  const questions = condition.questions || []
  const [answers, setAnswers] = useState(inst.completion?.answers || {})

  const editable = inst.can?.answer
  // a system check with nothing to answer, or a legacy no-op condition, has
  // nothing to show beyond the derived tick
  if (!questions.length && !condition.system) return null

  return (
    <Card withBorder padding="md">
      <Group justify="space-between" wrap="wrap" mb="sm">
        <Text fw={700} size="sm">How this is verified</Text>
        <Text size="xs" c="dimmed">{inst.condition?.summary}</Text>
      </Group>

      {condition.system && <DerivedAnswer inst={inst} />}

      {condition.statement && <Text size="sm" mb="sm">{condition.statement}</Text>}

      <QuestionFields
        questions={questions}
        answers={answers}
        onChange={setAnswers}
        disabled={!editable}
        missing={inst.condition?.missing || []}
        message={inst.condition?.message}
      />

      {editable && (
        <Group gap="sm" align="center" mt="xs">
          <Button size="compact-sm" variant="light" loading={busy} onClick={() => onSave({ answers })}>
            Save answer
          </Button>
          {!inst.condition?.satisfied && <Text size="xs" c="dimmed">{inst.condition?.message}</Text>}
        </Group>
      )}
    </Card>
  )
}

function ReassignModal({ inst, busy, onClose, onConfirm }) {
  const { data: downline = [] } = useDownline()
  const [positionId, setPositionId] = useState('')
  const [reason, setReason] = useState('')
  const options = downline
    .filter((p) => p.id !== inst.assigneePositionId)
    .map((p) => ({ value: p.id, label: `${p.userName} · ${p.tier} · ${p.nodeName}` }))
  return (
    <Modal opened onClose={onClose} title="Reassign this task">
      <Stack gap="md">
        <Select label="Give it to" required searchable data={options}
          placeholder="Choose someone below you"
          value={positionId} onChange={(v) => setPositionId(v || '')} />
        <TextInput label="Reason" placeholder="e.g. Anjali is on leave"
          value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button disabled={!positionId} loading={busy}
            onClick={() => onConfirm({ toPositionId: positionId, reason })}>Reassign</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function Fact({ label, children }) {
  return (
    <div>
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="sm">{children}</Text>
    </div>
  )
}

export default function TaskDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: inst, isLoading, isError, error } = useInstance(id)
  const { data: timeline } = useTimeline(id)
  const act = useTaskAct()
  const [modal, setModal] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)

  if (isLoading) return <Loader size="sm" />
  if (isError || !inst) {
    return (
      <Alert color="berry" variant="light" icon={<AlertTriangle size={17} />}>
        {error?.message || 'Could not load this task'}
      </Alert>
    )
  }

  const run = (path, body, success) => act.mutate(
    { path: `/task-instances/${id}/${path}`, body, success },
    { onSuccess: () => setModal(null) },
  )
  const roundProof = (inst.attachments || []).filter((a) => a.submissionRound === inst.submissionRound)
  const proofShort = inst.requiresMedia ? Math.max(0, (inst.minAttachments || 1) - roundProof.length) : 0

  async function onFile(file) {
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      const asset = await uploadProof(file)
      act.mutate({ path: `/task-instances/${id}/attachments`, body: { mediaId: asset.id }, success: 'Proof attached' })
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <Stack gap="md">
      <Group gap="sm" align="center" wrap="wrap">
        <ActionIcon variant="subtle" color="ink" aria-label="Back" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
        </ActionIcon>
        <Title order={2} style={{ fontSize: 19 }}>{inst.title}</Title>
        <Badge variant="light" color={statusColor(inst)}>{statusLabel(inst)}</Badge>
        <div style={{ flex: 1 }} />
        <Countdown inst={inst} big />
        <Text size="sm" c="dimmed">{dueLabel(inst)}</Text>
      </Group>

      <Card withBorder padding="md">
        {inst.description && <Text mb="md">{inst.description}</Text>}
        <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="md">
          <Fact label="Assigned to"><b>{inst.assigneeName}</b> · {inst.assigneeTier}</Fact>
          <Fact label="By"><b>{inst.assignedByName}</b></Fact>
          <Fact label="School / node"><b>{inst.nodeName}</b></Fact>
          <Fact label="For"><b>{inst.serviceDate}</b> ({inst.tz})</Fact>
          {inst.categoryName && <Fact label="Category"><b>{inst.categoryName}</b></Fact>}
          {inst.rejectionCount > 0 && <Fact label="Sent back"><b>{inst.rejectionCount}×</b></Fact>}
        </SimpleGrid>

        {inst.status === 'deferred' && (
          <Text size="sm" mt="sm">Deferred to <b>{inst.deferredTo}</b> — {inst.deferReason}</Text>
        )}
        {inst.status === 'cancelled' && inst.cancelReason && (
          <Text size="sm" mt="sm">Cancelled — {inst.cancelReason}</Text>
        )}

        <Group gap="xs" mt="md" wrap="wrap">
          {inst.can?.start && (
            <Button variant="light" leftSection={<Play size={13} />} onClick={() => run('start', null, 'Started')}>
              Start
            </Button>
          )}
          {inst.can?.submit && (
            <Button
              leftSection={<Send size={13} />}
              disabled={proofShort > 0 || !inst.condition?.satisfied}
              title={inst.condition?.satisfied ? undefined : inst.condition?.message}
              onClick={() => setModal({ kind: 'submit' })}
            >
              {inst.requiresApproval ? 'Submit for approval' : 'Mark done'}
              {proofShort > 0 ? ` (${proofShort} more file${proofShort > 1 ? 's' : ''} needed)` : ''}
            </Button>
          )}
          {inst.can?.decide && (
            <>
              <Button color="teal" leftSection={<Check size={13} />} onClick={() => setModal({ kind: 'approve' })}>
                Approve
              </Button>
              <Button color="berry" leftSection={<X size={13} />} onClick={() => setModal({ kind: 'reject' })}>
                Send back
              </Button>
            </>
          )}
          {inst.can?.defer && (
            <Button variant="default" leftSection={<CalendarClock size={13} />} onClick={() => setModal({ kind: 'defer' })}>
              Defer
            </Button>
          )}
          {inst.can?.reassign && (
            <Button variant="default" leftSection={<UserRoundCog size={13} />} onClick={() => setModal({ kind: 'reassign' })}>
              Reassign
            </Button>
          )}
          {inst.can?.cancel && (
            <Button variant="default" leftSection={<Ban size={13} />} onClick={() => setModal({ kind: 'cancel' })}>
              Cancel
            </Button>
          )}
        </Group>
      </Card>

      <CompletionPanel
        // a rejection clears the answer and opens a new round, so the panel
        // must start over rather than keep showing the answer that was refused
        key={`${inst.id}-${inst.submissionRound}`}
        inst={inst} busy={act.isPending}
        onSave={(body) => act.mutate({ path: `/task-instances/${id}/answer`, body, success: 'Answer saved' })}
      />

      {(inst.requiresMedia || (inst.attachments || []).length > 0) && (
        <Card withBorder padding="md">
          <Group justify="space-between" wrap="wrap" mb="sm">
            <Text fw={700} size="sm">
              Proof {inst.requiresMedia ? `(${inst.minAttachments} × ${inst.mediaTypes.join(' / ')} required)` : ''}
            </Text>
            {inst.can?.submit && (
              <FileButton onChange={onFile} disabled={uploading}>
                {(props) => (
                  <Button {...props} size="compact-xs" variant="light" leftSection={<Paperclip size={12} />}>
                    {uploading ? 'Uploading…' : 'Attach file'}
                  </Button>
                )}
              </FileButton>
            )}
          </Group>
          {uploadError && <Text size="sm" c="berry" mb="xs">{uploadError}</Text>}
          {(inst.attachments || []).length === 0 ? (
            <Text size="sm" c="dimmed">Nothing attached yet.</Text>
          ) : (
            <Group gap="sm" wrap="wrap">
              {inst.attachments.map((a) => (
                <div key={a.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 8, width: 150 }}>
                  {a.kind === 'photo' ? (
                    <a href={mediaUrl(a.mediaId)} target="_blank" rel="noreferrer">
                      <img src={mediaUrl(a.mediaId)} alt={a.filename}
                        style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 6 }} />
                    </a>
                  ) : (
                    <Anchor href={mediaUrl(a.mediaId)} target="_blank" rel="noreferrer" size="xs">{a.filename}</Anchor>
                  )}
                  <Group justify="space-between" align="center" mt={4}>
                    <Text size="xs" c="dimmed">round {a.submissionRound}</Text>
                    {inst.can?.submit && a.submissionRound === inst.submissionRound && (
                      <ActionIcon variant="subtle" color="berry" size="sm" aria-label="Remove"
                        onClick={() => act.mutate({ method: 'del', path: `/task-instances/${id}/attachments/${a.id}`, success: 'Removed' })}>
                        <Trash2 size={11} />
                      </ActionIcon>
                    )}
                  </Group>
                </div>
              ))}
            </Group>
          )}
        </Card>
      )}

      <Card withBorder padding="md">
        <Group justify="space-between" wrap="wrap" mb="sm">
          <Text fw={700} size="sm">History</Text>
          <Text size="xs" c="dimmed">Immutable audit trail</Text>
        </Group>
        {!timeline?.events?.length ? (
          <Text size="sm" c="dimmed">No activity yet.</Text>
        ) : (
          <Stack gap={0}>
            {timeline.events.map((e, i) => (
              <div key={e.id} style={{ padding: '8px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                <Group gap={6} align="center" wrap="wrap">
                  <Text size="sm" fw={600}>{ACTION_LABEL[e.action] || e.action}</Text>
                  <Text size="sm" c="dimmed">· {e.userName}</Text>
                  {e.viaOverride && <Badge size="sm" variant="light" color="plum">override</Badge>}
                </Group>
                <Text size="xs" c="dimmed">{fmtDateTime(e.at)}{e.reason ? ` — ${e.reason}` : ''}</Text>
              </div>
            ))}
          </Stack>
        )}
      </Card>

      {modal?.kind === 'submit' && (
        <PromptModal
          title="Submit this task" label="Note for the approver (optional)" placeholder="Anything they should know"
          confirmLabel={inst.requiresApproval ? 'Submit for approval' : 'Mark completed'} busy={act.isPending}
          onClose={() => setModal(null)}
          onConfirm={({ comment }) => run('submit', { comment }, inst.requiresApproval ? 'Sent for approval' : 'Completed')}
        />
      )}
      {modal?.kind === 'approve' && (
        <PromptModal
          title="Approve this task" label="Comment (optional)" placeholder="Nice work" confirmLabel="Approve"
          busy={act.isPending} onClose={() => setModal(null)}
          onConfirm={({ comment }) => run('approve', { comment }, 'Approved')}
        />
      )}
      {modal?.kind === 'reject' && (
        <PromptModal
          title="Send this back" label="What needs fixing?" placeholder="Be specific — they will see this"
          confirmLabel="Send back" busy={act.isPending} onClose={() => setModal(null)}
          onConfirm={({ comment }) => run('reject', { comment }, 'Sent back')}
        />
      )}
      {modal?.kind === 'defer' && (
        <PromptModal
          title="Defer this task" label="Reason" placeholder="Why is it moving?" confirmLabel="Defer"
          extra="date" busy={act.isPending}
          maxDate={inst.can?.decide || !inst.selfDeferLimit ? undefined : inst.selfDeferLimit}
          note={inst.selfDeferLimit
            ? `You have until ${inst.selfDeferLimit} to finish this one, so you can move it within that window.`
            : 'Deferring someone else’s task is recorded against your name.'}
          onClose={() => setModal(null)}
          onConfirm={({ reason, to }) => run('defer', { reason, to }, 'Deferred')}
        />
      )}
      {modal?.kind === 'reassign' && (
        <ReassignModal inst={inst} busy={act.isPending} onClose={() => setModal(null)}
          onConfirm={(body) => run('reassign', body, 'Reassigned')} />
      )}
      {modal?.kind === 'cancel' && (
        <Modal opened onClose={() => setModal(null)} title="Cancel this occurrence?">
          <Stack gap="md">
            <Text size="sm">
              It stays in the history with your name on it. The recurring task itself keeps running.
            </Text>
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => setModal(null)}>Keep it</Button>
              <Button color="berry" loading={act.isPending}
                onClick={() => run('cancel', { reason: 'Cancelled from task detail' }, 'Cancelled')}>
                Cancel task
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  )
}
