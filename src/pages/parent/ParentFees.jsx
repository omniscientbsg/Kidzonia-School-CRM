import { useState } from 'react'
import { CreditCard, Printer, CheckCircle, XCircle } from 'lucide-react'
import { useGet, useAct, fmtMoney, fmtDate } from '../../api/hooks'
import { api } from '../../api/client'
import { Spinner, Empty, Badge, Modal } from '../../components/ui'
import { useStore } from '../../store/useStore'

function ReceiptView({ invoice, payment, onClose }) {
  return (
    <Modal onClose={onClose}>
      <div style={{ textAlign: 'center', borderBottom: '2px dashed var(--line)', paddingBottom: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 30 }}>🎒</div>
        <h2 style={{ margin: 0 }}>Kidzonia</h2>
        <div className="muted">Fee receipt</div>
      </div>
      <table style={{ fontSize: 14, width: '100%' }}>
        <tbody>
          <tr><td className="muted">Receipt no.</td><td style={{ textAlign: 'right' }}><b>{payment.receipt?.number}</b></td></tr>
          <tr><td className="muted">Invoice</td><td style={{ textAlign: 'right' }}>{invoice.number}</td></tr>
          <tr><td className="muted">Student</td><td style={{ textAlign: 'right' }}>{invoice.studentName}</td></tr>
          <tr><td className="muted">Date</td><td style={{ textAlign: 'right' }}>{fmtDate(payment.updatedAt)}</td></tr>
          <tr><td className="muted">Mode</td><td style={{ textAlign: 'right', textTransform: 'capitalize' }}>{payment.mode}</td></tr>
          <tr><td className="muted" style={{ paddingTop: 10 }}>Amount</td><td style={{ textAlign: 'right', paddingTop: 10 }}><b style={{ fontSize: 20, fontFamily: 'var(--font-display)' }}>{fmtMoney(payment.amount)}</b></td></tr>
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }} className="no-print">
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn" onClick={() => window.print()}><Printer size={14} /> Print</button>
      </div>
    </Modal>
  )
}

