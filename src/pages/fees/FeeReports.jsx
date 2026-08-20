import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Download, FileSpreadsheet, FileText, Search } from 'lucide-react'
import { useGet, fmtMoney, fmtDate, todayISO, initials } from '../../api/hooks'
import { fromPaise } from '../../services/fees/money'
import { exportXLSX, exportPDF } from '../../lib/export'
import { Spinner, Empty, Badge, StatCard } from '../../components/ui'
import { useStore } from '../../store/useStore'

const TABS = [['daybook', 'Daybook'], ['outstanding', 'Outstanding'], ['collections', 'Collections'], ['ledger', 'Student Ledger'], ['transactions', 'Payment Transactions'], ['detailed', 'Detailed Fee Report']]
const shortDate = (d) => d.slice(8, 10) + '/' + d.slice(5, 7)

// export helpers: xlsx wants numbers (rupees), pdf wants ₹ strings
function ExportButtons({ title, columns, rows, moneyKeys = [] }) {
  const xlsxRows = rows.map((r) => { const o = { ...r }; for (const k of moneyKeys) o[k] = fromPaise(r[k]); return o })
  const pdfRows = rows.map((r) => { const o = { ...r }; for (const k of moneyKeys) o[k] = fmtMoney(r[k]); return o })
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button className="btn sm ghost" disabled={!rows.length} onClick={() => exportXLSX(title.replace(/\s+/g, '_'), columns, xlsxRows)}><FileSpreadsheet size={13} /> Excel</button>
      <button className="btn sm ghost" disabled={!rows.length} onClick={() => exportPDF(title, columns, pdfRows)}><FileText size={13} /> PDF</button>
    </div>
  )
}

