import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useGet, useAct } from '../../api/hooks'
import { Field, Modal, Spinner } from '../../components/ui'

export default function ClassesSections() {
  const { data: classes = [], isLoading } = useGet('/classes')
  const { data: sections = [] } = useGet('/sections')
  const { data: users = [] } = useGet('/users?role=teacher')
  const { data: students = [] } = useGet('/students?status=active')
  const act = useAct(['/sections', '/classes'])
  const [adding, setAdding] = useState(null) // classId
  const [form, setForm] = useState({ name: '', capacity: 20, teacherId: '' })

  if (isLoading) return <Spinner />
  const enrolledCount = (sectionId) => students.filter((s) => s.sectionId === sectionId).length

  return (
    <div>
      <div className="page-head"><h1>Classes & sections</h1></div>
      {classes.map((cls) => (
        <div className="card" key={cls.id}>
          <div className="card-title">
            <h3>{cls.name}</h3>
            <button className="btn sm subtle" onClick={() => { setAdding(cls.id); setForm({ name: '', capacity: 20, teacherId: '' }) }}>
              <Plus size={13} /> Add section
            </button>
          </div>
          <div className="table-wrap" style={{ boxShadow: 'none' }}>
            <table>
              <thead><tr><th>Section</th><th>Enrolled / Capacity</th><th>Class teacher</th></tr></thead>
              <tbody>
                {sections.filter((s) => s.classId === cls.id).map((s) => (
                  <tr key={s.id}>
                    <td><b>{cls.name} — {s.name}</b></td>
                    <td>
                      {enrolledCount(s.id)} /{' '}
                      <input
                        type="number" defaultValue={s.capacity} style={{ width: 64, padding: '4px 7px', border: '1.5px solid var(--line)', borderRadius: 7 }}
                        onBlur={(e) => Number(e.target.value) !== s.capacity && act.mutate({ method: 'put', path: `/sections/${s.id}`, body: { capacity: Number(e.target.value) }, success: 'Capacity updated' })}
                      />
                    </td>
                    <td>
                      <select
                        value={s.teacherId || ''}
                        onChange={(e) => act.mutate({ method: 'put', path: `/sections/${s.id}`, body: { teacherId: e.target.value || null }, success: 'Teacher assigned' })}
                        style={{ padding: '5px 9px', border: '1.5px solid var(--line)', borderRadius: 8 }}
                      >
                        <option value="">Unassigned</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {adding && (
        <Modal title="New section" onClose={() => setAdding(null)}>
          <div className="form-row">
            <Field label="Section name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. C" autoFocus /></Field>
            <Field label="Capacity"><input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} /></Field>
          </div>
          <Field label="Class teacher">
            <select value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })}>
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setAdding(null)}>Cancel</button>
            <button
              className="btn" disabled={!form.name}
              onClick={() => act.mutate({ path: '/sections', body: { ...form, classId: adding, teacherId: form.teacherId || null }, success: 'Section created' }, { onSuccess: () => setAdding(null) })}
            >
              Create
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
