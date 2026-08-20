import { useState } from 'react'
import { Check, X, Paperclip, Lock, RotateCcw, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import { Spinner, Empty, Badge, Modal, Field } from '../../components/ui'
import { fmtDateTime } from '../../api/hooks'
import { mediaUrl } from '../../api/client'
import { useApprovals, useTaskAct, useLockRequests } from '../../services/tasks/api'
import { dueLabel } from '../../services/tasks/status'

function Proof({ attachments = [] }) {
  if (!attachments.length) {
    return <span className="muted">No files attached.</span>
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {attachments.map((a) => (
        <a
          key={a.id}
          href={mediaUrl(a.mediaId)}
          target="_blank"
          rel="noreferrer"
          style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 6, width: 118, display: 'block' }}
          title={a.filename}
        >
          {a.kind === 'photo' ? (
            <img src={mediaUrl(a.mediaId)} alt={a.filename} style={{ width: '100%', height: 70, objectFit: 'cover', borderRadius: 6 }} />
          ) : (
            <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#faf7f2', borderRadius: 6 }}>
              <Paperclip size={18} style={{ color: 'var(--ink-faint)' }} />
            </div>
          )}
          <div className="muted" style={{ fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {a.filename} <ExternalLink size={9} />
          </div>
        </a>
      ))}
    </div>
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
    <div className="card" style={{ borderLeft: '3px solid var(--marmalade)' }}>
      <div className="card-title">
        <b><Lock size={13} style={{ verticalAlign: -2 }} /> Requests to change locked records</b>
        <span className="muted">Approving opens ONE edit, for one hour</span>
      </div>
      {mine.map((r) => (
        <div key={r.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 10 }}>
          <div style={{ fontSize: 13.5 }}>
            <b>{r.byName}</b> wants to edit <b>{r.scopeLabel}</b>
          </div>
          <div className="muted" style={{ fontSize: 12.5, margin: '3px 0 8px' }}>
            Locked by “{r.taskTitle}” · asked {fmtDateTime(r.createdAt)}{r.reason ? ` — ${r.reason}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input style={{ flex: 1, minWidth: 200 }} placeholder="Comment (required to refuse)"
              value={reason[r.id] || ''} onChange={(e) => setReason((x) => ({ ...x, [r.id]: e.target.value }))} />
            <button className="btn sm" onClick={() => decide(r, 'approved')}><Check size={12} /> Allow one edit</button>
            <button className="btn sm danger" disabled={!(reason[r.id] || '').trim()} onClick={() => decide(r, 'rejected')}>
              <X size={12} /> Refuse
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Approvals() {
  const { data: rows = [], isLoading, isError, error } = useApprovals()
  const act = useTaskAct()
  const [modal, setModal] = useState(null)
  const [comment, setComment] = useState('')
  // the row shows what you need to decide; opening it shows what they actually did
  const [open, setOpen] = useState(null)

  if (isLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load approvals'} /></div>
  if (!rows.length) {
    return (
      <div>
        <ReEditRequests />
        <div className="card"><Empty emoji="👍" text="Nothing waiting on your decision" /></div>
      </div>
    )
  }

  const close = () => { setModal(null); setComment('') }
  const decide = (kind) => act.mutate(
    { path: `/task-instances/${modal.id}/${kind}`, body: { comment }, success: kind === 'approve' ? 'Approved' : 'Sent back' },
    { onSuccess: close }
  )
  const rejecting = modal?.kind === 'reject'
  const blocked = rejecting && !comment.trim()

  return (
    <div>
      <ReEditRequests />

      <div className="card" style={{ padding: 0 }}>
        {rows.map((r, i) => {
          const isOpen = open === r.id
          const Chevron = isOpen ? ChevronDown : ChevronRight
          const proofShort = r.requiresMedia ? Math.max(0, (r.minAttachments || 1) - (r.attachments?.length || 0)) : 0
          return (
            <div key={r.id} style={{ borderTop: i ? '1px solid var(--line)' : 'none', padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setOpen(isOpen ? null : r.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 220, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                  <Chevron size={15} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                      <b style={{ fontSize: 14 }}>{r.title}</b>
                      {r.isBlocking && <Badge color="orange"><Lock size={9} style={{ verticalAlign: -1 }} /> mandatory</Badge>}
                      {r.rejectionCount > 0 && <Badge color="red"><RotateCcw size={9} style={{ verticalAlign: -1 }} /> try {r.submissionRound}</Badge>}
                      {proofShort > 0 && <Badge color="red">no proof attached</Badge>}
                    </div>
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                      {r.assigneeName} · {r.assigneeTier} · sent {fmtDateTime(r.submittedAt)}
                    </div>
                  </div>
                </button>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn sm" onClick={() => setModal({ id: r.id, kind: 'approve', title: r.title })}>
                    <Check size={12} /> Approve
                  </button>
                  <button className="btn sm danger" onClick={() => setModal({ id: r.id, kind: 'reject', title: r.title })}>
                    <X size={12} /> Send back
                  </button>
                </div>
              </div>

              {isOpen && (
                <div style={{ padding: '12px 0 4px 26px' }}>
                  {r.description && <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.5 }}>{r.description}</p>}
                  {r.lastComment && (
                    <p style={{ margin: '0 0 12px', fontSize: 13, borderLeft: '2px solid var(--line)', paddingLeft: 10 }}>
                      {r.lastComment}
                    </p>
                  )}
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                    {r.requiresMedia ? `Proof — ${r.minAttachments} × ${r.mediaTypes?.join(' / ')} required` : 'Proof'}
                  </div>
                  <Proof attachments={r.attachments} />
                  <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                    {dueLabel(r)}{r.nodeName ? ` · ${r.nodeName}` : ''}{r.categoryName ? ` · ${r.categoryName}` : ''}
                    {r.viaOverride && ' · you are deciding this from above, which is recorded'}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {modal && (
        <Modal title={modal.kind === 'approve' ? `Approve “${modal.title}”` : `Send back “${modal.title}”`} onClose={close}>
          <Field label={modal.kind === 'approve' ? 'Comment (optional)' : 'What needs fixing? *'}>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              autoFocus
              placeholder={modal.kind === 'approve' ? 'Nice work' : 'Be specific — the assignee sees this'}
            />
          </Field>
          {rejecting && (
            <p className="muted" style={{ margin: '-6px 0 12px' }}>
              This goes straight back to them as live work. If it is a mandatory task, it keeps blocking their logout
              until it is resubmitted and approved.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={close}>Cancel</button>
            <button
              className={`btn ${modal.kind === 'approve' ? '' : 'danger'}`}
              disabled={act.isPending || blocked}
              onClick={() => decide(modal.kind)}
            >
              {modal.kind === 'approve' ? 'Approve' : 'Send back'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
