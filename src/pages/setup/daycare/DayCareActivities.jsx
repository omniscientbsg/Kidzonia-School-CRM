import { useState } from 'react'
import { LogIn, LogOut, Plus, Pencil, Trash2, Clock } from 'lucide-react'
import { useGet, useAct } from '../../../api/hooks'
import { Spinner, Empty, Badge, Field, Modal, ConfirmDialog } from '../../../components/ui'
import { useStore } from '../../../store/useStore'

const MANAGE_ROLES = ['super_admin', 'branch_admin', 'daycare_staff']

function ActivityModal({ activity, presetName, onClose }) {
  const editing = !!activity
  const act = useAct(['/daycare-activities'])
  const [form, setForm] = useState({
    name: activity?.name || presetName || '',
    description: activity?.description || '',
    showStartTime: activity?.showStartTime ?? (!!presetName),
    startTime: activity?.startTime || '',
    showEndTime: activity?.showEndTime ?? false,
    endTime: activity?.endTime || '',
    optionsText: (activity?.options || []).join(', '),
    multipleEntriesAllowed: !!activity?.multipleEntriesAllowed,
  })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  function save() {
    const body = {
      name: form.name.trim(), description: form.description.trim(),
      showStartTime: form.showStartTime, startTime: form.showStartTime ? (form.startTime || null) : null,
      showEndTime: form.showEndTime, endTime: form.showEndTime ? (form.endTime || null) : null,
      options: form.optionsText.split(',').map((o) => o.trim()).filter(Boolean),
      multipleEntriesAllowed: form.multipleEntriesAllowed, active: true,
    }
    if (editing) act.mutate({ method: 'put', path: `/daycare-activities/${activity.id}`, body, success: 'Activity updated' }, { onSuccess: onClose })
    else act.mutate({ path: '/daycare-activities', body, success: 'Activity created' }, { onSuccess: onClose })
  }

  return (
    <Modal title={editing ? 'Edit activity' : 'Create activity'} onClose={onClose} wide>
      <div className="form-row">
        <Field label="Name *"><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Nap Time" autoFocus /></Field>
        <Field label="Description"><input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Optional" /></Field>
      </div>
      <div className="form-row">
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 800, color: 'var(--ink-soft)', marginBottom: 5 }}>
            <input type="checkbox" checked={form.showStartTime} onChange={(e) => set('showStartTime', e.target.checked)} /> Show Start Time
          </label>
          {form.showStartTime && <input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />}
        </div>
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 800, color: 'var(--ink-soft)', marginBottom: 5 }}>
            <input type="checkbox" checked={form.showEndTime} onChange={(e) => set('showEndTime', e.target.checked)} /> Show End Time
          </label>
          {form.showEndTime && <input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />}
        </div>
      </div>
      <Field label="Options (comma separated)"><input value={form.optionsText} onChange={(e) => set('optionsText', e.target.value)} placeholder="e.g. Ate all, Ate some, Refused" /></Field>
      <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, margin: '2px 0 10px' }}>
        <input type="checkbox" checked={form.multipleEntriesAllowed} onChange={(e) => set('multipleEntriesAllowed', e.target.checked)} /> Is multiple entries allowed
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!form.name.trim() || act.isPending} onClick={save}>{editing ? 'Save' : 'Create'}</button>
      </div>
    </Modal>
  )
}

export default function DayCareActivities() {
  const { user } = useStore()
  const canManage = MANAGE_ROLES.includes(user.role)
  const { data: activities = [], isLoading, isError, error } = useGet('/daycare-activities')
  const act = useAct(['/daycare-activities'])
  const [modal, setModal] = useState(null) // { activity } | { presetName }
  const [confirm, setConfirm] = useState(null)

  if (isLoading) return <Spinner />
  if (isError) return <div className="card"><Empty emoji="⚠️" text={error?.message || 'Could not load activities'} /></div>

  // Check In / Check Out open the existing master if present, else create prefilled
  const byName = (n) => activities.find((a) => a.name.toLowerCase() === n.toLowerCase())
  const openNamed = (n) => { const ex = byName(n); setModal(ex ? { activity: ex } : { presetName: n }) }

  const sorted = [...activities].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0 }}>Activities</h3>
            <div className="muted" style={{ fontSize: 12.5 }}>Master definitions the Daily / Day-care module logs against per child.</div>
          </div>
          {canManage && <>
            <button className="btn subtle" onClick={() => openNamed('Check In')}><LogIn size={15} /> Check In</button>
            <button className="btn subtle" onClick={() => openNamed('Check Out')}><LogOut size={15} /> Check Out</button>
            <button className="btn" onClick={() => setModal({})}><Plus size={15} /> Add Activities</button>
          </>}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="card"><Empty emoji="🧸" text="No activities defined yet" /></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Activity</th><th>Timing</th><th>Options</th><th>Multiple entries</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {sorted.map((a) => (
                <tr key={a.id}>
                  <td><b>{a.name}</b>{a.isSystem && <Badge color="gray">system</Badge>}{a.description && <div className="muted" style={{ fontSize: 11.5 }}>{a.description}</div>}</td>
                  <td style={{ fontSize: 12.5 }}>
                    {a.showStartTime && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginRight: 8 }}><Clock size={11} />Start{a.startTime ? ` ${a.startTime}` : ''}</span>}
                    {a.showEndTime && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={11} />End{a.endTime ? ` ${a.endTime}` : ''}</span>}
                    {!a.showStartTime && !a.showEndTime && <span className="muted">—</span>}
                  </td>
                  <td style={{ maxWidth: 240 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      {(a.options || []).map((o) => <span key={o} className="badge gray" style={{ fontSize: 10.5 }}>{o}</span>)}
                      {(a.options || []).length === 0 && <span className="muted">—</span>}
                    </div>
                  </td>
                  <td>{a.multipleEntriesAllowed ? <Badge color="green">yes</Badge> : <span className="muted">no</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canManage && <button className="btn sm ghost" onClick={() => setModal({ activity: a })}><Pencil size={13} /></button>}
                    {canManage && <button className="btn sm ghost" style={{ marginLeft: 6 }} onClick={() => setConfirm(a)}><Trash2 size={13} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && <ActivityModal activity={modal.activity} presetName={modal.presetName} onClose={() => setModal(null)} />}
      {confirm && (
        <ConfirmDialog
          title={`Delete “${confirm.name}”?`}
          message="Removes this activity definition (soft-deleted — recoverable). Existing per-child logs are unaffected."
          confirmLabel="Delete"
          busy={act.isPending}
          onConfirm={() => act.mutate({ method: 'del', path: `/daycare-activities/${confirm.id}`, success: 'Activity removed' }, { onSuccess: () => setConfirm(null) })}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
