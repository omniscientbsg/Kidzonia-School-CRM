import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, Shield, AlertTriangle } from 'lucide-react'
import { useGet, useAct } from '../../../api/hooks'
import { Spinner, Badge } from '../../../components/ui'
import { useStore } from '../../../store/useStore'

// modules ordered per the brief (Students, Fees, Attendance, Communication, Reports, Setup…)
const MODULES = [
  ['students', 'Students'], ['fees', 'Fees'], ['attendance', 'Attendance'], ['comms', 'Communication'],
  ['dashboards', 'Reports'], ['setup', 'Setup'], ['staff', 'Staff'], ['daycare', 'Day Care'],
  ['daily', 'Daily / Diary'], ['crm', 'CRM'], ['admissions', 'Admissions'], ['worksheets', 'Worksheets'], ['settings', 'Settings'],
]
const ACTIONS = ['view', 'create', 'edit', 'delete']
const ASSIGNABLE = [['branch_admin', 'School Admin'], ['front_desk', 'Front Desk'], ['accountant', 'Accountant'], ['teacher', 'Teacher'], ['daycare_staff', 'Day Care Staff'], ['super_admin', 'Super Admin']]

export default function StaffAccess() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useStore()
  const { data: staffAll = [], isLoading: ls } = useGet('/staff')
  const { data: perms = [], isLoading: lp } = useGet('/role-permissions')
  const act = useAct(['/staff', '/role-permissions'])

  const staff = staffAll.find((s) => s.id === id)
  const [selectedRole, setSelectedRole] = useState(null)

  if (ls || lp) return <Spinner />
  if (!staff) return <div className="card"><p className="muted">Staff member not found.</p></div>

  const role = selectedRole || staff.role
  const roleChanged = role !== staff.role
  const canEditPerms = user.role === 'super_admin'

  function reassign() {
    act.mutate({ method: 'put', path: `/staff/${staff.id}`, body: { role }, success: `${staff.name} reassigned to ${role.replace(/_/g, ' ')}` })
  }

  return (
    <div>
      <button className="btn sm ghost" onClick={() => navigate('/setup/staff')} style={{ marginBottom: 12 }}><ArrowLeft size={13} /> Back to staff</button>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title"><h3><Shield size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Access Rights — {staff.name}</h3></div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Role</label>
            <select value={role} onChange={(e) => setSelectedRole(e.target.value)}>
              {ASSIGNABLE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {roleChanged && <button className="btn" onClick={reassign} disabled={act.isPending}>Reassign to {role.replace(/_/g, ' ')}</button>}
          <div className="muted" style={{ fontSize: 12.5, flex: 1 }}>
            Permissions below apply to the <b>{role.replace(/_/g, ' ')}</b> role — editing them affects every staff member with this role.
          </div>
        </div>
      </div>

      {role === 'super_admin' ? (
        <div className="card"><div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--ink-soft)' }}><Shield size={16} /> Super Admin always has full access and cannot be restricted.</div></div>
      ) : (
        <AccessMatrix
          key={role}
          role={role}
          base={perms.find((p) => p.role === role)?.permissions || {}}
          canEdit={canEditPerms}
          act={act}
        />
      )}
    </div>
  )
}

function AccessMatrix({ role, base, canEdit, act }) {
  const [draft, setDraft] = useState(() => {
    const m = {}
    for (const [mod] of MODULES) m[mod] = { view: false, create: false, edit: false, delete: false, ...(base[mod] || {}) }
    return m
  })
  const set = (mod, action, val) => setDraft((d) => ({ ...d, [mod]: { ...d[mod], [action]: val } }))

  function save() {
    act.mutate({ method: 'put', path: `/role-permissions/${role}`, body: { permissions: draft }, success: `${role.replace(/_/g, ' ')} permissions saved` })
  }

  return (
    <div className="card">
      <div className="card-title">
        <h3 style={{ fontSize: 15 }}>Module access</h3>
        {canEdit ? <button className="btn sm" onClick={save} disabled={act.isPending}><Save size={13} /> Save permissions</button>
          : <span className="muted" style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={13} /> Only Super Admin can edit permissions</span>}
      </div>
      <div className="table-wrap" style={{ boxShadow: 'none' }}>
        <table className="perm-grid">
          <thead><tr><th style={{ textAlign: 'left' }}>Module</th>{ACTIONS.map((a) => <th key={a} style={{ textTransform: 'capitalize' }}>{a}</th>)}<th>Access</th></tr></thead>
          <tbody>
            {MODULES.map(([mod, label]) => {
              const p = draft[mod]
              const level = p.edit || p.create || p.delete ? 'Edit' : p.view ? 'View' : 'None'
              return (
                <tr key={mod}>
                  <td style={{ textAlign: 'left', fontWeight: 700 }}>{label}</td>
                  {ACTIONS.map((a) => (
                    <td key={a} style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={!!p[a]} disabled={!canEdit}
                        onChange={(e) => {
                          const v = e.target.checked
                          // turning on any write implies view; turning off view clears writes
                          if (a === 'view' && !v) setDraft((d) => ({ ...d, [mod]: { view: false, create: false, edit: false, delete: false } }))
                          else if (a !== 'view' && v) setDraft((d) => ({ ...d, [mod]: { ...d[mod], view: true, [a]: true } }))
                          else set(mod, a, v)
                        }} />
                    </td>
                  ))}
                  <td style={{ textAlign: 'center' }}><Badge color={level === 'Edit' ? 'green' : level === 'View' ? 'orange' : 'gray'}>{level}</Badge></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
