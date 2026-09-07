import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Play, Send, Check, X, CalendarClock, UserRoundCog, Ban, Paperclip, Trash2, ExternalLink } from 'lucide-react'
import { Spinner, Empty, Badge, Modal, Field, ConfirmDialog } from '../../components/ui'
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

function PromptModal({ title, label, placeholder, confirmLabel, extra, busy, maxDate, note, onClose, onConfirm }) {
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  return (
    <Modal title={title} onClose={onClose}>
      {extra === 'date' && (
        <Field label="Defer to *">
          <input type="date" value={date} max={maxDate || undefined} onChange={(e) => setDate(e.target.value)} />
        </Field>
      )}
      {note && <p className="muted" style={{ margin: '-6px 0 12px' }}>{note}</p>}
      <Field label={label}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} autoFocus />
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || (extra === 'date' && !date)} onClick={() => onConfirm({ comment: text, reason: text, to: date })}>
          {confirmLabel}
        </button>
      </div>
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
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
        {derived.question}
        <Badge color="gray">verified by the module</Badge>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label
          title={on ? 'Read from the module' : 'This turns on by itself once the module says so'}
          style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, opacity: on ? 1 : 0.55, cursor: 'not-allowed' }}
        >
          <input type="checkbox" checked={on} disabled readOnly style={{ width: 'auto' }} />
          Yes
        </label>
        {!on && derived.cta?.route && (
          <Link className="btn sm subtle" to={derived.cta.route}>
            <ExternalLink size={12} /> {derived.cta.label}
          </Link>
        )}
      </div>

      <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>{inst.condition?.message}</div>

      {ev && (
        <div className="card" style={{ background: 'var(--marmalade-soft)', boxShadow: 'none', marginTop: 12, marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, color: 'var(--marmalade-deep)' }}>
            <b>Evidence</b> · {ev.count} record{ev.count === 1 ? '' : 's'} in {ev.moduleKey}
            {ev.markedAt ? ` · marked ${fmtDateTime(ev.markedAt)}` : ''}
            {ev.observedAt ? ` · verified ${fmtDateTime(ev.observedAt)}` : ''}
          </div>
        </div>
      )}
    </div>
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
    <div className="card">
      <div className="card-title">
        <b>How this is verified</b>
        <span className="muted">{inst.condition?.summary}</span>
      </div>

      {condition.system && <DerivedAnswer inst={inst} />}

      {condition.statement && (
        <p style={{ margin: '0 0 12px', fontSize: 13.5 }}>{condition.statement}</p>
      )}

      <QuestionFields
        questions={questions}
        answers={answers}
        onChange={setAnswers}
        disabled={!editable}
        missing={inst.condition?.missing || []}
        message={inst.condition?.message}
      />

      {editable && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
          <button className="btn sm subtle" disabled={busy} onClick={() => onSave({ answers })}>Save answer</button>
          {!inst.condition?.satisfied && <span className="muted" style={{ fontSize: 12.5 }}>{inst.condition?.message}</span>}
        </div>
      )}
    </div>
  )
}

