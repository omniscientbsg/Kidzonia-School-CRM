import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Search, Receipt, Printer, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { useGet, fmtMoney, fmtDate, todayISO, initials } from '../../api/hooks'
import { api } from '../../api/client'
import { toPaise, fromPaise } from '../../services/fees/money'
import { Spinner, Empty, Badge, Field, Modal } from '../../components/ui'
import { useStore } from '../../store/useStore'

const CAN_CLEAR = ['super_admin', 'branch_admin', 'accountant']
const MODES = [['cash', 'Cash'], ['cheque', 'Cheque'], ['neft', 'NEFT / Bank transfer'], ['gateway', 'Gateway']]

function printReceipt(r, student) {
  const w = window.open('', '_blank'); if (!w) return
  const rows = (r.payment.allocations || []).map((a) => `<tr><td>${a.invoiceId}</td><td style="text-align:right">${fmtMoney(a.amount)}</td></tr>`).join('')
  w.document.write(`<html><head><title>${r.receipt.number}</title><style>body{font-family:system-ui,Arial;padding:32px;color:#2b2b2b}h2{margin:0}table{border-collapse:collapse;width:100%;margin-top:12px;font-size:14px}td,th{border-bottom:1px solid #eee;padding:6px 4px;text-align:left}.tot{font-size:22px;font-weight:800;font-family:Georgia,serif}</style></head><body>
    <h2>Kidzonia — Fee Receipt</h2><div style="color:#888">Receipt ${r.receipt.number} · ${fmtDate(r.payment.date)}</div>
    <p>Received from <b>${student}</b> — ${MODES.find((m) => m[0] === r.payment.mode)?.[1] || r.payment.mode}${r.payment.reference?.chequeNo ? ` (cheque ${r.payment.reference.chequeNo})` : r.payment.reference?.utr ? ` (UTR ${r.payment.reference.utr})` : ''}</p>
    <table><thead><tr><th>Invoice</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="tot">Total ${fmtMoney(r.payment.amount)}</p>${r.advance > 0 ? `<p style="color:#12907e">Advance / credit: ${fmtMoney(r.advance)}</p>` : ''}
    <scr`+`ipt>window.onload=function(){window.print()}</scr`+`ipt></body></html>`)
  w.document.close()
}