function PayModal({ invoice, onClose, onSuccess }) {
  const [mode, setMode] = useState('upi')
  const [step, setStep] = useState('choose') // choose | processing | result
  const [result, setResult] = useState(null)

  async function pay(outcome) {
    setStep('processing')
    try {
      const init = await api.post('/payments/initiate', { invoiceId: invoice.id, amount: invoice.total - invoice.paidAmount })
      const res = await api.post('/payments/mock-gateway/complete', { gatewayRef: init.gatewayRef, outcome })
      setResult(res)
      setStep('result')
      if (outcome === 'success') onSuccess?.(res)
    } catch (err) {
      setResult({ error: err.message })
      setStep('result')
    }
  }

  return (
    <Modal title={`Pay ${invoice.number}`} onClose={onClose}>
      {step === 'choose' && (
        <>
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <div style={{ fontSize: 36, fontFamily: 'var(--font-display)', fontWeight: 800 }}>{fmtMoney(invoice.total - invoice.paidAmount)}</div>
            <div className="muted">Balance due</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 18 }}>
            {['upi', 'card', 'netbanking'].map((m) => (
              <button key={m} className={`btn sm ${mode === m ? '' : 'ghost'}`} onClick={() => setMode(m)} style={{ textTransform: 'capitalize' }}>{m}</button>
            ))}
          </div>
          <div className="muted" style={{ textAlign: 'center', marginBottom: 14, fontSize: 12 }}>
            This is a simulated payment gateway for demo purposes.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button className="btn" onClick={() => pay('success')}>
              <CheckCircle size={14} /> Simulate success
            </button>
            <button className="btn danger" onClick={() => pay('failure')}>
              <XCircle size={14} /> Simulate failure
            </button>
          </div>
        </>
      )}
      {step === 'processing' && (
        <div style={{ textAlign: 'center', padding: 30 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>⏳</div>
          <div>Processing payment…</div>
        </div>
      )}
      {step === 'result' && (
        <div style={{ textAlign: 'center', padding: 20 }}>
          {result?.receipt ? (
            <>
              <div style={{ fontSize: 50, marginBottom: 8 }}>✅</div>
              <h2 style={{ color: 'var(--teal)' }}>Payment successful!</h2>
              <div className="muted" style={{ marginBottom: 16 }}>Receipt: {result.receipt.number}</div>
              <button className="btn" onClick={onClose}>Done</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 50, marginBottom: 8 }}>❌</div>
              <h2 style={{ color: 'var(--berry)' }}>Payment failed</h2>
              <div className="muted" style={{ marginBottom: 16 }}>{result?.error || 'Transaction was not completed.'}</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn" onClick={() => setStep('choose')}>Retry</button>
                <button className="btn ghost" onClick={onClose}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}

export default function ParentFees() {
  const { activeChildId } = useStore()
  const { data: invoices = [], isLoading, refetch } = useGet('/parent/invoices')
  const [paying, setPaying] = useState(null)
  const [receipt, setReceipt] = useState(null)

  if (!activeChildId) return <Spinner />

  const childInvoices = invoices.filter((i) => i.studentId === activeChildId)
  const totalDue = childInvoices.filter((i) => ['pending', 'partial', 'overdue'].includes(i.status)).reduce((s, i) => s + (i.total - i.paidAmount), 0)

  return (
    <div>
      <h2 style={{ marginBottom: 14 }}>Fees</h2>

      <div className="card" style={{ textAlign: 'center', marginBottom: 18, background: totalDue > 0 ? 'var(--berry-soft)' : 'var(--teal-soft)' }}>
        <div className="muted" style={{ marginBottom: 4 }}>Total due</div>
        <div style={{ fontSize: 28, fontFamily: 'var(--font-display)', fontWeight: 800, color: totalDue > 0 ? 'var(--berry)' : 'var(--teal)' }}>{fmtMoney(totalDue)}</div>
      </div>

      {isLoading && <Spinner />}
      {childInvoices.length === 0 && <Empty emoji="🧾" text="No invoices" />}
      {childInvoices.map((inv) => {
        const balance = inv.total - inv.paidAmount
        return (
          <div className="card" key={inv.id} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <b>{inv.number}</b>
                <div className="muted">Due {fmtDate(inv.dueDate)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 18, fontFamily: 'var(--font-display)', fontWeight: 800 }}>{fmtMoney(inv.total)}</div>
                <Badge status={inv.status} />
              </div>
            </div>
            {inv.lines.map((l, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', borderBottom: '1px solid #f4efe6' }}>
                <span>{l.description}</span><span>{fmtMoney(l.amount)}</span>
              </div>
            ))}
            {inv.paidAmount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', color: 'var(--teal)' }}><span>Paid</span><span>{fmtMoney(inv.paidAmount)}</span></div>}

            {inv.payments?.filter((p) => p.status === 'success').map((p) => (
              <div key={p.id} style={{ marginTop: 4 }}>
                {p.receipt && (
                  <button className="btn sm subtle" style={{ fontSize: 11 }} onClick={() => setReceipt({ inv, payment: p })}>
                    <Printer size={12} /> {p.receipt.number}
                  </button>
                )}
              </div>
            ))}

            {balance > 0 && inv.status !== 'cancelled' && (
              <button className="btn" style={{ width: '100%', marginTop: 12, justifyContent: 'center' }} onClick={() => setPaying(inv)}>
                <CreditCard size={15} /> Pay {fmtMoney(balance)}
              </button>
            )}
          </div>
        )
      })}

      {paying && <PayModal invoice={paying} onClose={() => { setPaying(null); refetch() }} onSuccess={() => refetch()} />}
      {receipt && <ReceiptView invoice={receipt.inv} payment={receipt.payment} onClose={() => setReceipt(null)} />}
    </div>
  )
}
