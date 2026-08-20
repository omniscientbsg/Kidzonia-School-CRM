import { useState } from 'react'
import * as XLSX from 'xlsx'
import toast from 'react-hot-toast'
import { Search, RotateCcw, Plus, Trash2, Undo2, Download, Upload, AlertTriangle, Save } from 'lucide-react'
import { useGet, useAct, fmtMoney, initials } from '../../api/hooks'
import { api } from '../../api/client'
import { toPaise, fromPaise } from '../../services/fees/money'
import { annualise, CYCLE_LABEL, CYCLES } from '../../services/fees/estimate'
import { Spinner, Empty, Badge, Modal } from '../../components/ui'
import { useStore } from '../../store/useStore'

const MANAGE = ['super_admin', 'branch_admin', 'accountant']
const SRC_BADGE = { default: null, overridden: ['orange', 'changed'], added: ['green', 'added'], removed: ['red', 'removed'] }

// ---------------- Per-student override editor ----------------
function StudentEditor({ studentId, sessionId, canManage }) {
  const { data, isLoading } = useGet(`/student-fees/${studentId}?sessionId=${sessionId}`)
  if (isLoading) return <Spinner />
  if (!data) return <div className="card"><Empty emoji="🧾" text="No fee data" /></div>
  return <EditorInner key={studentId + sessionId} payload={data} studentId={studentId} sessionId={sessionId} canManage={canManage} />
}

