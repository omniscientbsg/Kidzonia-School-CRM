import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Save, Download, CheckCheck } from 'lucide-react'
import { useGet, useAct, todayISO, initials } from '../../../api/hooks'
import { api } from '../../../api/client'
import { Spinner, Empty, Badge } from '../../../components/ui'
import { exportCSV } from '../../../lib/export'

const STATUSES = [['present', 'Present'], ['absent', 'Absent'], ['half_day', 'Half-day'], ['leave', 'Leave']]
const STATUS_COLOR = { present: 'green', absent: 'red', half_day: 'yellow', leave: 'plum' }

export default function StaffAttendance() {
  const navigate = useNavigate()
  const [date, setDate] = useState(todayISO())
  const [markAs, setMarkAs] = useState('present')
  const [q, setQ] = useState('')
  const { data, isLoading, isError, error } = useGet(`/staff-attendance?date=${date}`)

  const header = (
    <div className="page-head">
      <h1 style={{ fontSize: 18 }}>Staff Attendance</h1>
      <div className="filters">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select value={markAs} onChange={(e) => setMarkAs(e.target.value)}>
          {STATUSES.map(([v, l]) => <option key={v} value={v}>Mark as: {l}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search staff…" />
      </div>
      <div className="spacer" />
      <button className="btn sm ghost" onClick={() => navigate('/setup/staff')}><ArrowLeft size={13} /> Back</button>
    </div>
  )

  if (isLoading) return <div>{header}<Spinner /></div>
  if (isError) return <div>{header}<div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load'} /></div></div>

  return <div>{header}<MarkSheet key={date} date={date} markAs={markAs} q={q} initial={data.staff} /></div>
}

function MarkSheet({ date, markAs, q, initial }) {
  const act = useAct(['/staff-attendance'])
  const [marks, setMarks] = useState(() => Object.fromEntries(initial.map((s) => [s.staffId, s.status || ''])))
  const [saving, setSaving] = useState(false)

  const shown = initial.filter((s) => !q || `${s.name} ${s.employeeId || ''} ${s.designation || ''}`.toLowerCase().includes(q.toLowerCase()))
  const setOne = (id, status) => setMarks((m) => ({ ...m, [id]: status }))
  const applyAll = () => setMarks((m) => { const n = { ...m }; for (const s of shown) n[s.staffId] = markAs; return n })

  async function save() {
    setSaving(true)
    const records = Object.entries(marks).filter(([, st]) => st).map(([staffId, status]) => ({ staffId, status }))
    try {
      const res = await act.mutateAsync({ path: '/staff-attendance', body: { date, records } })
      toast.success(`Saved attendance for ${res.saved} staff`)
    } catch (err) {
      toast.error(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function exportSummary() {
    const month = date.slice(0, 7)
    try {
      const data = await api.get(`/staff-attendance/summary?month=${month}`)
      const cols = [{ key: 'employeeId', label: 'Emp ID' }, { key: 'name', label: 'Name' }, { key: 'designation', label: 'Designation' }, { key: 'present', label: 'Present' }, { key: 'absent', label: 'Absent' }, { key: 'half_day', label: 'Half-day' }, { key: 'leave', label: 'Leave' }, { key: 'marked', label: 'Days marked' }, { key: 'presentPct', label: 'Present %' }]
      exportCSV(`staff_attendance_${month}`, cols, data.staff)
      toast.success(`Exported ${month} summary`)
    } catch (err) {
      toast.error(err.message || 'Export failed')
    }
  }

  const counts = STATUSES.map(([v]) => [v, Object.values(marks).filter((s) => s === v).length])

  return (
    <div>
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div className="filters" style={{ gap: 6 }}>
          {counts.map(([v, n]) => <Badge key={v} color={STATUS_COLOR[v]}>{v.replace('_', '-')}: {n}</Badge>)}
        </div>
        <div className="spacer" />
        <button className="btn ghost" onClick={applyAll}><CheckCheck size={15} /> Mark all as {markAs.replace('_', '-')}</button>
        <button className="btn ghost" onClick={exportSummary}><Download size={15} /> Monthly summary</button>
        <button className="btn" onClick={save} disabled={saving}><Save size={15} /> {saving ? 'Saving…' : 'Save'}</button>
      </div>

      {shown.length === 0 ? <div className="card"><Empty emoji="🧑‍🏫" text="No staff match" /></div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Staff</th><th>Emp ID</th><th>Designation</th><th>Status</th></tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.staffId}>
                  <td><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--marmalade-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, color: 'var(--marmalade-deep)' }}>{initials(s.name)}</div>
                    <b>{s.name}</b>
                  </div></td>
                  <td className="muted">{s.employeeId || '—'}</td>
                  <td className="muted">{s.designation || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {STATUSES.map(([v, l]) => (
                        <button key={v} onClick={() => setOne(s.staffId, marks[s.staffId] === v ? '' : v)}
                          className={`badge ${marks[s.staffId] === v ? STATUS_COLOR[v] : 'gray'}`}
                          style={{ cursor: 'pointer', border: 'none', opacity: marks[s.staffId] === v ? 1 : 0.55 }}>{l}</button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
