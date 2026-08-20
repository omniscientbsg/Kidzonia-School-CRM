import { useState } from 'react'
import { Unlock, CalendarClock, Lock } from 'lucide-react'
import { Spinner, Empty, Badge, Modal, Field } from '../../components/ui'
import { useBlockedUsers, useTaskAct } from '../../services/tasks/api'
import { dueLabel } from '../../services/tasks/status'

// The safety valve, made discoverable. Anyone with people below them can see
// who is held at the door and let them go — always with a reason, always audited.
export default function Blocked() {
  const { data: rows = [], isLoading, isError, error } = useBlockedUsers()
  const act = useTaskAct()
  const [modal, setModal] = useState(null)
  const [reason, setReason] = useState('')

  if (isLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load'} /></div>
  if (!rows.length) return <div className="card"><Empty emoji="🔓" text="Nobody below you is held up by a mandatory task" /></div>

  const close = () => { setModal(null); setReason('') }

  return (
    <div>
      <p className="muted" style={{ marginBottom: 14 }}>
        These people cannot sign off until their mandatory work is done. You can release someone for
        today — the task stays on their list for tomorrow — or defer the task itself from its page.
        Both are recorded against your name.
      </p>

      {rows.map((r) => (
        <div className="card" key={r.userId}>
          <div className="card-title" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <b style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>{r.userName}</b>
              <span className="muted">{r.tier} · {r.nodeName}</span>
              {r.released
                ? <Badge color="green">released today</Badge>
                : r.armed
                  ? <Badge color="red"><Lock size={10} style={{ verticalAlign: -1 }} /> writes frozen</Badge>
                  : <Badge color="yellow">logout blocked</Badge>}
            </div>
            {!r.released && (
              <button className="btn sm subtle" onClick={() => setModal({ userId: r.userId, name: r.userName, count: r.instances.length })}>
                <Unlock size={12} /> Release for today
              </button>
            )}
          </div>

          {r.released && (
            <div className="muted" style={{ marginBottom: 8 }}>
              Released by {r.release.by} — {r.release.reason}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {r.instances.map((i) => (
              <div key={i.id} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <CalendarClock size={12} style={{ color: 'var(--ink-faint)' }} />
                <a href={`/tasks/instances/${i.id}`}>{i.title}</a>
                <span className="muted">{dueLabel(i)}</span>
                {i.rejectionCount > 0 && <Badge color="red">sent back</Badge>}
                {i.requiresApproval && <Badge color="yellow">needs sign-off</Badge>}
              </div>
            ))}
          </div>
        </div>
      ))}

      {modal && (
        <Modal title={`Release ${modal.name} for today`} onClose={close}>
          <p className="muted" style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
            {modal.count} mandatory task{modal.count > 1 ? 's' : ''} stay{modal.count > 1 ? '' : 's'} on their list —
            this only lifts the sign-off lock for today, and they are told who released them.
          </p>
          <Field label="Reason *">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="e.g. Sent home unwell; will pick this up tomorrow" />
          </Field>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={close}>Cancel</button>
            <button
              className="btn"
              disabled={!reason.trim() || act.isPending}
              onClick={() => act.mutate(
                { path: '/tasks/gate/release', body: { userId: modal.userId, reason }, success: `${modal.name} can sign off` },
                { onSuccess: close },
              )}
            >
              <Unlock size={13} /> Release
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
