// What is waiting on this person's decision.
//
// Two different objects on one screen, deliberately: work submitted for
// sign-off, and requests to change records a completed task locked. They travel
// the same upward line and land with the same person, so splitting them across
// two tabs would mean checking two places to know whether anybody is waiting.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Stack, Group, Text, Card, Badge, Button, Modal, Textarea, TextInput,
  Alert, Loader, UnstyledButton,
} from '@mantine/core'
import { Check, X, Paperclip, Lock, RotateCcw, ExternalLink, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { fmtDateTime } from '../../api/hooks'
import { mediaUrl } from '../../api/client'
import { useApprovals, useTaskAct, useLockRequests } from '../../services/tasks/api'
import { dueLabel } from '../../services/tasks/status'

function Proof({ attachments = [] }) {
  if (!attachments.length) return <Text size="sm" c="dimmed">No files attached.</Text>
  return (
    <Group gap="xs" wrap="wrap">
      {attachments.map((a) => (
        <a
          key={a.id} href={mediaUrl(a.mediaId)} target="_blank" rel="noreferrer" title={a.filename}
          style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 6, width: 118, display: 'block' }}
        >
          {a.kind === 'photo' ? (
            <img src={mediaUrl(a.mediaId)} alt={a.filename}
              style={{ width: '100%', height: 70, objectFit: 'cover', borderRadius: 6 }} />
          ) : (
            <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#faf7f2', borderRadius: 6 }}>
              <Paperclip size={18} style={{ color: 'var(--ink-faint)' }} />
            </div>
          )}
          <Text size="xs" c="dimmed" mt={4} truncate>
            {a.filename} <ExternalLink size={9} />
          </Text>
        </a>
      ))}
    </Group>
  )
}