function EditorInner({ payload, studentId, sessionId, canManage }) {
  const act = useAct(['/student-fees', '/class-fees'])
  const { data: heads = [] } = useGet('/fee-heads')
  const classByHead = Object.fromEntries((payload.classLines || []).map((l) => [l.feeHeadId, l]))
  const [rows, setRows] = useState(() => payload.effective.map((l) => ({ feeHeadId: l.feeHeadId, name: l.name, amount: l.amount, cycle: l.cycle, removed: l.source === 'removed', added: l.source === 'added' })))

  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const addLine = () => {
    const used = new Set(rows.map((r) => r.feeHeadId))
    const h = heads.find((x) => !used.has(x.id))
    if (!h) return toast.error('All fee heads already listed')
    setRows([...rows, { feeHeadId: h.id, name: h.name, amount: 0, cycle: h.periodicity || 'monthly', removed: false, added: true }])
  }

  const est = annualise(rows.filter((r) => !r.removed))
  const diffCount = rows.filter((r) => {
    if (r.added) return true
    if (r.removed) return true
    const base = classByHead[r.feeHeadId]
    return base && (base.amount !== r.amount || base.cycle !== r.cycle)
  }).length

  function save() {
    const removedHeadIds = rows.filter((r) => r.removed && classByHead[r.feeHeadId]).map((r) => r.feeHeadId)
    const lines = rows.filter((r) => !r.removed).filter((r) => {
      const base = classByHead[r.feeHeadId]
      return !base || base.amount !== r.amount || base.cycle !== r.cycle
    }).map((r) => ({ feeHeadId: r.feeHeadId, amount: r.amount, cycle: r.cycle }))
    act.mutate({ method: 'put', path: `/student-fees/${studentId}`, body: { sessionId, lines, removedHeadIds }, success: 'Fee structure saved' })
  }
  function reset() {
    act.mutate({ method: 'put', path: `/student-fees/${studentId}`, body: { sessionId, lines: [], removedHeadIds: [] }, success: 'Reset to class default' })
  }

  return (
    <div className="card">
      <div className="card-title">
        <h3>Effective fee structure {payload.hasOverride ? <Badge color="orange">customised</Badge> : <Badge color="gray">class default</Badge>}</h3>
        <Badge color="green">{fmtMoney(est.annualTotal)}/yr</Badge>
      </div>
      {!payload.structureId && <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>No class structure for this student's class/session — add lines directly.</div>}
      <div className="table-wrap" style={{ boxShadow: 'none' }}>
        <table>
          <thead><tr><th>Fee head</th><th>Amount (₹)</th><th>Cycle</th><th>Status</th>{canManage && <th></th>}</tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const base = classByHead[r.feeHeadId]
              const changed = !r.added && !r.removed && base && (base.amount !== r.amount || base.cycle !== r.cycle)
              const badge = r.removed ? SRC_BADGE.removed : r.added ? SRC_BADGE.added : changed ? SRC_BADGE.overridden : null
              return (
                <tr key={i} style={r.removed ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                  <td><b>{r.name || heads.find((h) => h.id === r.feeHeadId)?.name}</b></td>
                  <td>
                    <input type="number" min="0" value={fromPaise(r.amount)} disabled={!canManage || r.removed}
                      onChange={(e) => set(i, 'amount', toPaise(e.target.value))} style={{ width: 110 }} />
                    {changed && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>was {fmtMoney(base.amount)}</span>}
                  </td>
                  <td>
                    <select value={r.cycle} disabled={!canManage || r.removed} onChange={(e) => set(i, 'cycle', e.target.value)}>
                      {CYCLES.map((c) => <option key={c} value={c}>{CYCLE_LABEL[c]}</option>)}
                    </select>
                  </td>
                  <td>{badge ? <Badge color={badge[0]}>{badge[1]}</Badge> : <span className="muted">default</span>}</td>
                  {canManage && (
                    <td style={{ textAlign: 'right' }}>
                      {r.added || !base
                        ? <button className="icon-btn" title="Remove line" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                        : r.removed
                          ? <button className="icon-btn" title="Restore" onClick={() => set(i, 'removed', false)}><Undo2 size={14} /></button>
                          : <button className="icon-btn" title="Remove for this student" onClick={() => set(i, 'removed', true)}><Trash2 size={14} /></button>}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {canManage && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button className="btn sm ghost" onClick={addLine}><Plus size={13} /> Add line</button>
          <div className="spacer" style={{ flex: 1 }} />
          {payload.hasOverride && <button className="btn sm ghost" onClick={reset}><RotateCcw size={13} /> Reset to class default</button>}
          <button className="btn" disabled={act.isPending} onClick={save}><Save size={14} /> Save {diffCount > 0 ? `(${diffCount} change${diffCount === 1 ? '' : 's'})` : ''}</button>
        </div>
      )}
    </div>
  )
}

// ---------------- Discounts + net fee (concession/corporate/group) ----------------
function StudentDiscounts({ studentId, sessionId, canManage }) {
  const { data, isLoading } = useGet(`/students/${studentId}/fee-preview?sessionId=${sessionId}`)
  const { data: concessions = [] } = useGet(`/concessions?sessionId=${sessionId}`)
  const { data: corporates = [] } = useGet('/corporates')
  const act = useAct(['/students', '/student-fees', '/fee-preview'])
  if (isLoading) return <Spinner />
  if (!data) return null
  const anyDiscount = data.totals.totalDiscount > 0 || data.totals.groupCharge > 0
  const assign = (path, body) => act.mutate({ method: 'put', path, body: { sessionId, ...body } })

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-title">
        <h3>Discounts & net payable</h3>
        <Badge color="green">{fmtMoney(data.totals.annualNet)}/yr net</Badge>
      </div>
      {canManage && (
        <div className="form-row" style={{ marginBottom: 12 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Concession {data.concession?.source === 'auto' && <span className="muted">(auto from category)</span>}</label>
            <select value={data.concession?.source === 'assigned' ? data.concession.id : ''} onChange={(e) => assign(`/students/${studentId}/concession`, { concessionId: e.target.value || null })}>
              <option value="">{data.concession?.source === 'auto' ? `Auto: ${data.concession.category}` : '— none —'}</option>
              {concessions.map((c) => <option key={c.id} value={c.id}>{c.category}{c.category === 'Custom' ? ` · ${c.name}` : ''}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Corporate tie-up</label>
            <select value={data.corporate?.id || ''} onChange={(e) => assign(`/students/${studentId}/corporate`, { corporateId: e.target.value || null })}>
              <option value="">— none —</option>
              {corporates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {data.concession && <Badge color="green">Concession: {data.concession.category}</Badge>}
        {data.corporate && <Badge color="orange">Corporate: {data.corporate.name}</Badge>}
        {data.groups.map((g) => <Badge key={g.id} color="plum">Group: {g.name}</Badge>)}
        {!data.concession && !data.corporate && data.groups.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No discounts apply.</span>}
      </div>
      {anyDiscount && (
        <div className="table-wrap" style={{ boxShadow: 'none' }}>
          <table>
            <thead><tr><th>Fee head</th><th>Base</th><th>Concession</th><th>Corporate</th><th>Group</th><th>Net</th></tr></thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.feeHeadId}>
                  <td><b>{l.name}</b></td>
                  <td className="muted">{fmtMoney(l.base)}</td>
                  <td style={{ color: l.concession ? 'var(--teal)' : 'inherit' }}>{l.concession ? `−${fmtMoney(l.concession)}` : '—'}</td>
                  <td style={{ color: l.corporate ? 'var(--teal)' : 'inherit' }}>{l.corporate ? `−${fmtMoney(l.corporate)}` : '—'}</td>
                  <td style={{ color: l.groupCharge ? 'var(--berry)' : l.groupDiscount ? 'var(--teal)' : 'inherit' }}>{l.groupCharge ? `+${fmtMoney(l.groupCharge)}` : l.groupDiscount ? `−${fmtMoney(l.groupDiscount)}` : '—'}</td>
                  <td><b>{fmtMoney(l.net)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Precedence: concession → corporate → group. Annual gross {fmtMoney(data.totals.annualGross)} · discount {fmtMoney(data.totals.annualDiscount)}.</div>
    </div>
  )
}

// ---------------- Bulk Excel round-trip ----------------
function BulkExcel({ sessionId, classes, canManage }) {
  const [classId, setClassId] = useState('')
  const { data: matrix } = useGet(classId ? `/class-fees/matrix?classId=${classId}&sessionId=${sessionId}` : '/health', { enabled: !!classId })
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)

  function download() {
    if (!matrix) return
    const rows = matrix.students.map((s) => {
      const row = { 'Student ID': s.studentId, Student: s.name, Roll: s.rollNo }
      for (const c of matrix.cols) row[c.name] = fromPaise(s.amounts[c.id] || 0)
      return row
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Fees')
    XLSX.writeFile(wb, `fees_${matrix.className.replace(/\s+/g, '_')}.xlsx`)
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !matrix) return
    setBusy(true)
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const rows = json.map((r) => {
        const amounts = {}
        for (const c of matrix.cols) if (r[c.name] !== '' && r[c.name] != null) amounts[c.id] = r[c.name]
        return { studentId: r['Student ID'], amounts }
      }).filter((r) => r.studentId)
      const res = await api.post('/class-fees/import', { classId, sessionId, commit: false, rows })
      setPreview({ rows, ...res })
    } catch (err) {
      toast.error(err.message || 'Could not read file')
    } finally { setBusy(false) }
  }

  async function apply() {
    setBusy(true)
    try {
      const res = await api.post('/class-fees/import', { classId, sessionId, commit: true, rows: preview.rows })
      toast.success(`Applied ${res.appliedCount} student${res.appliedCount === 1 ? '' : 's'}`)
      setPreview(null)
    } catch (err) { toast.error(err.message || 'Apply failed') } finally { setBusy(false) }
  }

  return (
    <div className="card">
      <div className="card-title"><h3>Edit fee structure in bulk (Excel)</h3></div>
      <div className="filters">
        <select value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">Select class…</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn ghost" disabled={!matrix} onClick={download}><Download size={15} /> Download .xlsx</button>
        {canManage && (
          <label className={`btn ghost ${!classId ? 'disabled' : ''}`} style={{ cursor: classId ? 'pointer' : 'not-allowed', opacity: classId ? 1 : 0.5 }}>
            <Upload size={15} /> Upload & preview
            <input type="file" accept=".xlsx,.xls,.csv" disabled={!classId || busy} onChange={onFile} style={{ display: 'none' }} />
          </label>
        )}
      </div>
      {classId && matrix && <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{matrix.students.length} students · {matrix.cols.length} fee heads. Download, edit amounts (₹) offline, re-upload to preview changes before applying.</div>}

      {preview && (
        <Modal title="Import preview" onClose={() => setPreview(null)} wide>
          {preview.errors.length > 0 && (
            <div style={{ background: 'var(--berry-soft)', color: 'var(--berry)', padding: 12, borderRadius: 9, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={15} /> {preview.errors.length} error{preview.errors.length === 1 ? '' : 's'} — nothing will be applied</div>
              <ul style={{ margin: '8px 0 0', fontSize: 13 }}>{preview.errors.slice(0, 20).map((er, i) => <li key={i}>Row {er.row}{er.name ? ` (${er.name})` : ''}: {er.error}</li>)}</ul>
            </div>
          )}
          {preview.changes.length === 0 ? <Empty emoji="✅" text="No changes detected" /> : (
            <div className="table-wrap" style={{ boxShadow: 'none' }}>
              <table>
                <thead><tr><th>Student</th><th>Fee head</th><th>From</th><th>To</th></tr></thead>
                <tbody>
                  {preview.changes.flatMap((c) => c.diffs.map((d, j) => (
                    <tr key={c.studentId + j}><td>{j === 0 ? <b>{c.name}</b> : ''}</td><td>{d.name}</td><td className="muted">{fmtMoney(d.fromPaise)}</td><td><b>{fmtMoney(d.toPaise)}</b></td></tr>
                  )))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn ghost" onClick={() => setPreview(null)}>Cancel</button>
            <button className="btn" disabled={!preview.canApply || preview.changes.length === 0 || busy} onClick={apply}>Apply {preview.changes.length} change{preview.changes.length === 1 ? '' : 's'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default function StudentFees() {
  const { user, activeSessionId } = useStore()
  const canManage = MANAGE.includes(user.role)
  const { data: sessions = [] } = useGet('/academic-years')
  const session = sessions.find((s) => s.id === activeSessionId) || sessions.find((s) => s.active)
  const { data: students = [], isLoading } = useGet('/students')
  const { data: classes = [] } = useGet('/classes')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)

  if (isLoading) return <Spinner />
  const sessionClasses = classes.filter((c) => c.academicYearId === session?.id && c.active !== false)
  const matches = q.trim() ? students.filter((s) => `${s.firstName} ${s.lastName}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : []

  return (
    <div>
      <div className="page-head">
        <h1>Student fee management</h1>
        <Badge color="orange">{session?.name || '—'}</Badge>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><h3>Per-student override</h3></div>
        <div className="filters" style={{ position: 'relative' }}>
          <Search size={15} style={{ opacity: 0.5 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search student by name…" style={{ minWidth: 260 }} />
        </div>
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
        {selected && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <b style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>{selected.firstName} {selected.lastName}</b>
              <button className="btn sm ghost" onClick={() => setSelected(null)}>Change</button>
            </div>
            <StudentEditor studentId={selected.id} sessionId={session.id} canManage={canManage} />
            <StudentDiscounts studentId={selected.id} sessionId={session.id} canManage={canManage} />
          </div>
        )}
      </div>

      <BulkExcel sessionId={session?.id} classes={sessionClasses} canManage={canManage} />
    </div>
  )
}
