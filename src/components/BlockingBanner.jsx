import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, ArrowRight, LifeBuoy } from 'lucide-react'
import { Modal, Field, Badge } from './ui'
import { useLogoutCheck, useTaskAct } from '../services/tasks/api'
import { dueLabel } from '../services/tasks/status'

// Persistent, non-punitive banner. It sits above every page while mandatory
// work is outstanding, so the first time anyone learns about it is NOT when
// they try to leave. Quick links go straight to the task.
export default function BlockingBanner() {
  const navigate = useNavigate()
  const { data: gate } = useLogoutCheck()
  const act = useTaskAct()
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')

  if (!gate?.blocked && !gate?.released) return null

  const n = gate.instances?.length || 0

  if (gate.released) {
    return (
      <div className="card" style={{ background: 'var(--teal-soft)', margin: '0 0 16px', boxShadow: 'none' }}>
        <span style={{ fontSize: 13.5, color: 'var(--teal)' }}>
          <b>{gate.release.by} released you for today</b> — {gate.release.reason}. You can sign off; {n} task{n > 1 ? 's stay' : ' stays'} on your list.
        </span>
      </div>
    )
  }

  return (
    <div className="card" style={{ background: 'var(--marmalade-soft)', margin: '0 0 16px', boxShadow: 'none' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Lock size={17} style={{ color: 'var(--marmalade-deep)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <b style={{ color: 'var(--marmalade-deep)', fontSize: 14 }}>
            You have {n} task{n > 1 ? 's' : ''} to finish before signing off
          </b>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            {gate.instances.map((i) => (
              <button
                key={i.id}
                onClick={() => navigate(`/tasks/instances/${i.id}`)}
                style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                  fontSize: 13, color: 'var(--marmalade-deep)',
                }}
              >
                <ArrowRight size={13} />
                <span style={{ textDecoration: 'underline' }}>{i.title}</span>
                <span style={{ opacity: 0.75 }}>· {dueLabel(i)}</span>
                {i.requiresApproval && <Badge color="yellow">needs sign-off</Badge>}
                {i.rejectionCount > 0 && <Badge color="red">sent back</Badge>}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--marmalade-deep)', opacity: 0.85, marginTop: 8 }}>
            Submitting is enough — you do not have to wait for approval. Something come up?{' '}
            <button
              onClick={() => setAsking(true)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textDecoration: 'underline', font: 'inherit' }}
            >
              Ask your manager to release you
            </button>
            .
          </div>
        </div>
      </div>

      {asking && (
        <Modal title="Ask to be released for today" onClose={() => setAsking(false)}>
          <p className="muted" style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
            Everyone above you in the org chart is notified. They can release you or move the task —
            you are not stuck waiting for one person.
          </p>
          <Field label="What has come up? *">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="e.g. Unwell, leaving early — will finish first thing tomorrow" />
          </Field>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setAsking(false)}>Cancel</button>
            <button
              className="btn"
              disabled={!reason.trim() || act.isPending}
              onClick={() => act.mutate(
                { path: '/tasks/gate/request-release', body: { reason }, success: 'Your manager has been notified' },
                { onSuccess: () => { setAsking(false); setReason('') } },
              )}
            >
              <LifeBuoy size={13} /> Send request
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
