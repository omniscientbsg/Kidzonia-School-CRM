import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useGet, useAct, fmtDate } from '../../api/hooks'
import { Spinner, Empty, Badge, Field, Modal } from '../../components/ui'
import { useStore } from '../../store/useStore'

function LeaveModal({ children, onClose }) {
  const act = useAct(['/parent/leave-requests'])
  const [studentId, setStudentId] = useState(children[0]?.id || '')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [reason, setReason] = useState('')

  return (
    <Modal title="Submit leave request" onClose={onClose}>
      {children.length > 1 && (
        <Field label="Child">
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            {children.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
          </select>
        </Field>
      )}
      <div className="form-row">
        <Field label="From"><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></Field>
      </div>
      <Field label="Reason"><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Family function, medical…" /></Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!fromDate || !toDate || !reason.trim()} onClick={() => act.mutate(
          { path: '/parent/leave-requests', body: { studentId, fromDate, toDate, reason: reason.trim() }, success: 'Leave request submitted' },
          { onSuccess: onClose }
        )}>Submit</button>
      </div>
    </Modal>
  )
}

export default function ParentLeave() {
  const { activeChildId } = useStore()
  const { data: children = [] } = useGet('/parent/children')
  const { data: requests = [], isLoading } = useGet('/parent/leave-requests')
  const [creating, setCreating] = useState(false)

  if (!activeChildId) return <Spinner />

  const childRequests = requests.filter((r) => r.studentId === activeChildId)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2>Leave Requests</h2>
        <button className="btn sm" onClick={() => setCreating(true)}><Plus size={14} /> Apply</button>
      </div>

      {isLoading && <Spinner />}
      {childRequests.length === 0 && <Empty emoji="🏖️" text="No leave requests" />}
      {childRequests.map((lr) => (
        <div className="card" key={lr.id} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <b>{fmtDate(lr.fromDate)} → {fmtDate(lr.toDate)}</b>
              <div className="muted">{lr.reason}</div>
            </div>
            <Badge status={lr.status} />
          </div>
        </div>
      ))}

      {creating && <LeaveModal children={children} onClose={() => setCreating(false)} />}
    </div>
  )
}