function CollectPanel({ student, sessionName }) {
  const qc = useQueryClient()
  const { data: invoices = [], isLoading } = useGet(`/invoices?studentId=${student.id}`)
  const [alloc, setAlloc] = useState({}) // invoiceId -> paise
  const [mode, setMode] = useState('cash')
  const [amount, setAmount] = useState('') // rupees string; '' => auto (sum of allocations)
  const [date, setDate] = useState(todayISO())
  const [ref, setRef] = useState({ chequeNo: '', bank: '', utr: '' })
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState(null)

  if (isLoading) return <Spinner />
  const open = invoices.filter((i) => ['pending', 'partial', 'overdue'].includes(i.status))
  const allocSum = Object.values(alloc).reduce((s, v) => s + (v || 0), 0)
  const tendered = amount === '' ? allocSum : toPaise(amount)

  function toggleInv(inv) {
    setAlloc((a) => { const n = { ...a }; if (n[inv.id] != null) delete n[inv.id]; else n[inv.id] = inv.total - inv.paidAmount; return n })
  }

  async function collect() {
    const allocations = Object.entries(alloc).filter(([, v]) => v > 0).map(([invoiceId, amt]) => ({ invoiceId, amount: amt }))
    if (allocations.length === 0) return toast.error('Select at least one invoice')
    setBusy(true)
    try {
      const r = await api.post('/payments/collect', { studentId: student.id, mode, amount: tendered, date, reference: ref, allocations })
      qc.invalidateQueries({ predicate: (q) => ['/invoices', '/students', '/payments', '/fees'].some((p) => String(q.queryKey[0]).startsWith(p)) })
      setAlloc({}); setAmount('')
      if (mode === 'cheque') toast.success('Cheque recorded — pending clearance')
      else { setReceipt(r); toast.success(`Receipt ${r.receipt.number} issued`) }
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-title"><h3>Open invoices · {student.firstName} {student.lastName}</h3><Badge color="orange">{sessionName}</Badge></div>
      {open.length === 0 ? <Empty emoji="✅" text="No open dues" /> : (
        <div className="table-wrap" style={{ boxShadow: 'none' }}>
          <table>
            <thead><tr><th style={{ width: 34 }}></th><th>Invoice</th><th>Due</th><th>Balance</th><th>Pay now (₹)</th></tr></thead>
            <tbody>
              {open.map((inv) => {
                const bal = inv.total - inv.paidAmount
                const on = alloc[inv.id] != null
                return (
                  <tr key={inv.id}>
                    <td><input type="checkbox" checked={on} onChange={() => toggleInv(inv)} /></td>
                    <td><b>{inv.number}</b> <Badge status={inv.status}>{inv.status}</Badge></td>
                    <td className="muted">{fmtDate(inv.dueDate)}</td>
                    <td>{fmtMoney(bal)}</td>
                    <td><input type="number" min="0" disabled={!on} style={{ width: 110 }} value={on ? fromPaise(alloc[inv.id]) : ''} onChange={(e) => setAlloc((a) => ({ ...a, [inv.id]: Math.min(toPaise(e.target.value), bal) }))} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {open.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <div className="form-row-3">
            <Field label="Mode"><select value={mode} onChange={(e) => setMode(e.target.value)}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Amount tendered (₹)"><input type="number" min="0" placeholder={fromPaise(allocSum)} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          {mode === 'cheque' && (
            <div className="form-row"><Field label="Cheque no."><input value={ref.chequeNo} onChange={(e) => setRef({ ...ref, chequeNo: e.target.value })} /></Field><Field label="Bank"><input value={ref.bank} onChange={(e) => setRef({ ...ref, bank: e.target.value })} /></Field></div>
          )}
          {(mode === 'neft' || mode === 'gateway') && <Field label="Reference / UTR"><input value={ref.utr} onChange={(e) => setRef({ ...ref, utr: e.target.value })} /></Field>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
            <div className="muted" style={{ fontSize: 13 }}>Allocating <b>{fmtMoney(allocSum)}</b>{tendered > allocSum && <> · advance {fmtMoney(tendered - allocSum)}</>}</div>
            <div className="spacer" style={{ flex: 1 }} />
            <button className="btn" disabled={busy || allocSum === 0 || tendered < allocSum} onClick={collect}><Receipt size={15} /> {mode === 'cheque' ? 'Record cheque' : `Collect ${fmtMoney(tendered)}`}</button>
          </div>
          {tendered < allocSum && <div style={{ color: 'var(--berry)', fontSize: 12.5, textAlign: 'right', marginTop: 4 }}>Amount tendered is less than allocated.</div>}
        </div>
      )}

      {receipt && (
        <Modal title={`Receipt ${receipt.receipt.number}`} onClose={() => setReceipt(null)}>
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <CheckCircle2 size={40} style={{ color: 'var(--teal)' }} />
            <div style={{ fontSize: 26, fontFamily: 'var(--font-display)', fontWeight: 800, marginTop: 6 }}>{fmtMoney(receipt.payment.amount)}</div>
            <div className="muted">collected from {student.firstName} {student.lastName}{receipt.advance > 0 && ` · advance ${fmtMoney(receipt.advance)}`}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn ghost" onClick={() => setReceipt(null)}>Close</button>
            <button className="btn" onClick={() => printReceipt(receipt, `${student.firstName} ${student.lastName}`)}><Printer size={14} /> Print receipt</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function PendingCheques() {
  const { user } = useStore()
  const qc = useQueryClient()
  const canClear = CAN_CLEAR.includes(user.role)
  const { data: cheques = [], isLoading } = useGet('/payments/pending-cheques')
  const [busy, setBusy] = useState(false)
  const refresh = () => qc.invalidateQueries({ predicate: (q) => ['/payments', '/invoices', '/fees'].some((p) => String(q.queryKey[0]).startsWith(p)) })
  async function act(id, kind) {
    setBusy(true)
    try {
      if (kind === 'clear') { const r = await api.post(`/payments/${id}/clear`, {}); toast.success(`Cleared — ${r.receipt.number}`) }
      else { await api.post(`/payments/${id}/bounce`, { reason: 'Cheque bounced' }); toast.success('Marked bounced') }
      refresh()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  if (isLoading) return null
  if (cheques.length === 0) return null
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-title"><h3><Clock size={15} style={{ verticalAlign: 'middle', marginRight: 6, opacity: 0.6 }} />Pending cheques ({cheques.length})</h3></div>
      <div className="table-wrap" style={{ boxShadow: 'none' }}>
        <table>
          <thead><tr><th>Student</th><th>Cheque</th><th>Amount</th>{canClear && <th></th>}</tr></thead>
          <tbody>
            {cheques.map((c) => (
              <tr key={c.id}>
                <td><b>{c.studentName}</b></td>
                <td className="muted">{c.reference?.chequeNo || '—'}{c.reference?.bank ? ` · ${c.reference.bank}` : ''}</td>
                <td>{fmtMoney(c.amount)}</td>
                {canClear && (
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn sm subtle" disabled={busy} onClick={() => act(c.id, 'clear')}><CheckCircle2 size={13} /> Clear</button>
                    <button className="btn sm ghost" style={{ marginLeft: 6 }} disabled={busy} onClick={() => act(c.id, 'bounce')}><XCircle size={13} /> Bounce</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function CollectFees() {
  const { activeSessionId } = useStore()
  const { data: sessions = [] } = useGet('/academic-years')
  const session = sessions.find((s) => s.id === activeSessionId) || sessions.find((s) => s.active)
  const { data: students = [], isLoading } = useGet('/students')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)

  if (isLoading) return <Spinner />
  const matches = q.trim() ? students.filter((s) => `${s.firstName} ${s.lastName}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : []

  return (
    <div>
      <div className="page-head"><h1>Collect fees</h1><Badge color="orange">{session?.name || '—'}</Badge></div>
      <div className="card">
        <div className="card-title"><h3>Create transaction</h3></div>
        <div className="filters"><Search size={15} style={{ opacity: 0.5 }} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search student paying at school / NEFT…" style={{ minWidth: 280 }} /></div>
        {matches.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {matches.map((s) => (
              <button key={s.id} className="btn sm ghost" onClick={() => { setSelected(s); setQ('') }}>
                <span style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--marmalade-soft)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: 'var(--marmalade-deep)', marginRight: 6 }}>{initials(`${s.firstName} ${s.lastName}`)}</span>
                {s.firstName} {s.lastName}
              </button>
            ))}
          </div>
        )}
      </div>
      {selected && <CollectPanel student={selected} sessionName={session?.name} />}
      <PendingCheques />
    </div>
  )
}
