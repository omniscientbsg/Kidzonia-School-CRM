import { useState } from 'react'
import { Plus, BellRing, Printer } from 'lucide-react'
import { useGet, useAct, fmtMoney, fmtDate, todayISO } from '../../api/hooks'
import { toPaise, fromPaise } from '../../services/fees/money'
import { Badge, Field, Modal, Spinner, Empty, StatCard } from '../../components/ui'

function GenerateModal({ onClose }) {
  const act = useAct(['/invoices', '/fees'])
  const { data: students = [] } = useGet('/students?status=active')
  const { data: structures = [] } = useGet('/fee-structures')
  const [studentId, setStudentId] = useState('')
  const [feeStructureId, setFeeStructureId] = useState('')
  const [month, setMonth] = useState(todayISO().slice(0, 7))
  const [count, setCount] = useState(1)

  function months() {
    const [y, m] = month.split('-').map(Number)
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(y, m - 1 + i, 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    })
  }

  return (
    <Modal title="Generate invoices" onClose={onClose}>
      <Field label="Student">
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">Choose student…</option>
          {students.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName} — {s.className} {s.sectionName}</option>)}
        </select>
      </Field>
      <Field label="Fee structure">
        <select value={feeStructureId} onChange={(e) => setFeeStructureId(e.target.value)}>
          <option value="">Choose structure…</option>
          {structures.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </Field>
      <div className="form-row">
        <Field label="Starting month"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <Field label="Number of months"><input type="number" min={1} max={12} value={count} onChange={(e) => setCount(Number(e.target.value))} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn" disabled={!studentId || !feeStructureId}
          onClick={() => act.mutate({ path: '/invoices/generate', body: { studentId, feeStructureId, months: months() }, success: `Generated ${count} invoice(s)` }, { onSuccess: onClose })}
        >
          Generate
        </button>
      </div>
    </Modal>
  )
}

function ReceiptView({ invoice, payment, onClose }) {
  return (
    <Modal onClose={onClose}>
      <div style={{ textAlign: 'center', borderBottom: '2px dashed var(--line)', paddingBottom: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 30 }}>🎒</div>
        <h2 style={{ margin: 0 }}>Kidzonia</h2>
        <div className="muted">Fee receipt (paperless)</div>
      </div>
      <table style={{ fontSize: 14 }}>
        <tbody>
          <tr><td className="muted">Receipt no.</td><td style={{ textAlign: 'right' }}><b>{payment.receipt?.number}</b></td></tr>
          <tr><td className="muted">Invoice</td><td style={{ textAlign: 'right' }}>{invoice.number}</td></tr>
          <tr><td className="muted">Student</td><td style={{ textAlign: 'right' }}>{invoice.studentName}</td></tr>
          <tr><td className="muted">Date</td><td style={{ textAlign: 'right' }}>{fmtDate(payment.updatedAt)}</td></tr>
          <tr><td className="muted">Mode</td><td style={{ textAlign: 'right', textTransform: 'capitalize' }}>{payment.mode}</td></tr>
          <tr><td className="muted" style={{ paddingTop: 10 }}>Amount received</td><td style={{ textAlign: 'right', paddingTop: 10 }}><b style={{ fontSize: 20, fontFamily: 'var(--font-display)' }}>{fmtMoney(payment.amount)}</b></td></tr>
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }} className="no-print">
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button>
      </div>
    </Modal>
  )
}

