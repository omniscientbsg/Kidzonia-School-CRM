import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Shield, Ban, RotateCcw, Download, LayoutGrid, List as ListIcon, CalendarCheck, Phone, User } from 'lucide-react'
import { useGet, useAct, initials } from '../../../api/hooks'
import { mediaUrl } from '../../../api/client'
import { Spinner, Empty, Badge, ConfirmDialog } from '../../../components/ui'
import { useStore } from '../../../store/useStore'
import { exportCSV, exportPDF } from '../../../lib/export'

const SETUP_ROLES = ['super_admin', 'branch_admin']
const ROLE_LABEL = { super_admin: 'Super Admin', branch_admin: 'School Admin', front_desk: 'Front Desk', accountant: 'Accountant', teacher: 'Teacher', daycare_staff: 'Day Care Staff' }

function Avatar({ s, size = 46 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 12, overflow: 'hidden', background: 'var(--marmalade-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 800, color: 'var(--marmalade-deep)', fontSize: size / 3 }}>
      {s.photoId ? <img src={mediaUrl(s.photoId)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (initials(s.name) || '?')}
    </div>
  )
}

function DownloadMenu({ onCsv, onPdf }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn ghost" onClick={() => setOpen((o) => !o)}><Download size={15} /> Export ▾</button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 20, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 9, boxShadow: 'var(--shadow)', overflow: 'hidden', minWidth: 110 }}>
          {[['CSV', onCsv], ['PDF', onPdf]].map(([label, fn]) => (
            <button key={label} onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); fn() }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13 }}>{label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function StaffList() {
  const navigate = useNavigate()
  const { user } = useStore()
  const canManage = SETUP_ROLES.includes(user.role)
  const { data: staff = [], isLoading, isError, error } = useGet('/staff')
  const { data: classes = [] } = useGet('/classes')
  const act = useAct(['/staff'])
  const [q, setQ] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [view, setView] = useState('grid')
  const [confirm, setConfirm] = useState(null)

  if (isLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load staff'} /></div>

  const className = (id) => classes.find((c) => c.id === id)?.name || id
  const classList = (s) => (s.classTeacherOf || []).map(className)
  const filtered = staff.filter((s) => {
    if (showInactive ? s.active !== false : s.active === false) return false
    if (q) {
      const hay = `${s.name} ${s.employeeId || ''} ${s.username || ''} ${s.designation || ''} ${(s.subjects || []).join(' ')}`.toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  }).sort((a, b) => a.name.localeCompare(b.name))

  function toggleActive(s) {
    act.mutate({ method: 'put', path: `/staff/${s.id}`, body: { active: s.active === false }, success: s.active === false ? 'Staff activated' : 'Staff deactivated' }, { onSuccess: () => setConfirm(null) })
  }

  const cols = [
    { key: 'employeeId', label: 'Emp ID' }, { key: 'name', label: 'Name' }, { key: 'designation', label: 'Designation' },
    { key: 'role', label: 'Role' }, { key: 'subjects', label: 'Subjects' }, { key: 'phone', label: 'Mobile' },
    { key: 'username', label: 'Username' }, { key: 'classes', label: 'Class Teacher Of' }, { key: 'active', label: 'Active' },
  ]
  const exportRows = () => filtered.map((s) => ({
    employeeId: s.employeeId || '', name: s.name, designation: s.designation || '', role: ROLE_LABEL[s.role] || s.role,
    subjects: (s.subjects || []).join('; '), phone: s.phone || '', username: s.username || '', classes: classList(s).join('; '), active: s.active === false ? 'No' : 'Yes',
  }))

  const StaffActions = ({ s }) => canManage && (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <button className="btn sm ghost" onClick={() => navigate(`/setup/staff/${s.id}/edit`)}>Edit</button>
      <button className="btn sm subtle" onClick={() => navigate(`/setup/staff/${s.id}/access`)}><Shield size={13} /> Access Rights</button>
      {s.active === false
        ? <button className="btn sm ghost" onClick={() => toggleActive(s)}><RotateCcw size={13} /> Activate</button>
        : <button className="btn sm danger" onClick={() => setConfirm(s)}><Ban size={13} /> Deactivate</button>}
    </div>
  )

  return (
    <div>
      <div className="page-head">
        <div className="filters">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / ID / username…" />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Inactive staff
          </label>
          <div style={{ display: 'flex', border: '1.5px solid var(--line)', borderRadius: 9, overflow: 'hidden' }}>
            <button className="icon-btn" onClick={() => setView('grid')} style={{ background: view === 'grid' ? 'var(--marmalade-soft)' : 'transparent', borderRadius: 0 }} title="Grid"><LayoutGrid size={15} /></button>
            <button className="icon-btn" onClick={() => setView('list')} style={{ background: view === 'list' ? 'var(--marmalade-soft)' : 'transparent', borderRadius: 0 }} title="List"><ListIcon size={15} /></button>
          </div>
        </div>
        <div className="spacer" />
        <DownloadMenu onCsv={() => exportCSV('staff', cols, exportRows())} onPdf={() => exportPDF('Staff Details', cols, exportRows())} />
        {canManage && <button className="btn ghost" onClick={() => navigate('/setup/staff/attendance')}><CalendarCheck size={15} /> Attendance</button>}
        {canManage && <button className="btn" onClick={() => navigate('/setup/staff/new')}><Plus size={15} /> Create staff</button>}
      </div>

      {filtered.length === 0 ? (
        <div className="card"><Empty emoji="🧑‍🏫" text={showInactive ? 'No inactive staff' : 'No staff found'} /></div>
      ) : view === 'list' ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Staff</th><th>Emp ID</th><th>Designation</th><th>Role</th><th>Classes</th><th>Mobile</th><th>Username</th><th></th></tr></thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} style={{ opacity: s.active === false ? 0.6 : 1 }}>
                  <td><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Avatar s={s} size={32} /><b>{s.name}</b></div></td>
                  <td>{s.employeeId || '—'}</td>
                  <td>{s.designation || '—'}</td>
                  <td><Badge color="plum">{ROLE_LABEL[s.role] || s.role}</Badge></td>
                  <td className="muted">{classList(s).join(', ') || '—'}</td>
                  <td>{s.phone || '—'}</td>
                  <td className="muted">{s.username || '—'}</td>
                  <td><StaffActions s={s} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {filtered.map((s) => (
            <div key={s.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: s.active === false ? 0.7 : 1 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <Avatar s={s} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 800 }}>{s.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{s.employeeId || '—'} · {s.designation || '—'}</div>
                  <div style={{ marginTop: 4 }}><Badge color="plum">{ROLE_LABEL[s.role] || s.role}</Badge>{s.active === false && <Badge color="red">inactive</Badge>}</div>
                </div>
              </div>
              {!s.photoId && <div className="muted" style={{ fontSize: 11, marginTop: -4 }}>No image available</div>}

              <div style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div><span className="muted">Subjects: </span>{(s.subjects || []).join(', ') || '—'}</div>
                <div><span className="muted">Class Teacher: </span>{classList(s).join(', ') || '—'}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {s.subjectTeacher && <Badge color="green">Subject Teacher</Badge>}
                  {s.groupAdmin && <Badge color="orange">Group Admin</Badge>}
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 2 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Phone size={13} style={{ opacity: 0.6 }} />{s.phone || '—'}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><User size={13} style={{ opacity: 0.6 }} />{s.username || '—'}</span>
                </div>
              </div>

              <div style={{ marginTop: 'auto', paddingTop: 4 }}><StaffActions s={s} /></div>
            </div>
          ))}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={`Deactivate ${confirm.name}?`}
          message="The staff account is disabled (they can no longer log in) but retained. You can reactivate anytime from the “Inactive staff” filter."
          confirmLabel="Deactivate"
          busy={act.isPending}
          onConfirm={() => toggleActive(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
