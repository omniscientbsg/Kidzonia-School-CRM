import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, Bell, Ban, Eye, Search } from 'lucide-react'
import { useGet, fmtMoney, fmtDate, fmtDateTime, todayISO } from '../../api/hooks'
import { api } from '../../api/client'
import { toPaise } from '../../services/fees/money'
import { Spinner, Empty, Badge, Field, Modal, ConfirmDialog } from '../../components/ui'
import { useStore } from '../../store/useStore'

const MANAGE = ['super_admin', 'branch_admin', 'accountant']

function CreateModal({ session, classes, groups, students, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ title: '', description: '', amount: '', dueDate: todayISO(), audType: 'class', ids: [], q: '' })
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))
  const [busy, setBusy] = useState(false)
  const toggleId = (id) => set('ids', f.ids.includes(id) ? f.ids.filter((x) => x !== id) : [...f.ids, id])
  const options = f.audType === 'class' ? classes : f.audType === 'group' ? groups : []
  const matches = f.audType === 'students' && f.q.trim() ? students.filter((s) => `${s.firstName} ${s.lastName}`.toLowerCase().includes(f.q.toLowerCase())).slice(0, 8) : []
  const name = (id) => students.find((s) => s.id === id)?.firstName + ' ' + (students.find((s) => s.id === id)?.lastName || '')

  async function save() {
    setBusy(true)
    try {
      const r = await api.post('/adhoc-fees', { sessionId: session.id, title: f.title.trim(), description: f.description.trim(), amount: toPaise(f.amount), dueDate: f.dueDate, audience: { type: f.audType, ids: f.ids } })
      toast.success(`Created — ${r.invoicesCreated} invoice${r.invoicesCreated === 1 ? '' : 's'} raised`)
      qc.invalidateQueries({ predicate: (q) => ['/adhoc-fees', '/invoices', '/fees'].some((p) => String(q.queryKey[0]).startsWith(p)) })
      onClose()
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title="Create ad-hoc fee" onClose={onClose} wide>
      <div className="form-row">
        <Field label="Title *"><input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Annual Day costume" autoFocus /></Field>
        <Field label="Amount (₹) *"><input type="number" min="0" value={f.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
      </div>
      <div className="form-row">
        <Field label="Due date *"><input type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></Field>
        <Field label="Audience"><select value={f.audType} onChange={(e) => { set('audType', e.target.value); set('ids', []) }}><option value="class">Class</option><option value="group">Group</option><option value="students">Selected students</option></select></Field>
      </div>
      <Field label="Description"><input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional" /></Field>

      <Field label={`Target (${f.ids.length} selected)`}>
        {f.audType === 'students' ? (
          <>
            <input value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Search students…" style={{ marginBottom: 8 }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {f.ids.map((id) => <button key={id} className="badge orange" style={{ border: 'none', cursor: 'pointer' }} onClick={() => toggleId(id)}>✓ {name(id)}</button>)}
              {matches.filter((s) => !f.ids.includes(s.id)).map((s) => <button key={s.id} className="badge gray" style={{ border: 'none', cursor: 'pointer' }} onClick={() => toggleId(s.id)}>{s.firstName} {s.lastName}</button>)}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {options.map((o) => <button key={o.id} className={`badge ${f.ids.includes(o.id) ? 'orange' : 'gray'}`} style={{ border: 'none', cursor: 'pointer' }} onClick={() => toggleId(o.id)}>{f.ids.includes(o.id) ? '✓ ' : ''}{o.name}</button>)}
            {options.length === 0 && <span className="muted" style={{ fontSize: 12.5 }}>None available.</span>}
          </div>
        )}
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !f.title.trim() || !(Number(f.amount) > 0) || f.ids.length === 0} onClick={save}>Create & raise invoices</button>
      </div>
    </Modal>
  )
}