function ReassignModal({ inst, busy, onClose, onConfirm }) {
  const { data: downline = [] } = useDownline()
  const [positionId, setPositionId] = useState('')
  const [reason, setReason] = useState('')
  const options = downline.filter((p) => p.id !== inst.assigneePositionId)
  return (
    <Modal title="Reassign this task" onClose={onClose}>
      <Field label="Give it to *">
        <select value={positionId} onChange={(e) => setPositionId(e.target.value)}>
          <option value="">— choose someone below you —</option>
          {options.map((p) => <option key={p.id} value={p.id}>{p.userName} · {p.tier} · {p.nodeName}</option>)}
        </select>
      </Field>
      <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Anjali is on leave" /></Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!positionId || busy} onClick={() => onConfirm({ toPositionId: positionId, reason })}>Reassign</button>
      </div>
    </Modal>
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

  if (isLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load this task'} /></div>
  if (!inst) return <div className="card"><Empty emoji="🔍" text="Task not found" /></div>

  const run = (path, body, success) => act.mutate({ path: `/task-instances/${id}/${path}`, body, success }, { onSuccess: () => setModal(null) })
  const roundProof = (inst.attachments || []).filter((a) => a.submissionRound === inst.submissionRound)
  const proofShort = inst.requiresMedia ? Math.max(0, (inst.minAttachments || 1) - roundProof.length) : 0

  async function onFile(e) {
    const file = e.target.files?.[0]
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
      e.target.value = ''
    }
  }

  return (
    <div>
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate(-1)}><ArrowLeft size={16} /></button>
        <h1 style={{ fontSize: 19 }}>{inst.title}</h1>
        <Badge color={statusColor(inst)}>{statusLabel(inst)}</Badge>
        <div className="spacer" />
        <Countdown inst={inst} big />
        <span className="muted">{dueLabel(inst)}</span>
      </div>

      <div className="card">
        {inst.description && <p style={{ margin: '0 0 14px', lineHeight: 1.55 }}>{inst.description}</p>}
        <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', fontSize: 13 }}>
          <div><div className="muted">Assigned to</div><b>{inst.assigneeName}</b> · {inst.assigneeTier}</div>
          <div><div className="muted">By</div><b>{inst.assignedByName}</b></div>
          <div><div className="muted">School / node</div><b>{inst.nodeName}</b></div>
          <div><div className="muted">For</div><b>{inst.serviceDate}</b> ({inst.tz})</div>
          {inst.categoryName && <div><div className="muted">Category</div><b>{inst.categoryName}</b></div>}
          {inst.rejectionCount > 0 && <div><div className="muted">Sent back</div><b>{inst.rejectionCount}×</b></div>}
        </div>
        {inst.status === 'deferred' && (
          <div style={{ marginTop: 12, fontSize: 13 }}>Deferred to <b>{inst.deferredTo}</b> — {inst.deferReason}</div>
        )}
        {inst.status === 'cancelled' && inst.cancelReason && (
          <div style={{ marginTop: 12, fontSize: 13 }}>Cancelled — {inst.cancelReason}</div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {inst.can?.start && <button className="btn subtle" onClick={() => run('start', null, 'Started')}><Play size={13} /> Start</button>}
          {inst.can?.submit && (
            <button className="btn" disabled={proofShort > 0 || !inst.condition?.satisfied}
              title={inst.condition?.satisfied ? undefined : inst.condition?.message}
              onClick={() => setModal({ kind: 'submit' })}>
              <Send size={13} /> {inst.requiresApproval ? 'Submit for approval' : 'Mark done'}
              {proofShort > 0 ? ` (${proofShort} more file${proofShort > 1 ? 's' : ''} needed)` : ''}
            </button>
          )}
          {inst.can?.decide && (
            <>
              <button className="btn teal" onClick={() => setModal({ kind: 'approve' })}><Check size={13} /> Approve</button>
              <button className="btn danger" onClick={() => setModal({ kind: 'reject' })}><X size={13} /> Send back</button>
            </>
          )}
          {inst.can?.defer && <button className="btn ghost" onClick={() => setModal({ kind: 'defer' })}><CalendarClock size={13} /> Defer</button>}
          {inst.can?.reassign && <button className="btn ghost" onClick={() => setModal({ kind: 'reassign' })}><UserRoundCog size={13} /> Reassign</button>}
          {inst.can?.cancel && <button className="btn ghost" onClick={() => setModal({ kind: 'cancel' })}><Ban size={13} /> Cancel</button>}
        </div>
      </div>

      <CompletionPanel
        // a rejection clears the answer and opens a new round, so the panel
        // must start over rather than keep showing the answer that was refused
        key={`${inst.id}-${inst.submissionRound}`}
        inst={inst} busy={act.isPending}
        onSave={(body) => act.mutate({ path: `/task-instances/${id}/answer`, body, success: 'Answer saved' })}
      />

      {(inst.requiresMedia || (inst.attachments || []).length > 0) && (
        <div className="card">
          <div className="card-title">
            <b>Proof {inst.requiresMedia ? `(${inst.minAttachments} × ${inst.mediaTypes.join(' / ')} required)` : ''}</b>
            {inst.can?.submit && (
              <label className="btn sm subtle" style={{ cursor: 'pointer' }}>
                <Paperclip size={12} /> {uploading ? 'Uploading…' : 'Attach file'}
                <input type="file" hidden onChange={onFile} disabled={uploading} />
              </label>
            )}
          </div>
          {uploadError && <div className="muted" style={{ color: 'var(--berry)', marginBottom: 8 }}>{uploadError}</div>}
          {(inst.attachments || []).length === 0 ? (
            <Empty emoji="📎" text="Nothing attached yet" />
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {inst.attachments.map((a) => (
                <div key={a.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 8, width: 150 }}>
                  {a.kind === 'photo'
                    ? <a href={mediaUrl(a.mediaId)} target="_blank" rel="noreferrer"><img src={mediaUrl(a.mediaId)} alt={a.filename} style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 6 }} /></a>
                    : <a href={mediaUrl(a.mediaId)} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>{a.filename}</a>}
                  <div className="muted" style={{ fontSize: 11, marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>round {a.submissionRound}</span>
                    {inst.can?.submit && a.submissionRound === inst.submissionRound && (
                      <button className="icon-btn" style={{ width: 22, height: 22 }} title="Remove"
                        onClick={() => act.mutate({ method: 'del', path: `/task-instances/${id}/attachments/${a.id}`, success: 'Removed' })}>
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-title"><b>History</b><span className="muted">Immutable audit trail</span></div>
        {!timeline?.events?.length ? (
          <Empty emoji="🕐" text="No activity yet" />
        ) : (
          <div className="timeline">
            {timeline.events.map((e) => (
              <div className="timeline-item" key={e.id}>
                <b>{ACTION_LABEL[e.action] || e.action}</b> · {e.userName}
                {e.viaOverride && <Badge color="plum">override</Badge>}
                <div className="muted">{fmtDateTime(e.at)}{e.reason ? ` — ${e.reason}` : ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal?.kind === 'submit' && (
        <PromptModal
          title="Submit this task" label="Note for the approver (optional)" placeholder="Anything they should know"
          confirmLabel={inst.requiresApproval ? 'Submit for approval' : 'Mark completed'} busy={act.isPending}
          onClose={() => setModal(null)} onConfirm={({ comment }) => run('submit', { comment }, inst.requiresApproval ? 'Sent for approval' : 'Completed')}
        />
      )}
      {modal?.kind === 'approve' && (
        <PromptModal
          title="Approve this task" label="Comment (optional)" placeholder="Nice work" confirmLabel="Approve" busy={act.isPending}
          onClose={() => setModal(null)} onConfirm={({ comment }) => run('approve', { comment }, 'Approved')}
        />
      )}
      {modal?.kind === 'reject' && (
        <PromptModal
          title="Send this back" label="What needs fixing?" placeholder="Be specific — they will see this" confirmLabel="Send back" busy={act.isPending}
          onClose={() => setModal(null)} onConfirm={({ comment }) => run('reject', { comment }, 'Sent back')}
        />
      )}
      {modal?.kind === 'defer' && (
        <PromptModal
          title="Defer this task" label="Reason *" placeholder="Why is it moving?" confirmLabel="Defer" extra="date" busy={act.isPending}
          maxDate={inst.can?.decide || !inst.selfDeferLimit ? undefined : inst.selfDeferLimit}
          note={inst.selfDeferLimit
            ? `You have until ${inst.selfDeferLimit} to finish this one, so you can move it within that window.`
            : 'Deferring someone else’s task is recorded against your name.'}
          onClose={() => setModal(null)} onConfirm={({ reason, to }) => run('defer', { reason, to }, 'Deferred')}
        />
      )}
      {modal?.kind === 'reassign' && (
        <ReassignModal inst={inst} busy={act.isPending} onClose={() => setModal(null)} onConfirm={(body) => run('reassign', body, 'Reassigned')} />
      )}
      {modal?.kind === 'cancel' && (
        <ConfirmDialog
          title="Cancel this occurrence?" message="It stays in the history with your name on it. The recurring task itself keeps running."
          confirmLabel="Cancel task" busy={act.isPending}
          onClose={() => setModal(null)} onConfirm={() => run('cancel', { reason: 'Cancelled from task detail' }, 'Cancelled')}
        />
      )}
    </div>
  )
}
