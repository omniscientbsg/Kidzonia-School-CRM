import { useState } from 'react'
import { Plus, Save, Trash2 } from 'lucide-react'
import { useGet, useAct, fmtDateTime } from '../../api/hooks'
import { Spinner, Empty, Badge, Field, Modal } from '../../components/ui'
import { useStore } from '../../store/useStore'

const TABS = ['branches', 'years', 'programs', 'classes', 'feeHeads', 'users', 'permissions', 'audit']
const TAB_LABELS = { branches: 'Branches', years: 'Academic Years', programs: 'Programs', classes: 'Classes & Sections', feeHeads: 'Fee Heads', users: 'Users', permissions: 'Permission Matrix', audit: 'Audit Log' }
const MODULES = ['crm', 'admissions', 'students', 'attendance', 'fees', 'daily', 'comms', 'worksheets', 'settings', 'dashboards', 'setup', 'staff', 'daycare']
const ACTIONS = ['view', 'create', 'edit', 'delete']
const ROLES = ['branch_admin', 'front_desk', 'accountant', 'teacher', 'daycare_staff']

function AddUserModal({ onClose }) {
  const act = useAct(['/users'])
  const { data: branches = [] } = useGet('/branches')
  const [form, setForm] = useState({ name: '', email: '', password: 'password', role: 'front_desk', branchId: branches[0]?.id || '' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  return (
    <Modal title="Add staff user" onClose={onClose}>
      <div className="form-row">
        <Field label="Name"><input value={form.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Email"><input type="email" value={form.email} onChange={set('email')} /></Field>
      </div>
      <div className="form-row">
        <Field label="Password"><input value={form.password} onChange={set('password')} /></Field>
        <Field label="Role">
          <select value={form.role} onChange={set('role')}>
            <option value="super_admin">Super Admin</option>
            <option value="branch_admin">Branch Admin</option>
            <option value="front_desk">Front Desk</option>
            <option value="accountant">Accountant</option>
            <option value="teacher">Teacher</option>
            <option value="daycare_staff">Day Care Staff</option>
          </select>
        </Field>
      </div>
      <Field label="Branch">
        <select value={form.branchId} onChange={set('branchId')}>
          <option value="">HQ (no branch)</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!form.name || !form.email} onClick={() => act.mutate(
          { path: '/users', body: form, success: 'User created' }, { onSuccess: onClose }
        )}>Create user</button>
      </div>
    </Modal>
  )
}

function BranchesTab() {
  const { data: branches = [], isLoading } = useGet('/branches')
  const act = useAct(['/branches'])
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  if (isLoading) return <Spinner />
  return (
    <div className="card">
      <div className="card-title"><h3>Branches</h3></div>
      <div className="table-wrap" style={{ boxShadow: 'none', marginBottom: 14 }}>
        <table>
          <thead><tr><th>Name</th><th>Code</th><th>Phone</th><th>Address</th></tr></thead>
          <tbody>
            {branches.map((b) => <tr key={b.id}><td><b>{b.name}</b></td><td><Badge color="gray">{b.code}</Badge></td><td>{b.phone || '—'}</td><td className="muted">{b.address || '—'}</td></tr>)}
          </tbody>
        </table>
      </div>
      <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (name && code) { act.mutate({ path: '/branches', body: { name, code: code.toUpperCase(), address: '', phone: '' }, success: 'Branch added' }); setName(''); setCode('') } }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Branch name" style={{ flex: 2, padding: '8px 11px', border: '1.5px solid var(--line)', borderRadius: 9 }} />
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" style={{ flex: 1, padding: '8px 11px', border: '1.5px solid var(--line)', borderRadius: 9 }} />
        <button className="btn sm">Add</button>
      </form>
    </div>
  )
}

function YearsTab() {
  const { data: years = [], isLoading } = useGet('/academic-years')
  const act = useAct(['/academic-years'])
  const [name, setName] = useState('')
  if (isLoading) return <Spinner />
  return (
    <div className="card">
      <div className="card-title"><h3>Academic Years</h3></div>
      {years.map((y) => (
        <div key={y.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid #f4efe6', alignItems: 'center' }}>
          <b>{y.name}</b>
          <span className="muted">{y.startDate} → {y.endDate}</span>
          {y.active && <Badge color="green">active</Badge>}
        </div>
      ))}
      <form style={{ display: 'flex', gap: 8, marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); if (name) { act.mutate({ path: '/academic-years', body: { name, startDate: '2026-04-01', endDate: '2027-03-31', active: false }, success: 'Year added' }); setName('') } }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2026-27" style={{ flex: 1, padding: '8px 11px', border: '1.5px solid var(--line)', borderRadius: 9 }} />
        <button className="btn sm">Add</button>
      </form>
    </div>
  )
}

function ProgramsTab() {
  const { data: programs = [], isLoading } = useGet('/programs')
  const act = useAct(['/programs'])
  const [name, setName] = useState('')
  if (isLoading) return <Spinner />
  return (
    <div className="card">
      <div className="card-title"><h3>Programs</h3></div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {programs.map((p) => <Badge key={p.id} color="plum">{p.name}</Badge>)}
      </div>
      <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (name) { act.mutate({ path: '/programs', body: { name }, success: 'Program added' }); setName('') } }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Program name" style={{ flex: 1, padding: '8px 11px', border: '1.5px solid var(--line)', borderRadius: 9 }} />
        <button className="btn sm">Add</button>
      </form>
    </div>
  )
}

function ClassesTab() {
  const { data: classes = [], isLoading } = useGet('/classes')
  const { data: sections = [] } = useGet('/sections')
  const { data: programs = [] } = useGet('/programs')
  const { data: users = [] } = useGet('/users')
  const act = useAct(['/classes', '/sections'])
  if (isLoading) return <Spinner />
  const teachers = users.filter((u) => u.role === 'teacher')
  return (
    <div className="card">
      <div className="card-title"><h3>Classes & Sections</h3></div>
      {classes.map((c) => {
        const secs = sections.filter((s) => s.classId === c.id)
        return (
          <div key={c.id} style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #f4efe6' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <b>{c.name}</b>
              <Badge color="plum">{programs.find((p) => p.id === c.programId)?.name || ''}</Badge>
              <span className="muted">Cap: {c.capacity || '—'}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {secs.map((s) => (
                <div key={s.id} style={{ padding: '6px 10px', background: 'var(--sky-soft)', borderRadius: 8, fontSize: 12.5 }}>
                  <b>{s.name}</b> · {s.capacity || '—'} seats
                  {s.teacherId && <span className="muted"> · {teachers.find((t) => t.id === s.teacherId)?.name || '?'}</span>}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FeeHeadsTab() {
  const { data: heads = [], isLoading } = useGet('/fee-heads')
  const act = useAct(['/fee-heads'])
  const [name, setName] = useState('')
  if (isLoading) return <Spinner />
  return (
    <div className="card">
      <div className="card-title"><h3>Fee Heads</h3></div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {heads.map((h) => <Badge key={h.id} color="gray">{h.name} ({h.code})</Badge>)}
      </div>
      <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (name) { act.mutate({ path: '/fee-heads', body: { name, code: name.toUpperCase().replace(/\s+/g, '_') }, success: 'Head added' }); setName('') } }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New fee head" style={{ flex: 1, padding: '8px 11px', border: '1.5px solid var(--line)', borderRadius: 9 }} />
        <button className="btn sm">Add</button>
      </form>
    </div>
  )
}

function UsersTab() {
  const { data: users = [], isLoading } = useGet('/users')
  const [adding, setAdding] = useState(false)
  if (isLoading) return <Spinner />
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button className="btn sm" onClick={() => setAdding(true)}><Plus size={13} /> Add user</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Branch</th><th>Active</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><b>{u.name}</b></td>
                <td>{u.email}</td>
                <td><Badge color="plum">{u.role?.replace(/_/g, ' ')}</Badge></td>
                <td>{u.branchId ? u.branchId.slice(0, 8) + '…' : 'HQ'}</td>
                <td>{u.active ? <Badge color="green">active</Badge> : <Badge color="gray">inactive</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <AddUserModal onClose={() => setAdding(false)} />}
    </div>
  )
}

function PermissionsTab() {
  const { data: perms = [], isLoading } = useGet('/role-permissions')
  const act = useAct(['/role-permissions'])
  const { user } = useStore()
  const [edits, setEdits] = useState({})

  if (isLoading) return <Spinner />
  const matrix = {}
  for (const rp of perms) matrix[rp.role] = { ...rp.permissions }

  function toggle(role, mod, action) {
    const key = `${role}.${mod}.${action}`
    const current = edits[key] ?? matrix[role]?.[mod]?.[action] ?? false
    setEdits({ ...edits, [key]: !current })
  }

  function isChecked(role, mod, action) {
    const key = `${role}.${mod}.${action}`
    return edits[key] ?? matrix[role]?.[mod]?.[action] ?? false
  }

  function saveRole(role) {
    const permissions = {}
    for (const mod of MODULES) {
      permissions[mod] = {}
      for (const action of ACTIONS) {
        permissions[mod][action] = isChecked(role, mod, action)
      }
    }
    act.mutate({ method: 'put', path: `/role-permissions/${role}`, body: { permissions }, success: `${role} permissions saved` })
  }

  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div className="card-title"><h3>Permission Matrix</h3></div>
      {user.role !== 'super_admin' && <div className="muted" style={{ marginBottom: 10 }}>Only super admin can edit permissions.</div>}
      {ROLES.map((role) => (
        <div key={role} style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ textTransform: 'capitalize' }}>{role.replace(/_/g, ' ')}</h3>
            {user.role === 'super_admin' && <button className="btn sm" onClick={() => saveRole(role)}><Save size={12} /> Save</button>}
          </div>
          <div className="table-wrap" style={{ boxShadow: 'none' }}>
            <table className="perm-grid">
              <thead>
                <tr><th>Module</th>{ACTIONS.map((a) => <th key={a} style={{ textTransform: 'capitalize' }}>{a}</th>)}</tr>
              </thead>
              <tbody>
                {MODULES.map((mod) => (
                  <tr key={mod}>
                    <td style={{ textTransform: 'capitalize', fontWeight: 700 }}>{mod}</td>
                    {ACTIONS.map((action) => (
                      <td key={action}>
                        <input
                          type="checkbox"
                          checked={isChecked(role, mod, action)}
                          onChange={() => toggle(role, mod, action)}
                          disabled={user.role !== 'super_admin'}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function AuditTab() {
  const [collection, setCollection] = useState('')
  const path = collection ? `/audit-log?collection=${collection}` : '/audit-log'
  const { data: logs = [], isLoading } = useGet(path)
  return (
    <div>
      <div className="filters" style={{ marginBottom: 14 }}>
        <select value={collection} onChange={(e) => setCollection(e.target.value)}>
          <option value="">All collections</option>
          {['students', 'applications', 'invoices', 'payments', 'discounts', 'refunds', 'rolePermissions', 'consents', 'users'].map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      {isLoading ? <Spinner /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Action</th><th>Collection</th><th>Record</th><th>User</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="muted">{fmtDateTime(l.createdAt)}</td>
                  <td><Badge color="orange">{l.action}</Badge></td>
                  <td>{l.collection}</td>
                  <td className="muted">{l.recordId?.slice(0, 8)}…</td>
                  <td>{l.userId?.slice(0, 8)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && <Empty emoji="📋" text="No audit entries" />}
        </div>
      )}
    </div>
  )
}

export default function Settings() {
  const [tab, setTab] = useState('branches')

  return (
    <div>
      <div className="page-head"><h1>Settings</h1></div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{TAB_LABELS[t]}</button>
        ))}
      </div>
      {tab === 'branches' && <BranchesTab />}
      {tab === 'years' && <YearsTab />}
      {tab === 'programs' && <ProgramsTab />}
      {tab === 'classes' && <ClassesTab />}
      {tab === 'feeHeads' && <FeeHeadsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'permissions' && <PermissionsTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  )
}