function DetailModal({ id, onClose }) {
  const { data, isLoading } = useGet(`/adhoc-fees/${id}`)
  return (
    <Modal title={data?.title || 'Ad-hoc fee'} onClose={onClose} wide>
      {isLoading ? <Spinner /> : !data ? <Empty emoji="⚠️" text="Not found" /> : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <Badge color="orange">{fmtMoney(data.amount)}</Badge><Badge color="green">Collected {fmtMoney(data.collected)}</Badge><Badge color="red">Outstanding {fmtMoney(data.outstanding)}</Badge>
            <Badge color="gray">{data.paidCount}/{data.targeted} paid</Badge>
          </div>
          <div className="table-wrap" style={{ boxShadow: 'none' }}>
            <table><thead><tr><th>Student</th><th>Invoice</th><th>Amount</th><th>Paid</th><th>Status</th></tr></thead>
              <tbody>{data.students.map((s) => (
                <tr key={s.invoiceId}><td><b>{s.studentName}</b></td><td className="muted">{s.invoiceNumber}</td><td>{fmtMoney(s.amount)}</td><td className="muted">{fmtMoney(s.paid)}</td><td><Badge status={s.status}>{s.status}</Badge></td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  )
}

export default function AdhocFees() {
  const { user, activeSessionId } = useStore()
  const qc = useQueryClient()
  const canManage = MANAGE.includes(user.role)
  const { data: sessions = [] } = useGet('/academic-years')
  const session = sessions.find((s) => s.id === activeSessionId) || sessions.find((s) => s.active)
  const { data: classes = [] } = useGet('/classes')
  const { data: groups = [] } = useGet('/groups')
  const { data: students = [] } = useGet('/students')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState(null)
  const [cancel, setCancel] = useState(null)
  const [busy, setBusy] = useState(false)

  const qs = [session && `sessionId=${session.id}`, status && `status=${status}`, from && `from=${from}`, to && `to=${to}`, q && `q=${encodeURIComponent(q)}`].filter(Boolean).join('&')
  const { data: rows = [], isLoading } = useGet(`/adhoc-fees${qs ? `?${qs}` : ''}`)
  const sessionClasses = classes.filter((c) => c.academicYearId === session?.id && c.active !== false)
  const sessionGroups = groups.filter((g) => g.academicYearId === session?.id || !g.academicYearId)
  const refresh = () => qc.invalidateQueries({ predicate: (query) => ['/adhoc-fees', '/invoices', '/fees'].some((p) => String(query.queryKey[0]).startsWith(p)) })

  const audLabel = (a) => a.audience.type === 'class' ? a.audience.ids.map((id) => classes.find((c) => c.id === id)?.name || id).join(', ')
    : a.audience.type === 'group' ? a.audience.ids.map((id) => groups.find((g) => g.id === id)?.name || id).join(', ')
      : `${a.audience.ids.length} students`

  async function doRemind(id) {
    setBusy(true)
    try { const r = await api.post(`/adhoc-fees/${id}/remind`, {}); toast.success(`Reminded ${r.sent}`); refresh() }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  async function doCancel(id) {
    setBusy(true)
    try { const r = await api.post(`/adhoc-fees/${id}/cancel`, { reason: 'cancelled' }); toast.success(`Cancelled — ${r.cancelledInvoices} voided, ${r.keptPaid} paid kept`); setCancel(null); refresh() }
    catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  if (isLoading) return <Spinner />

  return (
    <div>
      <div className="page-head"><h1>Ad-hoc fees</h1><Badge color="orange">{session?.name || '—'}</Badge>
        <div className="spacer" />
        {canManage && <button className="btn" onClick={() => setCreating(true)}><Plus size={15} /> Create ad-hoc fee</button>}
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="filters">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title…" />
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="cancelled">Cancelled</option></select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><span className="muted">to</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn sm subtle"><Search size={13} /> Search</button>
        </div>
      </div>

      {rows.length === 0 ? <div className="card"><Empty emoji="🎟️" text="No ad-hoc fees" /></div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Title</th><th>Audience</th><th>Amount</th><th>Due</th><th>Progress</th><th>Status</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td><b>{a.title}</b>{a.description && <div className="muted" style={{ fontSize: 11 }}>{a.description}</div>}</td>
                  <td className="muted"><Badge color="plum">{a.audience.type}</Badge> {audLabel(a)}</td>
                  <td>{fmtMoney(a.amount)}</td>
                  <td className="muted">{fmtDate(a.dueDate)}</td>
                  <td><span className="muted" style={{ fontSize: 12.5 }}>{a.paidCount}/{a.targeted} paid · {fmtMoney(a.outstanding)} due</span></td>
                  <td><Badge color={a.status === 'cancelled' ? 'red' : 'green'}>{a.status}</Badge></td>
                  <td className="muted" style={{ fontSize: 12 }}>{fmtDateTime(a.createdAt)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn sm ghost" onClick={() => setDetail(a.id)}><Eye size={13} /></button>
                    {canManage && a.status === 'active' && <>
                      <button className="btn sm ghost" style={{ marginLeft: 6 }} disabled={busy || a.pendingCount === 0} onClick={() => doRemind(a.id)}><Bell size={13} /></button>
                      <button className="btn sm ghost" style={{ marginLeft: 6 }} onClick={() => setCancel(a)}><Ban size={13} /></button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <CreateModal session={session} classes={sessionClasses} groups={sessionGroups} students={students} onClose={() => setCreating(false)} />}
      {detail && <DetailModal id={detail} onClose={() => setDetail(null)} />}
      {cancel && <ConfirmDialog title={`Cancel “${cancel.title}”?`} message="Unpaid ad-hoc invoices are voided (ledger reversed). Already-paid ones are kept." confirmLabel="Cancel fee" busy={busy} onConfirm={() => doCancel(cancel.id)} onClose={() => setCancel(null)} />}
    </div>
  )
}