// Re-edit requests: someone below wants to change records a completed task was
// verified against. Same upward line, same audit trail, different object.
function ReEditRequests() {
  const { data: rows = [] } = useLockRequests('pending')
  const act = useTaskAct()
  const [reason, setReason] = useState({})
  const mine = rows.filter((r) => r.canDecide)
  if (!mine.length) return null

  const decide = (r, decision) => act.mutate({
    path: `/tasks/lock-requests/${r.id}/decide`,
    body: { decision, comment: reason[r.id] || null },
    success: decision === 'approved' ? 'Unlocked for one edit' : 'Refused',
  })

  return (
    <Card withBorder padding="md" style={{ borderLeft: '3px solid var(--marmalade)' }}>
      <Group justify="space-between" wrap="wrap" mb="xs">
        <Group gap={6}>
          <Lock size={13} />
          <Text fw={700} size="sm">Requests to change locked records</Text>
        </Group>
        <Text size="xs" c="dimmed">Approving opens ONE edit, for one hour</Text>
      </Group>
      <Stack gap="sm">
        {mine.map((r) => (
          <div key={r.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <Text size="sm"><b>{r.byName}</b> wants to edit <b>{r.scopeLabel}</b></Text>
            <Text size="xs" c="dimmed" mt={3} mb={8}>
              Locked by “{r.taskTitle}” · asked {fmtDateTime(r.createdAt)}{r.reason ? ` — ${r.reason}` : ''}
            </Text>
            <Group gap="xs" wrap="wrap" align="flex-end">
              <TextInput
                style={{ flex: 1, minWidth: 200 }} size="xs"
                placeholder="Comment (required to refuse)"
                value={reason[r.id] || ''}
                onChange={(e) => setReason((x) => ({ ...x, [r.id]: e.currentTarget.value }))}
              />
              <Button size="xs" leftSection={<Check size={12} />} onClick={() => decide(r, 'approved')}>
                Allow one edit
              </Button>
              <Button size="xs" color="berry" leftSection={<X size={12} />}
                disabled={!(reason[r.id] || '').trim()} onClick={() => decide(r, 'rejected')}>
                Refuse
              </Button>
            </Group>
          </div>
        ))}
      </Stack>
    </Card>
  )
}

export default function Approvals() {
  const { data: rows = [], isLoading, isError, error } = useApprovals()
  const act = useTaskAct()
  const [modal, setModal] = useState(null)
  const [comment, setComment] = useState('')
  // the row shows what you need to decide; opening it shows what they actually did
  const [open, setOpen] = useState(null)

  if (isLoading) return <Loader size="sm" />
  if (isError) {
    return (
      <Alert color="berry" variant="light" icon={<AlertTriangle size={17} />}>
        {error?.message || 'Could not load approvals'}
      </Alert>
    )
  }

  const close = () => { setModal(null); setComment('') }
  const decide = (kind) => act.mutate(
    { path: `/task-instances/${modal.id}/${kind}`, body: { comment }, success: kind === 'approve' ? 'Approved' : 'Sent back' },
    { onSuccess: close },
  )
  const rejecting = modal?.kind === 'reject'
  const blocked = rejecting && !comment.trim()

  // Held at the door had a route but no way in — reachable only by typing the
  // URL. It belongs here: this is where a manager already comes to unblock
  // somebody.
  const doorLink = (
    <Group justify="flex-end">
      <Button component={Link} to="/tasks/blocked" size="compact-xs" variant="subtle" leftSection={<Lock size={12} />}>
        Held at the door
      </Button>
    </Group>
  )

  if (!rows.length) {
    return (
      <Stack gap="md">
        <ReEditRequests />
        {doorLink}
        <Card withBorder padding="lg">
          <Text ta="center" c="dimmed">Nothing waiting on your decision.</Text>
        </Card>
      </Stack>
    )
  }

  return (
    <Stack gap="md">
      <ReEditRequests />
      {doorLink}

      <Card withBorder padding={0}>
        {rows.map((r, i) => {
          const isOpen = open === r.id
          const Chevron = isOpen ? ChevronDown : ChevronRight
          const proofShort = r.requiresMedia ? Math.max(0, (r.minAttachments || 1) - (r.attachments?.length || 0)) : 0
          return (
            <div key={r.id} style={{ borderTop: i ? '1px solid var(--line)' : 'none', padding: '12px 16px' }}>
              <Group gap="sm" align="center" wrap="wrap">
                <UnstyledButton onClick={() => setOpen(isOpen ? null : r.id)}
                  style={{ flex: 1, minWidth: 220 }}>
                  <Group gap="sm" wrap="nowrap" align="flex-start">
                    <Chevron size={15} style={{ color: 'var(--ink-faint)', flexShrink: 0, marginTop: 2 }} />
                    <div style={{ minWidth: 0 }}>
                      <Group gap={7} align="center" wrap="wrap">
                        <Text fw={700} size="sm">{r.title}</Text>
                        {r.isBlocking && (
                          <Badge size="sm" variant="light" color="orange" leftSection={<Lock size={9} />}>mandatory</Badge>
                        )}
                        {r.rejectionCount > 0 && (
                          <Badge size="sm" variant="light" color="berry" leftSection={<RotateCcw size={9} />}>
                            try {r.submissionRound}
                          </Badge>
                        )}
                        {proofShort > 0 && <Badge size="sm" variant="light" color="berry">no proof attached</Badge>}
                      </Group>
                      <Text size="xs" c="dimmed" mt={2}>
                        {r.assigneeName} · {r.assigneeTier} · sent {fmtDateTime(r.submittedAt)}
                      </Text>
                    </div>
                  </Group>
                </UnstyledButton>
                <Group gap={6} style={{ flexShrink: 0 }}>
                  <Button size="compact-xs" leftSection={<Check size={12} />}
                    onClick={() => setModal({ id: r.id, kind: 'approve', title: r.title })}>
                    Approve
                  </Button>
                  <Button size="compact-xs" color="berry" leftSection={<X size={12} />}
                    onClick={() => setModal({ id: r.id, kind: 'reject', title: r.title })}>
                    Send back
                  </Button>
                </Group>
              </Group>

              {isOpen && (
                <Stack gap="xs" pl={26} pt={12} pb={4}>
                  {r.description && <Text size="sm">{r.description}</Text>}
                  {r.lastComment && (
                    <Text size="sm" style={{ borderLeft: '2px solid var(--line)', paddingLeft: 10 }}>
                      {r.lastComment}
                    </Text>
                  )}
                  <Text size="xs" c="dimmed">
                    {r.requiresMedia ? `Proof — ${r.minAttachments} × ${r.mediaTypes?.join(' / ')} required` : 'Proof'}
                  </Text>
                  <Proof attachments={r.attachments} />
                  <Text size="xs" c="dimmed">
                    {dueLabel(r)}{r.nodeName ? ` · ${r.nodeName}` : ''}{r.categoryName ? ` · ${r.categoryName}` : ''}
                    {r.viaOverride && ' · you are deciding this from above, which is recorded'}
                  </Text>
                </Stack>
              )}
            </div>
          )
        })}
      </Card>

      {modal && (
        <Modal opened onClose={close}
          title={modal.kind === 'approve' ? `Approve “${modal.title}”` : `Send back “${modal.title}”`}>
          <Stack gap="md">
            <Textarea
              label={modal.kind === 'approve' ? 'Comment (optional)' : 'What needs fixing?'}
              required={rejecting} autosize minRows={3} data-autofocus
              value={comment} onChange={(e) => setComment(e.currentTarget.value)}
              placeholder={modal.kind === 'approve' ? 'Nice work' : 'Be specific — the assignee sees this'}
            />
            {rejecting && (
              <Text size="xs" c="dimmed">
                This goes straight back to them as live work. If it is a mandatory task, it keeps
                blocking their logout until it is resubmitted and approved.
              </Text>
            )}
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={close}>Cancel</Button>
              <Button color={modal.kind === 'approve' ? undefined : 'berry'}
                loading={act.isPending} disabled={blocked} onClick={() => decide(modal.kind)}>
                {modal.kind === 'approve' ? 'Approve' : 'Send back'}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  )
}
