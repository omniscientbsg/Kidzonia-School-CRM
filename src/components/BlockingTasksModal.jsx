import { useNavigate } from 'react-router-dom'
import { Lock, ArrowRight } from 'lucide-react'
import { Modal, Badge } from './ui'
import { STATUS_LABEL, STATUS_COLOR, dueLabel } from '../services/tasks/status'

// Shown when the server refuses a logout (409 blocking_tasks) or when the API
// has frozen writes because yesterday's mandatory work is still open.
// The list comes from the server — the client never decides what blocks.
export default function BlockingTasksModal({ instances = [], armed = false, onClose }) {
  const navigate = useNavigate()
  const go = (id) => { onClose(); navigate(`/tasks/instances/${id}`) }

  return (
    <Modal title={armed ? 'Mandatory tasks are overdue' : 'Finish these before you log out'} onClose={onClose}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14 }}>
        <Lock size={18} style={{ color: 'var(--marmalade-deep)', flexShrink: 0, marginTop: 2 }} />
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-soft)' }}>
          {armed
            ? 'Until these are finished (or your senior defers them), the rest of the app is read-only for you.'
            : 'These were marked mandatory by whoever assigned them. Submitting is enough — you do not have to wait for approval.'}
        </p>
      </div>

      {instances.map((i) => (
        <div key={i.id} className="card" style={{ marginBottom: 8, boxShadow: 'none', cursor: 'pointer' }} onClick={() => go(i.id)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 13.5 }}>{i.title}</b>
            <Badge color={STATUS_COLOR[i.status]}>{STATUS_LABEL[i.status]}</Badge>
            <div className="spacer" style={{ flex: 1 }} />
            <ArrowRight size={14} style={{ color: 'var(--ink-faint)' }} />
          </div>
          <div className="muted">
            {dueLabel(i)} · for {i.serviceDate}{i.assignedByName ? ` · from ${i.assignedByName}` : ''}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn ghost" onClick={onClose}>Not now</button>
        <button className="btn" onClick={() => { onClose(); navigate('/tasks') }}>Open my tasks</button>
      </div>
    </Modal>
  )
}
