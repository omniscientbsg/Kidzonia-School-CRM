import { useNavigate } from 'react-router-dom'
import { Camera, ShieldCheck, Lock, Repeat } from 'lucide-react'
import { Badge } from '../../components/ui'
import { PRIORITY_COLOR, dueLabel, daysLate, statusLabel, statusColor } from '../../services/tasks/status'
import { describeRecurrence } from '../../services/tasks/recurrence'
import Countdown from './Countdown'

// One occurrence, as it appears in every list. Clicking opens the detail page.
export default function TaskCard({ inst, today, showAssignee = false, actions = null }) {
  const navigate = useNavigate()
  const late = daysLate(inst, today)
  return (
    <div
      className="card"
      style={{ marginBottom: 10, cursor: 'pointer', borderLeft: `3px solid ${inst.status === 'overdue' ? 'var(--berry)' : inst.isBlocking ? 'var(--marmalade)' : 'transparent'}` }}
      onClick={() => navigate(`/tasks/instances/${inst.id}`)}
    >
      <div className="card-title" style={{ marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontFamily: 'var(--font-display)', fontSize: 14.5 }}>{inst.title}</b>
          <Badge color={statusColor(inst)}>{statusLabel(inst)}</Badge>
          {inst.priority !== 'normal' && <Badge color={PRIORITY_COLOR[inst.priority]}>{inst.priority}</Badge>}
          {inst.isBlocking && <Badge color="orange"><Lock size={10} style={{ verticalAlign: -1 }} /> blocks logout</Badge>}
        </div>
        {actions && <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>{actions}</div>}
      </div>
      <div className="muted" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>{dueLabel(inst, today)}{late > 0 ? ` · ${late} day${late > 1 ? 's' : ''} late` : ''}</span>
        <Countdown inst={inst} />
        {showAssignee && <span>· {inst.assigneeName} ({inst.assigneeTier}) · {inst.nodeName}</span>}
        {!showAssignee && inst.assignedByName && <span>· from {inst.assignedByName}</span>}
        {inst.requiresMedia && <span><Camera size={11} style={{ verticalAlign: -1 }} /> {inst.minAttachments} {inst.mediaTypes?.join('/')}</span>}
        {inst.requiresApproval && <span><ShieldCheck size={11} style={{ verticalAlign: -1 }} /> needs approval</span>}
        {inst.recurrence?.freq && inst.recurrence.freq !== 'none' && (
          <span><Repeat size={11} style={{ verticalAlign: -1 }} /> {describeRecurrence(inst.recurrence)}</span>
        )}
        {inst.categoryName && <span>· {inst.categoryName}</span>}
      </div>
      {inst.rejectionCount > 0 && !inst.submittedAt && inst.status !== 'approved' && inst.lastComment && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--berry)' }}>Sent back: {inst.lastComment}</div>
      )}
      {inst.status === 'deferred' && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--ink-soft)' }}>
          Deferred to {inst.deferredTo}{inst.deferReason ? ` — ${inst.deferReason}` : ''}
        </div>
      )}
    </div>
  )
}
