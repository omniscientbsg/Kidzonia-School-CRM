import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Ban, RotateCcw, Download, Search, School, Users, ArrowRightLeft, BarChart3, CalendarCheck } from 'lucide-react'
import { useGet, useAct } from '../../../api/hooks'
import { api } from '../../../api/client'
import { Spinner, Empty, Badge, ConfirmDialog } from '../../../components/ui'
import { useStore } from '../../../store/useStore'
import { exportCSV, exportExcel, exportPDF } from '../../../lib/export'

const SETUP_ROLES = ['super_admin', 'branch_admin']
const ROSTER_COLS = [
  { key: 'rollNo', label: 'Roll No' }, { key: 'name', label: 'Name' }, { key: 'section', label: 'Section' },
  { key: 'gender', label: 'Gender' }, { key: 'dob', label: 'DOB' }, { key: 'bloodGroup', label: 'Blood Group' },
  { key: 'allergies', label: 'Allergies' }, { key: 'status', label: 'Status' },
]

const ageLabel = (mo) => {
  if (!mo) return null
  const y = Math.floor(mo / 12), m = mo % 12
  return [y ? `${y}y` : null, m ? `${m}m` : null].filter(Boolean).join(' ') || '0m'
}

function DownloadMenu({ cls }) {
  const [open, setOpen] = useState(false)
  async function run(fmt) {
    setOpen(false)
    try {
      const data = await api.get(`/classes/${cls.id}/roster`)
      const rows = data.students
      const fname = `${(cls.code || cls.name).replace(/\s+/g, '_')}_roster`
      const title = `${cls.name} — Roster (${rows.length} students)`
      if (fmt === 'csv') exportCSV(fname, ROSTER_COLS, rows)
      else if (fmt === 'excel') exportExcel(fname, title, ROSTER_COLS, rows)
      else exportPDF(title, ROSTER_COLS, rows)
    } catch (e) {
      // useAct not used here; surface minimal
      alert(e.message || 'Export failed')
    }
  }
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn sm ghost" onClick={() => setOpen((o) => !o)}><Download size={13} /> Download ▾</button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 20, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 9, boxShadow: 'var(--shadow)', overflow: 'hidden', minWidth: 130 }}>
          {[['csv', 'CSV'], ['excel', 'Excel (.xls)'], ['pdf', 'PDF']].map(([f, label]) => (
            <button key={f} onClick={() => run(f)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13 }}
              onMouseDown={(e) => e.preventDefault()}>{label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ClassList() {
  const navigate = useNavigate()
  const { user, activeSessionId } = useStore()
  const canManage = SETUP_ROLES.includes(user.role)
  const { data: sessions = [] } = useGet('/academic-years')
  const { data: classes = [], isLoading, isError, error, refetch } = useGet('/classes')
  const { data: stats = [] } = useGet('/class-stats')
  const { data: users = [] } = useGet('/users')
  const act = useAct(['/classes', '/class-stats'])

  const [sessionId, setSessionId] = useState(activeSessionId || '')
  const [classFilter, setClassFilter] = useState('')
  const [showDeactivated, setShowDeactivated] = useState(false)
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState(null)

  const statBy = Object.fromEntries(stats.map((x) => [x.classId, x]))
  const userName = (id) => users.find((u) => u.id === id)?.name
  const teacherNames = (c) => [c.classTeacherId, ...(c.assistantTeacherIds || [])].map(userName).filter(Boolean)
  const sessionName = (id) => sessions.find((s) => s.id === id)?.name || '—'

  const effSession = sessionId || activeSessionId
  const names = [...new Set(classes.map((c) => c.name))].sort()
  const filtered = classes.filter((c) => {
    if (effSession && c.academicYearId !== effSession) return false
    if (classFilter && c.name !== classFilter) return false
    if (!showDeactivated && c.active === false) return false
    if (showDeactivated && c.active !== false) return false
    if (q) {
      const hay = `${c.name} ${c.code || ''} ${teacherNames(c).join(' ')}`.toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  }).sort((a, b) => a.name.localeCompare(b.name))

  function toggleActive(c) {
    act.mutate({
      method: 'put', path: `/classes/${c.id}`, body: { active: c.active === false },
      success: c.active === false ? 'Class activated' : 'Class deactivated',
    }, { onSuccess: () => setConfirm(null) })
  }

  return (
    <div>
      <div className="page-head">
        <div className="filters">
          <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">Active session</option>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? ' (active)' : s.archived ? ' (archived)' : ''}</option>)}
          </select>
          <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="">All classes</option>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / code / teacher…" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={showDeactivated} onChange={(e) => setShowDeactivated(e.target.checked)} /> Deactivated
          </label>
          <button className="btn sm subtle" onClick={() => refetch()}><Search size={13} /> Search</button>
        </div>
        <div className="spacer" />
        <button className="btn ghost" onClick={() => navigate('/setup/classes/attendance')}><CalendarCheck size={15} /> Attendance</button>
        <button className="btn ghost" onClick={() => navigate('/setup/classes/breakup')}><BarChart3 size={15} /> Breakup</button>
        {canManage && <button className="btn ghost" onClick={() => navigate('/setup/classes/transfer')}><ArrowRightLeft size={15} /> Transfer / Promote</button>}
        {canManage && <button className="btn" onClick={() => navigate('/setup/classes/new')}><Plus size={15} /> Create class</button>}
      </div>

      {isLoading ? <Spinner /> : isError ? (
        <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load classes'} /></div>
      ) : filtered.length === 0 ? (
        <div className="card"><Empty emoji="🏫" text={showDeactivated ? 'No deactivated classes' : 'No classes for this filter'} /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {filtered.map((c) => {
            const st = statBy[c.id]
            const inactive = c.active === false
            return (
              <div key={c.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: inactive ? 0.75 : 1, borderColor: inactive ? 'var(--line)' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800 }}>{c.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{sessionName(c.academicYearId)}{c.code ? ` · ${c.code}` : ''}</div>
                  </div>
                  {c.code && <Badge color="gray">{c.code}</Badge>}
                  {inactive && <Badge color="red">inactive</Badge>}
                </div>

                <div style={{ display: 'flex', gap: 16 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Users size={15} style={{ opacity: 0.6 }} /><b>{st ? st.students : '—'}</b> <span className="muted" style={{ fontSize: 12 }}>students</span></span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><School size={15} style={{ opacity: 0.6 }} /><b>{st ? st.sections : '—'}</b> <span className="muted" style={{ fontSize: 12 }}>sections</span></span>
                </div>

                <div style={{ fontSize: 12.5 }}>
                  <span className="muted">Teachers: </span>{teacherNames(c).join(', ') || <span className="muted">unassigned</span>}
                </div>
                {(c.ageMinMonths || c.ageMaxMonths) && (
                  <div className="muted" style={{ fontSize: 12 }}>Age {ageLabel(c.ageMinMonths) || '0m'} – {ageLabel(c.ageMaxMonths) || '—'}</div>
                )}

                {canManage && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto', paddingTop: 4, alignItems: 'center' }}>
                    <button className="btn sm ghost" onClick={() => navigate(`/setup/classes/${c.id}/edit`)}><Pencil size={13} /> Edit</button>
                    {inactive ? (
                      <button className="btn sm subtle" onClick={() => toggleActive(c)}><RotateCcw size={13} /> Activate</button>
                    ) : (
                      <button className="btn sm danger" onClick={() => setConfirm(c)}><Ban size={13} /> Deactivate</button>
                    )}
                    <div style={{ marginLeft: 'auto' }}><DownloadMenu cls={c} /></div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={`Deactivate ${confirm.name}?`}
          message="The class is hidden from active lists but kept (with its sections and enrolments). You can reactivate it anytime via the “Deactivated” filter."
          confirmLabel="Deactivate"
          busy={act.isPending}
          onConfirm={() => toggleActive(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
