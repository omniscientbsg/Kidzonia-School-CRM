import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Bell, Search, AlertTriangle } from 'lucide-react'
import { useGet, fmtMoney, fmtDate, fmtDateTime } from '../../api/hooks'
import { api } from '../../api/client'
import { toPaise } from '../../services/fees/money'
import { Spinner, Empty, Badge, StatCard } from '../../components/ui'
import { useStore } from '../../store/useStore'

const CAN_SEND = ['super_admin', 'branch_admin', 'accountant']

export default function PendingDues() {
  const { user, activeSessionId } = useStore()
  const qc = useQueryClient()
  const canSend = CAN_SEND.includes(user.role)
  const { data: sessions = [] } = useGet('/academic-years')
  const session = sessions.find((s) => s.id === activeSessionId) || sessions.find((s) => s.active)
  const { data: classes = [] } = useGet('/classes')

  const [classIds, setClassIds] = useState([])
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [minAmt, setMinAmt] = useState('')
  const [notReminded, setNotReminded] = useState('')
  const [sel, setSel] = useState(new Set())
  const [busy, setBusy] = useState(false)

  const qs = [
    classIds.length && `classIds=${classIds.join(',')}`,
    overdueOnly && 'overdueOnly=true',
    minAmt && `minAmount=${toPaise(minAmt)}`,
    notReminded && `notRemindedDays=${notReminded}`,
  ].filter(Boolean).join('&')
  const { data, isLoading, isError, error, refetch } = useGet(`/fees/pending-dues${qs ? `?${qs}` : ''}`)

  const sessionClasses = classes.filter((c) => c.academicYearId === session?.id && c.active !== false)
  const toggleClass = (id) => setClassIds(classIds.includes(id) ? classIds.filter((x) => x !== id) : [...classIds, id])

  if (isLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load'} /></div>
  const rows = data.rows
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.invoiceId))
  const toggle = (id) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n) }
  const toggleAll = () => setSel(allSel ? new Set() : new Set(rows.map((r) => r.invoiceId)))

  async function send(ids) {
    if (ids.length === 0) return toast.error('Select invoices to remind')
    setBusy(true)
    try {
      const r = await api.post('/fees/reminders/send', { invoiceIds: ids })
      const chans = r.perInvoice[0]?.channels?.join(', ') || 'in-app'
      toast.success(`Sent ${r.sent} reminder${r.sent === 1 ? '' : 's'} via ${chans}`)
      setSel(new Set())
      qc.invalidateQueries({ predicate: (q) => ['/fees/pending-dues', '/notifications'].some((p) => String(q.queryKey[0]).startsWith(p)) })
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="page-head"><h1>Pending fees</h1><Badge color="orange">{session?.name || '—'}</Badge></div>

      <div className="stat-grid">
        <StatCard label="Total due" value={fmtMoney(data.summary.totalDue)} tone="red" />
        <StatCard label="Overdue" value={fmtMoney(data.summary.totalOverdue)} tone="yellow" />
        <StatCard label="Families with dues" value={data.summary.families} tone="blue" />
        <StatCard label="Open invoices" value={data.summary.invoices} tone="orange" />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {sessionClasses.map((c) => (
            <button key={c.id} type="button" onClick={() => toggleClass(c.id)} className={`badge ${classIds.includes(c.id) ? 'orange' : 'gray'}`} style={{ cursor: 'pointer', border: 'none' }}>{classIds.includes(c.id) ? '✓ ' : ''}{c.name}</button>
          ))}
        </div>
        <div className="filters">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only</label>
          <input type="number" min="0" placeholder="Min amount ₹" value={minAmt} onChange={(e) => setMinAmt(e.target.value)} style={{ width: 130 }} />
          <input type="number" min="0" placeholder="Not reminded in N days" value={notReminded} onChange={(e) => setNotReminded(e.target.value)} style={{ width: 180 }} />
          <button className="btn sm subtle" onClick={() => refetch()}><Search size={13} /> Search</button>
          <div className="spacer" style={{ flex: 1 }} />
          {canSend && <button className="btn" disabled={busy || sel.size === 0} onClick={() => send([...sel])}><Bell size={15} /> Send reminders ({sel.size})</button>}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card"><Empty emoji="✅" text="No pending dues match these filters" /></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {canSend && <th style={{ width: 34 }}><input type="checkbox" checked={allSel} onChange={toggleAll} /></th>}
                <th>Student</th><th>Class</th><th>Cycle</th><th>Due</th><th>Overdue</th><th>Balance</th><th>Last reminded</th>{canSend && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.invoiceId}>
                  {canSend && <td><input type="checkbox" checked={sel.has(r.invoiceId)} onChange={() => toggle(r.invoiceId)} /></td>}
                  <td><b>{r.studentName}</b> <span className="muted" style={{ fontSize: 11 }}>{r.number}</span></td>
                  <td className="muted">{r.className}</td>
                  <td><Badge color="gray">{r.cycleLabel}</Badge></td>
                  <td className="muted">{fmtDate(r.dueDate)}</td>
                  <td>{r.daysOverdue > 0 ? <span style={{ color: 'var(--berry)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}><AlertTriangle size={12} />{r.daysOverdue}d</span> : <span className="muted">—</span>}</td>
                  <td><b>{fmtMoney(r.balance)}</b></td>
                  <td className="muted" style={{ fontSize: 12 }}>{r.lastReminderAt ? `${fmtDateTime(r.lastReminderAt)} (${r.reminderCount})` : 'never'}</td>
                  {canSend && <td style={{ textAlign: 'right' }}><button className="btn sm ghost" disabled={busy} onClick={() => send([r.invoiceId])}><Bell size={12} /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