function InvoiceDrawer({ invoiceId, onClose }) {
  const { data: inv, isLoading } = useGet(`/invoices/${invoiceId}`)
  const act = useAct(['/invoices', '/fees', `/invoices/${invoiceId}`])
  const [payAmount, setPayAmount] = useState('')
  const [payMode, setPayMode] = useState('cash')
  const [receipt, setReceipt] = useState(null)
  const [discount, setDiscount] = useState(null)

  if (isLoading || !inv) return <Modal onClose={onClose}><Spinner /></Modal>
  const balance = inv.total - inv.paidAmount

  return (
    <Modal title={`${inv.number} — ${inv.studentName}`} onClose={onClose} wide>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <Badge status={inv.status} />
        <span className="muted">Due {fmtDate(inv.dueDate)}</span>
        <div className="spacer" style={{ flex: 1 }} />
        <b style={{ fontSize: 18, fontFamily: 'var(--font-display)' }}>{fmtMoney(inv.total)}</b>
      </div>
      <table style={{ fontSize: 13.5, marginBottom: 14 }}>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={i}><td>{l.description}</td><td style={{ textAlign: 'right' }}>{fmtMoney(l.amount)}</td></tr>
          ))}
          {inv.discountTotal > 0 && <tr><td style={{ color: 'var(--teal)' }}>Discounts</td><td style={{ textAlign: 'right', color: 'var(--teal)' }}>-{fmtMoney(inv.discountTotal)}</td></tr>}
          <tr><td><b>Paid</b></td><td style={{ textAlign: 'right' }}><b>{fmtMoney(inv.paidAmount)}</b></td></tr>
          <tr><td><b>Balance</b></td><td style={{ textAlign: 'right' }}><b style={{ color: balance > 0 ? 'var(--berry)' : 'var(--teal)' }}>{fmtMoney(balance)}</b></td></tr>
        </tbody>
      </table>

      {inv.payments.length > 0 && (
        <>
          <h3 style={{ marginBottom: 6 }}>Payments</h3>
          {inv.payments.map((p) => (
            <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f4efe6', fontSize: 13 }}>
              <Badge status={p.status} />
              <span style={{ textTransform: 'capitalize' }}>{p.mode}</span>
              <span className="muted">{fmtDate(p.updatedAt)}</span>
              <span style={{ flex: 1 }} />
              <b>{fmtMoney(p.amount)}</b>
              {p.receipt && <button className="btn sm subtle" onClick={() => setReceipt(p)}>{p.receipt.number}</button>}
            </div>
          ))}
        </>
      )}

      {balance > 0 && inv.status !== 'cancelled' && (
        <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Record payment (₹)">
            <input type="number" placeholder={fromPaise(balance)} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} style={{ width: 130 }} />
          </Field>
          <Field label="Mode">
            <select value={payMode} onChange={(e) => setPayMode(e.target.value)}>
              <option>cash</option><option>cheque</option><option>pos</option>
            </select>
          </Field>
          <button
            className="btn teal" style={{ marginBottom: 13 }}
            onClick={() => act.mutate(
              { path: '/payments/offline', body: { invoiceId: inv.id, amount: payAmount ? toPaise(payAmount) : balance, mode: payMode }, success: 'Payment recorded — receipt issued' },
              { onSuccess: (data) => setReceipt({ ...data.payment, receipt: data.receipt }) }
            )}
          >
            Collect {fmtMoney(payAmount ? toPaise(payAmount) : balance)}
          </button>
          <button
            className="btn ghost" style={{ marginBottom: 13 }}
            onClick={() => setDiscount({ name: '', amount: 0 })}
          >
            Add discount
          </button>
          {inv.paidAmount === 0 && (
            <button className="btn danger" style={{ marginBottom: 13 }} onClick={() => act.mutate({ path: `/invoices/${inv.id}/cancel`, success: 'Invoice cancelled' }, { onSuccess: onClose })}>
              Cancel invoice
            </button>
          )}
        </div>
      )}

      {discount && (
        <div style={{ marginTop: 10, padding: 12, background: 'var(--sun-soft)', borderRadius: 10 }}>
          <div className="form-row-3">
            <Field label="Discount name"><input value={discount.name} onChange={(e) => setDiscount({ ...discount, name: e.target.value })} placeholder="e.g. Sibling 10%" /></Field>
            <Field label="Amount (₹)"><input type="number" value={discount.amount} onChange={(e) => setDiscount({ ...discount, amount: Number(e.target.value) })} /></Field>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, paddingBottom: 13 }}>
              <button
                className="btn sm"
                onClick={() => act.mutate(
                  { path: '/discounts', body: { studentId: inv.studentId, invoiceId: inv.id, name: discount.name, amount: toPaise(discount.amount), reason: discount.name }, success: 'Discount created (pending approval)' },
                  { onSuccess: (d) => { act.mutate({ path: `/discounts/${d.id}/decide`, body: { status: 'approved' }, success: 'Discount approved & applied' }); setDiscount(null) } }
                )}
                disabled={!discount.name || !discount.amount}
              >
                Apply
              </button>
              <button className="btn sm ghost" onClick={() => setDiscount(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {receipt && <ReceiptView invoice={inv} payment={receipt} onClose={() => setReceipt(null)} />}
    </Modal>
  )
}

export default function Invoices() {
  const { data: invoices = [], isLoading } = useGet('/invoices')
  const { data: outstanding } = useGet('/fees/reports/outstanding')
  const act = useAct(['/invoices'])
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState(null)
  const [generating, setGenerating] = useState(false)

  if (isLoading) return <Spinner />
  const filtered = status ? invoices.filter((i) => i.status === status) : invoices

  return (
    <div>
      <div className="page-head">
        <h1>Invoices & dues</h1>
        <div className="spacer" />
        <div className="filters">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['pending', 'partial', 'paid', 'overdue', 'cancelled'].map((s) => <option key={s}>{s}</option>)}
          </select>
          <button
            className="btn subtle"
            onClick={() => act.mutate({ path: '/fees/send-reminders', success: 'Reminders sent to guardians with open dues' })}
          >
            <BellRing size={15} /> Send reminders
          </button>
          <button className="btn" onClick={() => setGenerating(true)}><Plus size={15} /> Generate</button>
        </div>
      </div>

      {outstanding && (
        <div className="stat-grid">
          <StatCard label="Total outstanding" value={fmtMoney(outstanding.totalDue)} tone="red" />
          <StatCard label="Overdue" value={fmtMoney(outstanding.totalOverdue)} tone="yellow" />
          <StatCard label="Families with dues" value={outstanding.rows.length} tone="blue" />
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead><tr><th>Invoice</th><th>Student</th><th>Due date</th><th>Total</th><th>Paid</th><th>Status</th></tr></thead>
          <tbody>
            {filtered.map((inv) => (
              <tr key={inv.id} className="clickable" onClick={() => setOpen(inv.id)}>
                <td><b>{inv.number}</b></td>
                <td>{inv.studentName}</td>
                <td>{fmtDate(inv.dueDate)}</td>
                <td>{fmtMoney(inv.total)}</td>
                <td>{fmtMoney(inv.paidAmount)}</td>
                <td><Badge status={inv.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <Empty emoji="🧾" text="No invoices match" />}
      </div>

      {open && <InvoiceDrawer invoiceId={open} onClose={() => setOpen(null)} />}
      {generating && <GenerateModal onClose={() => setGenerating(false)} />}
    </div>
  )
}
