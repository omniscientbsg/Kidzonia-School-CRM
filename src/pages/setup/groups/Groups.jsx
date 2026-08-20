import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Pencil, Trash2, Megaphone, Users } from 'lucide-react'
import { useGet, useAct } from '../../../api/hooks'
import { Spinner, Empty, Badge, Field, Modal, ConfirmDialog } from '../../../components/ui'
import { useStore } from '../../../store/useStore'

const SETUP_ROLES = ['super_admin', 'branch_admin']
const TYPES = [['staff', 'Staff'], ['parents', 'Parents'], ['class', 'Class'], ['activity', 'Activity'], ['transport', 'Transport'], ['custom', 'Custom']]
const TYPE_LABEL = Object.fromEntries(TYPES.map(([v, l]) => [v, l]))
const TYPE_COLOR = { staff: 'green', parents: 'plum', class: 'orange', activity: 'plum', transport: 'orange', custom: 'gray' }

function Picker({ label, items, selected, onToggle, labelFn, searchable }) {
  const [q, setQ] = useState('')
  const shown = searchable && q ? items.filter((i) => labelFn(i).toLowerCase().includes(q.toLowerCase())) : items
  return (
    <Field label={`${label} (${selected.length})`}>
      {searchable && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`} style={{ marginBottom: 8 }} />}
      <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 9, padding: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {shown.map((i) => {
          const on = selected.includes(i.id)
          return <button type="button" key={i.id} onClick={() => onToggle(i.id)} className={`badge ${on ? 'orange' : 'gray'}`} style={{ cursor: 'pointer', border: 'none' }}>{on ? '✓ ' : ''}{labelFn(i)}</button>
        })}
        {shown.length === 0 && <span className="muted" style={{ fontSize: 12.5 }}>None.</span>}
      </div>
    </Field>
  )
}

function GroupModal({ group, sessionId, sessions, staff, students, classes, onClose }) {
  const editing = !!group
  const act = useAct(['/groups'])
  const session = sessions.find((s) => s.id === (group?.academicYearId || sessionId))
  const branchId = session?.branchId
  const [form, setForm] = useState({
    name: group?.name || '', type: group?.type || 'staff', description: group?.description || '',
    academicYearId: group?.academicYearId || sessionId, staffInchargeId: group?.staffInchargeId || '',
    staffIds: group?.staffIds || [], memberIds: group?.memberIds || [], classIds: group?.classIds || [],
  })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const arrToggle = (k) => (id) => setForm((f) => ({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] }))

  const branchStaff = staff.filter((u) => !branchId || u.branchId === branchId || !u.branchId)
  const branchStudents = students.filter((s) => (!branchId || s.branchId === branchId) && s.status !== 'withdrawn')
  const branchClasses = classes.filter((c) => c.active !== false && (!branchId || c.branchId === branchId) && c.academicYearId === form.academicYearId)

  function save() {
    const body = { name: form.name.trim(), type: form.type, description: form.description.trim(), academicYearId: form.academicYearId, branchId, staffInchargeId: form.staffInchargeId || null, staffIds: form.staffIds, memberIds: form.memberIds, classIds: form.classIds, active: true }
    if (editing) act.mutate({ method: 'put', path: `/groups/${group.id}`, body, success: 'Group updated' }, { onSuccess: onClose })
    else act.mutate({ path: '/groups', body, success: 'Group created' }, { onSuccess: onClose })
  }

  return (
    <Modal title={editing ? 'Edit group' : 'New group'} onClose={onClose} wide>
      <div className="form-row">
        <Field label="Group name *"><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Nursery Parents" autoFocus /></Field>
        <Field label="Type">
          <select value={form.type} onChange={(e) => set('type', e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </Field>
      </div>
      <div className="form-row">
        <Field label="Session">
          <select value={form.academicYearId} onChange={(e) => set('academicYearId', e.target.value)}>
            {sessions.filter((s) => !s.archived).map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? ' (active)' : ''}</option>)}
          </select>
        </Field>
        <Field label="Admin (in-charge)">
          <select value={form.staffInchargeId} onChange={(e) => set('staffInchargeId', e.target.value)}>
            <option value="">— choose admin —</option>
            {branchStaff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description"><textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional" /></Field>

      <div className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>Add any mix of members — staff, whole classes (targets their parents), and individual students.</div>
      <Picker label="Staff members" items={branchStaff} selected={form.staffIds} onToggle={arrToggle('staffIds')} labelFn={(u) => u.name} searchable />
      <Picker label="Whole classes" items={branchClasses} selected={form.classIds} onToggle={arrToggle('classIds')} labelFn={(c) => c.name} />
      <Picker label="Students" items={branchStudents} selected={form.memberIds} onToggle={arrToggle('memberIds')} labelFn={(s) => `${s.firstName} ${s.lastName}`} searchable />

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!form.name.trim() || act.isPending} onClick={save}>{editing ? 'Save' : 'Create group'}</button>
      </div>
    </Modal>
  )
}

export default function Groups() {
  const navigate = useNavigate()
  const { user, activeSessionId } = useStore()
  const canManage = SETUP_ROLES.includes(user.role)
  const { data: sessions = [] } = useGet('/academic-years')
  const { data: groups = [], isLoading, isError, error } = useGet('/groups')
  const { data: staff = [] } = useGet('/staff')
  const { data: students = [] } = useGet('/students')
  const { data: classes = [] } = useGet('/classes')
  const act = useAct(['/groups'])
  const [sessionId, setSessionId] = useState(activeSessionId || '')
  const [typeFilter, setTypeFilter] = useState('')
  const [q, setQ] = useState('')
  const [modal, setModal] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [quickName, setQuickName] = useState('')
  const [quickAdmin, setQuickAdmin] = useState('')

  if (isLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load groups'} /></div>

  const staffName = (id) => staff.find((u) => u.id === id)?.name || '—'
  const effSession = sessionId || activeSessionId
  const sessionBranch = sessions.find((s) => s.id === effSession)?.branchId
  const filtered = groups.filter((g) => {
    if (effSession && g.academicYearId !== effSession) return false
    if (typeFilter && g.type !== typeFilter) return false
    if (q && !g.name.toLowerCase().includes(q.toLowerCase())) return false
    return true
  }).sort((a, b) => a.name.localeCompare(b.name))
  const membersSummary = (g) => [
    (g.staffIds || []).length && `${g.staffIds.length} staff`,
    (g.classIds || []).length && `${g.classIds.length} class${g.classIds.length > 1 ? 'es' : ''}`,
    (g.memberIds || []).length && `${g.memberIds.length} student${g.memberIds.length > 1 ? 's' : ''}`,
  ].filter(Boolean).join(' · ') || '—'

  function quickAdd() {
    if (!quickName.trim()) return
    act.mutate({ path: '/groups', body: { name: quickName.trim(), type: 'staff', academicYearId: effSession, branchId: sessionBranch, staffInchargeId: quickAdmin || null, staffIds: [], memberIds: [], classIds: [], active: true }, success: 'Group added' },
      { onSuccess: () => { setQuickName(''); setQuickAdmin('') } })
  }

  const branchStaff = staff.filter((u) => !sessionBranch || u.branchId === sessionBranch || !u.branchId)

  return (
    <div>
      <div className="page-head">
        <div className="filters">
          <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">Active session</option>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? ' (active)' : s.archived ? ' (archived)' : ''}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search groups…" />
        </div>
      </div>

      {canManage && (
        <div className="card" style={{ marginBottom: 14 }}>
          <form style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} onSubmit={(e) => { e.preventDefault(); quickAdd() }}>
            <input value={quickName} onChange={(e) => setQuickName(e.target.value)} placeholder="Group name" style={{ flex: 2, minWidth: 160, padding: '8px 11px', border: '1.5px solid var(--line)', borderRadius: 9 }} />
            <select value={quickAdmin} onChange={(e) => setQuickAdmin(e.target.value)} style={{ flex: 1, minWidth: 150, padding: '8px 11px', border: '1.5px solid var(--line)', borderRadius: 9 }}>
              <option value="">Choose admin…</option>
              {branchStaff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button className="btn" type="submit" disabled={!quickName.trim()}><Plus size={15} /> Add group</button>
          </form>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card"><Empty emoji="👥" text="No groups for this filter" /></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Group Name</th><th>Type</th><th>Admin</th><th>Members</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {filtered.map((g) => (
                <tr key={g.id}>
                  <td><b>{g.name}</b>{g.description && <div className="muted" style={{ fontSize: 11.5 }}>{g.description}</div>}</td>
                  <td><Badge color={TYPE_COLOR[g.type] || 'gray'}>{TYPE_LABEL[g.type] || g.type}</Badge></td>
                  <td>{staffName(g.staffInchargeId)}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}><Users size={12} style={{ verticalAlign: 'middle', opacity: 0.5, marginRight: 4 }} />{membersSummary(g)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn sm subtle" onClick={() => navigate(`/comms/announcements?group=${g.id}`)} title="Message this group"><Megaphone size={13} /> Message</button>
                    {canManage && <button className="btn sm ghost" style={{ marginLeft: 6 }} onClick={() => setModal(g)}><Pencil size={13} /></button>}
                    {canManage && <button className="btn sm ghost" style={{ marginLeft: 6 }} onClick={() => setConfirm(g)}><Trash2 size={13} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <GroupModal group={modal.id ? modal : null} sessionId={effSession} sessions={sessions} staff={staff} students={students} classes={classes} onClose={() => setModal(null)} />
      )}
      {confirm && (
        <ConfirmDialog
          title={`Delete ${confirm.name}?`}
          message="The group is removed (soft-deleted — recoverable in the database). Members, students and enrolments are unaffected."
          confirmLabel="Delete"
          busy={act.isPending}
          onConfirm={() => act.mutate({ method: 'del', path: `/groups/${confirm.id}`, success: 'Group deleted' }, { onSuccess: () => setConfirm(null) })}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