function StudentPicker({ onPick, placeholder }) {
  const { data: students = [] } = useGet('/students')
  const [q, setQ] = useState('')
  const matches = q.trim() ? students.filter((s) => `${s.firstName} ${s.lastName}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : []
  return (
    <div>
      <div className="filters"><Search size={15} style={{ opacity: 0.5 }} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} style={{ minWidth: 260 }} /></div>
      {matches.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {matches.map((s) => (
            <button key={s.id} className="btn sm ghost" onClick={() => { onPick(s); setQ('') }}>
              <span style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--marmalade-soft)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: 'var(--marmalade-deep)', marginRight: 6 }}>{initials(`${s.firstName} ${s.lastName}`)}</span>
              {s.firstName} {s.lastName}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------- Student Ledger ----------------
function LedgerTab() {
  const [student, setStudent] = useState(null)
  const { data, isLoading } = useGet(student ? `/fees/reports/student-ledger?studentId=${student.id}` : '/health', { enabled: !!student })
  const cols = [{ key: 'date', label: 'Date' }, { key: 'type', label: 'Type' }, { key: 'description', label: 'Description' }, { key: 'ref', label: 'Reference' }, { key: 'amount', label: 'Amount' }, { key: 'balanceAfter', label: 'Balance' }]
  const rows = (data?.rows || []).map((r) => ({ ...r, date: fmtDate(r.date), ref: r.ref || '—' }))
  return (
    <div className="card">
      <div className="card-title"><h3>Student ledger</h3>{student && data && <ExportButtons title={`Ledger ${student.firstName} ${student.lastName}`} columns={cols} rows={rows} moneyKeys={['amount', 'balanceAfter']} />}</div>
      <StudentPicker onPick={setStudent} placeholder="Search student for ledger…" />
      {student && (isLoading ? <Spinner /> : data ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <b style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>{data.student.name}</b>
            <Badge color={data.closingBalance > 0 ? 'red' : 'green'}>{data.closingBalance > 0 ? `Owes ${fmtMoney(data.closingBalance)}` : data.closingBalance < 0 ? `Credit ${fmtMoney(-data.closingBalance)}` : 'Settled'}</Badge>
          </div>
          <div className="table-wrap" style={{ boxShadow: 'none' }}>
            <table>
              <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Ref</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
              <tbody>
                {data.rows.map((e, i) => (
                  <tr key={i}>
                    <td className="muted">{fmtDate(e.date)}</td>
                    <td><Badge color={e.amount < 0 ? 'green' : 'gray'}>{e.type}</Badge></td>
                    <td>{e.description}</td><td className="muted">{e.ref || '—'}</td>
                    <td style={{ textAlign: 'right', color: e.amount < 0 ? 'var(--teal)' : 'inherit' }}>{e.amount < 0 ? '−' : ''}{fmtMoney(Math.abs(e.amount))}</td>
                    <td style={{ textAlign: 'right' }}><b>{fmtMoney(e.balanceAfter)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.rows.length === 0 && <Empty emoji="📄" text="No ledger entries" />}
          </div>
        </div>
      ) : null)}
    </div>
  )
}

// ---------------- Payment Transactions ----------------
function TransactionsTab({ sessionId }) {
  const [f, setF] = useState({ studentName: '', mode: '', from: todayISO().slice(0, 8) + '01', to: todayISO(), status: '', dateType: 'collection' })
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))
  const qs = new URLSearchParams({ studentName: f.studentName, mode: f.mode, from: f.from, to: f.to, status: f.status, dateType: f.dateType, sessionId: sessionId || '' }).toString()
  const { data, isLoading } = useGet(`/fees/reports/transactions?${qs}`)
  const cols = [{ key: 'studentName', label: 'Name' }, { key: 'mode', label: 'Mode' }, { key: 'date', label: 'Date' }, { key: 'statusLabel', label: 'Status' }, { key: 'amount', label: 'Amount' }]
  const rows = (data?.rows || []).map((r) => ({ ...r }))
  return (
    <div className="card">
      <div className="card-title"><h3>Payment transactions</h3>{data && <ExportButtons title="Payment Transactions" columns={cols} rows={rows} moneyKeys={['amount']} />}</div>
      <div className="filters" style={{ flexWrap: 'wrap', gap: 8 }}>
        <input placeholder="Student name" value={f.studentName} onChange={(e) => set('studentName', e.target.value)} />
        <select value={f.mode} onChange={(e) => set('mode', e.target.value)}><option value="">All modes</option>{['cash', 'cheque', 'neft', 'gateway', 'pos'].map((m) => <option key={m} value={m}>{m}</option>)}</select>
        <select value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">All statuses</option>{[['success', 'Completed'], ['pending_clearance', 'Pending clearance'], ['failed', 'Failed'], ['bounced', 'Bounced']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select value={f.dateType} onChange={(e) => set('dateType', e.target.value)}><option value="collection">Collection date</option><option value="clearance">Cheque-clearance date</option></select>
        <input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /><span className="muted">to</span><input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} />
      </div>
      {isLoading ? <Spinner /> : (
        <>
          <div style={{ margin: '10px 0' }}><Badge color="green">Completed total {fmtMoney(data.total)}</Badge> <Badge color="gray">{data.count} txns</Badge></div>
          <div className="table-wrap" style={{ boxShadow: 'none' }}>
            <table>
              <thead><tr><th>Name</th><th>Mode</th><th>Date</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.studentName}</b>{r.chequeNo && <span className="muted" style={{ fontSize: 11 }}> · chq {r.chequeNo}</span>}</td>
                    <td style={{ textTransform: 'capitalize' }}>{r.mode}</td>
                    <td className="muted">{fmtDate(r.date)}{r.status === 'success' && r.clearanceDate && r.clearanceDate !== r.collectionDate ? ` (cleared)` : ''}</td>
                    <td><Badge status={r.status === 'success' ? 'success' : r.status === 'failed' || r.status === 'bounced' ? 'failed' : 'initiated'}>{r.statusLabel}</Badge></td>
                    <td style={{ textAlign: 'right' }}><b>{fmtMoney(r.amount)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.rows.length === 0 && <Empty emoji="🧾" text="No transactions match" />}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------- Detailed Fee Report ----------------
function DetailedTab({ sessionId, classes }) {
  const [f, setF] = useState({ studentName: '', classIds: [], cycle: '', status: '', showCancelled: false })
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))
  const qs = new URLSearchParams({ sessionId: sessionId || '', studentName: f.studentName, classIds: f.classIds.join(','), cycle: f.cycle, status: f.status, showCancelled: String(f.showCancelled) }).toString()
  const { data, isLoading } = useGet(`/fees/reports/detailed?${qs}`)
  const cols = [{ key: 'studentName', label: 'Student' }, { key: 'cycle', label: 'Cycle' }, { key: 'totalFees', label: 'Total Fees' }, { key: 'paid', label: 'Paid' }, { key: 'lateFees', label: 'Late Fees' }, { key: 'payable', label: 'Payable' }, { key: 'status', label: 'Status' }]
  const toggleClass = (id) => set('classIds', f.classIds.includes(id) ? f.classIds.filter((x) => x !== id) : [...f.classIds, id])
  const STATUS_COLOR = { estimated: 'gray', approved: 'orange', paid: 'green', cancelled: 'red' }
  return (
    <div className="card">
      <div className="card-title"><h3>Detailed fee report</h3>{data && <ExportButtons title="Detailed Fee Report" columns={cols} rows={data.rows} moneyKeys={['totalFees', 'paid', 'lateFees', 'payable']} />}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {classes.map((c) => <button key={c.id} type="button" onClick={() => toggleClass(c.id)} className={`badge ${f.classIds.includes(c.id) ? 'orange' : 'gray'}`} style={{ cursor: 'pointer', border: 'none' }}>{f.classIds.includes(c.id) ? '✓ ' : ''}{c.name}</button>)}
      </div>
      <div className="filters" style={{ flexWrap: 'wrap' }}>
        <input placeholder="Child name" value={f.studentName} onChange={(e) => set('studentName', e.target.value)} />
        <input placeholder="Cycle e.g. 2026-08" value={f.cycle} onChange={(e) => set('cycle', e.target.value)} style={{ width: 150 }} />
        <select value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">All statuses</option>{[['estimated', 'Estimated'], ['approved', 'Approved'], ['paid', 'Paid'], ['cancelled', 'Cancelled']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><input type="checkbox" checked={f.showCancelled} onChange={(e) => set('showCancelled', e.target.checked)} /> Show cancelled</label>
      </div>
      {isLoading ? <Spinner /> : (
        <>
          <div className="stat-grid" style={{ marginTop: 12 }}>
            <StatCard label="Total fees" value={fmtMoney(data.summary.totalFees)} tone="orange" />
            <StatCard label="Total paid" value={fmtMoney(data.summary.totalPaid)} tone="green" />
            <StatCard label="Total payable" value={fmtMoney(data.summary.totalPayable)} tone="red" />
            <StatCard label="Late fees" value={fmtMoney(data.summary.totalLateFees)} tone="yellow" />
            <StatCard label="Records" value={data.summary.recordCount} tone="blue" />
          </div>
          <div className="table-wrap" style={{ boxShadow: 'none' }}>
            <table>
              <thead><tr><th>Student</th><th>Cycle</th><th>Total fees</th><th>Paid</th><th>Late</th><th>Payable</th><th>Status</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key}>
                    <td><b>{r.studentName}</b></td><td><Badge color="gray">{r.cycle}</Badge></td>
                    <td>{fmtMoney(r.totalFees)}</td><td className="muted">{fmtMoney(r.paid)}</td><td className="muted">{r.lateFees ? fmtMoney(r.lateFees) : '—'}</td>
                    <td><b>{fmtMoney(r.payable)}</b></td><td><Badge color={STATUS_COLOR[r.status]}>{r.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.rows.length === 0 && <Empty emoji="📊" text="No records match" />}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------- Collections (existing + chart) ----------------
function CollectionsTab() {
  const [from, setFrom] = useState(todayISO().slice(0, 8) + '01')
  const [to, setTo] = useState(todayISO())
  const { data: collections, isLoading } = useGet(`/fees/reports/collections?from=${from}&to=${to}`)
  const { data: series } = useGet(`/fees/reports/collections-series?from=${from}&to=${to}`)
  const chart = (series?.series || []).map((p) => ({ date: p.date, amount: fromPaise(p.amount) }))
  return (
    <div className="card">
      <div className="card-title"><h3>Collections</h3>
        <div className="filters"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><span className="muted">to</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {isLoading ? <Spinner /> : (
        <>
          {chart.length > 0 && (
            <div style={{ height: 200, marginBottom: 16 }}>
              <ResponsiveContainer>
                <BarChart data={chart} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10.5 }} interval="preserveStartEnd" minTickGap={20} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `₹${v.toLocaleString('en-IN')}`} labelFormatter={shortDate} cursor={{ fill: 'rgba(244,119,46,0.07)' }} />
                  <Bar dataKey="amount" fill="#12907e" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="two-col">
            <div>
              <h3 style={{ marginBottom: 8 }}>By mode</h3>
              <table style={{ fontSize: 13.5 }}><tbody>
                {Object.entries(collections.byMode).map(([mode, amt]) => <tr key={mode}><td style={{ textTransform: 'capitalize' }}>{mode}</td><td style={{ textAlign: 'right' }}><b>{fmtMoney(amt)}</b></td></tr>)}
                <tr style={{ borderTop: '2px solid var(--line)' }}><td><b>Total ({collections.count} payments)</b></td><td style={{ textAlign: 'right' }}><b>{fmtMoney(collections.total)}</b></td></tr>
              </tbody></table>
            </div>
            <div>
              <h3 style={{ marginBottom: 8 }}>By fee head</h3>
              <table style={{ fontSize: 13.5 }}><tbody>
                {Object.entries(collections.byHead).map(([head, amt]) => <tr key={head}><td>{head}</td><td style={{ textAlign: 'right' }}><b>{fmtMoney(amt)}</b></td></tr>)}
              </tbody></table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function FeeReports() {
  const { activeSessionId } = useStore()
  const { data: sessions = [] } = useGet('/academic-years')
  const session = sessions.find((s) => s.id === activeSessionId) || sessions.find((s) => s.active)
  const { data: classes = [] } = useGet('/classes')
  const sessionClasses = classes.filter((c) => c.academicYearId === session?.id && c.active !== false)
  const [tab, setTab] = useState('daybook')
  const [date, setDate] = useState(todayISO())
  const { data: daybook, isLoading: l1 } = useGet(tab === 'daybook' ? `/fees/reports/daybook?date=${date}` : '/health')
  const { data: outstanding, isLoading: l2 } = useGet(tab === 'outstanding' ? '/fees/reports/outstanding' : '/health')

  const dayCols = [{ key: 'receiptNumber', label: 'Receipt' }, { key: 'invoiceNumber', label: 'Invoice' }, { key: 'studentName', label: 'Student' }, { key: 'mode', label: 'Mode' }, { key: 'amount', label: 'Amount' }]
  const outCols = [{ key: 'studentName', label: 'Student' }, { key: 'invoices', label: 'Open invoices' }, { key: 'due', label: 'Due' }, { key: 'overdue', label: 'Overdue' }]

  return (
    <div>
      <div className="page-head"><h1>Finance reports</h1><Badge color="orange">{session?.name || '—'}</Badge></div>
      <div className="tabs">
        {TABS.map(([v, l]) => <button key={v} className={`tab ${tab === v ? 'active' : ''}`} onClick={() => setTab(v)}>{l}</button>)}
      </div>

      {tab === 'daybook' && (
        <div className="card">
          <div className="card-title"><h3>Day book — {fmtDate(date)}</h3>
            <div className="filters"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} />{daybook && <ExportButtons title={`Daybook ${date}`} columns={dayCols} rows={daybook.rows} moneyKeys={['amount']} />}</div>
          </div>
          {l1 ? <Spinner /> : daybook && (
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}><Badge color="green">Total {fmtMoney(daybook.total)}</Badge>{Object.entries(daybook.byMode).map(([m, a]) => <Badge key={m} color="gray">{m}: {fmtMoney(a)}</Badge>)}</div>
              <div className="table-wrap" style={{ boxShadow: 'none' }}>
                <table><thead><tr><th>Receipt</th><th>Invoice</th><th>Student</th><th>Mode</th><th>Amount</th></tr></thead>
                  <tbody>{daybook.rows.map((r) => <tr key={r.id}><td><b>{r.receiptNumber}</b></td><td>{r.invoiceNumber}</td><td>{r.studentName}</td><td style={{ textTransform: 'capitalize' }}>{r.mode}</td><td>{fmtMoney(r.amount)}</td></tr>)}</tbody>
                </table>
                {daybook.rows.length === 0 && <Empty emoji="📒" text="No collections on this date" />}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'outstanding' && (
        <div className="card">
          <div className="card-title"><h3>Outstanding dues</h3>{outstanding && <ExportButtons title="Outstanding" columns={outCols} rows={outstanding.rows} moneyKeys={['due', 'overdue']} />}</div>
          {l2 ? <Spinner /> : outstanding && (
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}><Badge color="red">Total due {fmtMoney(outstanding.totalDue)}</Badge><Badge color="yellow">Overdue {fmtMoney(outstanding.totalOverdue)}</Badge></div>
              <div className="table-wrap" style={{ boxShadow: 'none' }}>
                <table><thead><tr><th>Student</th><th>Open invoices</th><th>Due</th><th>Of which overdue</th></tr></thead>
                  <tbody>{outstanding.rows.map((r) => <tr key={r.studentId}><td><b>{r.studentName}</b></td><td>{r.invoices}</td><td>{fmtMoney(r.due)}</td><td style={{ color: r.overdue ? 'var(--berry)' : 'inherit' }}>{fmtMoney(r.overdue)}</td></tr>)}</tbody>
                </table>
                {outstanding.rows.length === 0 && <Empty emoji="🎉" text="No outstanding dues" />}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'collections' && <CollectionsTab />}
      {tab === 'ledger' && <LedgerTab />}
      {tab === 'transactions' && <TransactionsTab sessionId={session?.id} />}
      {tab === 'detailed' && <DetailedTab sessionId={session?.id} classes={sessionClasses} />}
    </div>
  )
}
