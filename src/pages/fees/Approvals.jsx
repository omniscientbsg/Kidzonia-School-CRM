import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useGet, fmtMoney, fmtDate } from '../../api/hooks'
import { api } from '../../api/client'
import { Spinner, Empty, Badge, Field, Modal } from '../../components/ui'
import { useStore } from '../../store/useStore'

const MANAGE = ['super_admin', 'branch_admin', 'accountant']

export default function Approvals() {
  const { user, activeSessionId } = useStore()
  const qc = useQueryClient()
  const canManage = MANAGE.includes(user.role)
  const { data: sessions = [] } = useGet('/academic-years')
  const session = sessions.find((s) => s.id === activeSessionId) || sessions.find((s) => s.active)
  const { data: classes = [] } = useGet('/classes')
  const [classId, setClassId] = useState('')
  const path = session ? `/fee-cycles?academicYearId=${session.id}&status=estimated${classId ? `&classId=${classId}` : ''}` : '/health'
  const { data: cycles = [], isLoading, isError, error } = useGet(path)
  const [sel, setSel] = useState(new Set())
  const [cancelling, setCancelling] = useState(false)
  const [busy, setBusy] = useState(false)

  if (isLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load'} /></div>

  const sessionClasses = classes.filter((c) => c.academicYearId === session?.id)
  const className = (id) => classes.find((c) => c.id === id)?.name || '—'
  const shown = cycles
  const allSel = shown.length > 0 && shown.every((c) => sel.has(c.id))
  const toggle = (id) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n) }
  const toggleAll = () => setSel(allSel ? new Set() : new Set(shown.map((c) => c.id)))
  const refresh = () => qc.invalidateQueries({ predicate: (q) => ['/fee-cycles', '/invoices', '/ledger'].some((p) => String(q.queryKey[0]).startsWith(p)) })

  async function approve() {
    setBusy(true)
    try {
      const r = await api.post('/fee-cycles/approve', { cycleIds: [...sel] })
      toast.success(`Approved ${r.approved.length}${r.skipped.length ? `, ${r.skipped.length} skipped` : ''} — invoices raised`)
      setSel(new Set()); refresh()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  async function doCancel(reason) {
    setBusy(true)
    try {
      const r = await api.post('/fee-cycles/cancel', { cycleIds: [...sel], reason })
      if (r.blocked.length) toast.error(`${r.blocked.length} blocked (${r.blocked[0].reason})`)
      if (r.cancelled.length) toast.success(`Cancelled ${r.cancelled.length}`)
      setSel(new Set()); setCancelling(false); refresh()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  const selTotal = shown.filter((c) => sel.has(c.id)).reduce((s, c) => s + c.total, 0)

  return (
    <div>
      <div className="page-head">
        <h1>Approval requests</h1><Badge color="orange">{session?.name || '—'}</Badge>
        <div className="spacer" />
        <div className="filters">
          <select value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">All classes</option>
            {sessionClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {canManage && sel.size > 0 && (
        <div className="card" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <b>{sel.size} selected · {fmtMoney(selTotal)}</b>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" disabled={busy} onClick={approve}><CheckCircle2 size={15} /> Approve → invoice</button>
          <button className="btn danger" disabled={busy} onClick={() => setCancelling(true)}><XCircle size={15} /> Cancel</button>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="card"><Empty emoji="✅" text="No estimated cycles pending approval" /></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {canManage && <th style={{ width: 34 }}><input type="checkbox" checked={allSel} onChange={toggleAll} /></th>}
                <th>Student</th><th>Class</th><th>Cycle</th><th>Due</th><th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} style={{ cursor: canManage ? 'pointer' : 'default' }} onClick={() => canManage && toggle(c.id)}>
                  {canManage && <td><input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} onClick={(e) => e.stopPropagation()} /></td>}
                  <td><b>{c.studentName}</b></td>
                  <td className="muted">{className(c.classId)}</td>
                  <td><Badge color="gray">{c.cycleLabel}</Badge></td>
                  <td className="muted">{fmtDate(c.dueDate)}</td>
                  <td style={{ textAlign: 'right' }}><b>{fmtMoney(c.total)}</b>{c.discountTotal > 0 && <div className="muted" style={{ fontSize: 11 }}>gross {fmtMoney(c.gross)}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cancelling && <CancelModal count={sel.size} busy={busy} onConfirm={doCancel} onClose={() => setCancelling(false)} />}
    </div>
  )
}

function CancelModal({ count, busy, onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  return (
    <Modal title={`Cancel ${count} cycle${count === 1 ? '' : 's'}?`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Estimated cycles are voided. Any already-invoiced ones are cancelled too — but cycles whose invoice has payments are blocked (refund first).</p>
      <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. generated in error" autoFocus /></Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Back</button>
        <button className="btn danger" disabled={busy} onClick={() => onConfirm(reason)}>Cancel cycles</button>
      </div>
    </Modal>
  )
}
