import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, Trash2, ArrowLeft } from 'lucide-react'
import { useGet, useAct } from '../../../api/hooks'
import { Spinner, Field } from '../../../components/ui'
import { useStore } from '../../../store/useStore'

// Auto-suggest a short code from a class name, e.g. "Kidzo Junior KG" -> "KZ-JKG"
function suggestCode(name) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  return `KZ-${words.map((w) => w[0].toUpperCase()).join('').slice(0, 4)}`
}

const toMonths = (y, m) => (Number(y) || 0) * 12 + (Number(m) || 0)
const splitMonths = (mo) => ({ y: Math.floor((mo || 0) / 12), m: (mo || 0) % 12 })
const blankSection = () => ({ key: Math.random().toString(36).slice(2), id: null, name: '', capacity: 20, room: '', teacherId: '' })

// ---- Loader wrapper: waits for data, then mounts the form with a clean initial state ----
export default function ClassForm() {
  const { id } = useParams()
  const editing = !!id
  const { activeSessionId } = useStore()
  const { data: sessions = [], isLoading: lsess } = useGet('/academic-years')
  const { data: programs = [] } = useGet('/programs')
  const { data: users = [] } = useGet('/users')
  const { data: allSections = [], isLoading: lsec } = useGet('/sections')
  const { data: existing, isLoading: lcls } = useGet(editing ? `/classes/${id}` : '/health', { enabled: editing })

  if (lsess || lsec || (editing && lcls)) return <Spinner />
  if (editing && !existing) return <div className="card"><p className="muted">Class not found.</p></div>

  let initial
  if (editing) {
    const secs = allSections.filter((s) => s.classId === existing.id)
    initial = {
      name: existing.name || '', sessionId: existing.academicYearId || '', code: existing.code || '',
      programId: existing.programId || '', classTeacherId: existing.classTeacherId || '',
      assistantTeacherIds: existing.assistantTeacherIds || [], capacity: existing.capacity ?? 40,
      minY: splitMonths(existing.ageMinMonths).y, minM: splitMonths(existing.ageMinMonths).m,
      maxY: splitMonths(existing.ageMaxMonths).y, maxM: splitMonths(existing.ageMaxMonths).m,
      sections: secs.length
        ? secs.map((s) => ({ key: s.id, id: s.id, name: s.name, capacity: s.capacity ?? 20, room: s.room || '', teacherId: s.teacherId || '' }))
        : [{ ...blankSection(), name: 'A' }],
      codeTouched: true,
    }
  } else {
    initial = {
      name: '', sessionId: activeSessionId || sessions.find((s) => s.active)?.id || '', code: '',
      programId: '', classTeacherId: '', assistantTeacherIds: [], capacity: 40,
      minY: 0, minM: 0, maxY: 0, maxM: 0, sections: [{ ...blankSection(), name: 'A' }], codeTouched: false,
    }
  }

  return <ClassFormInner editing={editing} classId={id} initial={initial} sessions={sessions} programs={programs} users={users} allSections={allSections} />
}

function ClassFormInner({ editing, classId, initial, sessions, programs, users, allSections }) {
  const navigate = useNavigate()
  const act = useAct(['/classes', '/sections', '/class-stats'])
  const [form, setForm] = useState(initial)
  const [codeTouched, setCodeTouched] = useState(initial.codeTouched)
  const [saving, setSaving] = useState(false)

  const openSessions = sessions.filter((s) => !s.archived)
  const session = sessions.find((s) => s.id === form.sessionId)
  const branchId = session?.branchId
  const teachers = users.filter((u) => u.role === 'teacher' && (!branchId || !u.branchId || u.branchId === branchId))

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setName = (v) => setForm((f) => ({ ...f, name: v, code: codeTouched ? f.code : suggestCode(v) }))
  const setSection = (i, k, v) => setForm((f) => ({ ...f, sections: f.sections.map((s, idx) => (idx === i ? { ...s, [k]: v } : s)) }))
  const addSection = () => setForm((f) => ({ ...f, sections: [...f.sections, blankSection()] }))
  const removeSection = (i) => setForm((f) => ({ ...f, sections: f.sections.filter((_, idx) => idx !== i) }))
  const toggleAssistant = (uid) => setForm((f) => ({
    ...f, assistantTeacherIds: f.assistantTeacherIds.includes(uid) ? f.assistantTeacherIds.filter((x) => x !== uid) : [...f.assistantTeacherIds, uid],
  }))

  const minMonths = toMonths(form.minY, form.minM)
  const maxMonths = toMonths(form.maxY, form.maxM)
  const ageOk = maxMonths === 0 || minMonths < maxMonths
  const valid = form.name.trim() && form.sessionId && form.classTeacherId && ageOk && form.sections.every((s) => s.name.trim())

  async function submit() {
    setSaving(true)
    try {
      const classBody = {
        name: form.name.trim(), academicYearId: form.sessionId, branchId,
        code: form.code.trim() || suggestCode(form.name), programId: form.programId || null,
        classTeacherId: form.classTeacherId, assistantTeacherIds: form.assistantTeacherIds,
        capacity: Number(form.capacity) || null, ageMinMonths: minMonths, ageMaxMonths: maxMonths, active: true,
      }
      let cid = classId
      if (editing) {
        await act.mutateAsync({ method: 'put', path: `/classes/${classId}`, body: classBody })
        const originalIds = allSections.filter((s) => s.classId === classId).map((s) => s.id)
        const keptIds = form.sections.filter((s) => s.id).map((s) => s.id)
        for (const oid of originalIds) if (!keptIds.includes(oid)) await act.mutateAsync({ method: 'del', path: `/sections/${oid}` })
        for (const s of form.sections) {
          const body = { name: s.name.trim(), capacity: Number(s.capacity) || null, room: s.room.trim() || null, teacherId: s.teacherId || null, classId }
          if (s.id) await act.mutateAsync({ method: 'put', path: `/sections/${s.id}`, body })
          else await act.mutateAsync({ path: '/sections', body })
        }
      } else {
        const created = await act.mutateAsync({ path: '/classes', body: classBody })
        cid = created.id
        for (const s of form.sections) {
          await act.mutateAsync({ path: '/sections', body: { classId: cid, name: s.name.trim(), capacity: Number(s.capacity) || null, room: s.room.trim() || null, teacherId: s.teacherId || null } })
        }
      }
      toast.success(editing ? 'Class updated' : 'Class created')
      navigate('/setup/classes')
    } catch (err) {
      toast.error(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <button className="btn sm ghost" onClick={() => navigate('/setup/classes')} style={{ marginBottom: 12 }}><ArrowLeft size={13} /> Back to classes</button>
      <div className="card" style={{ maxWidth: 760 }}>
        <div className="card-title"><h3>{editing ? 'Edit class' : 'Create class'}</h3></div>

        <Field label="Class name *"><input value={form.name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kidzo Nursery" autoFocus /></Field>

        <div className="form-row">
          <Field label="Session *">
            <select value={form.sessionId} onChange={(e) => set('sessionId', e.target.value)}>
              {openSessions.map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? ' (active)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Class code">
            <input value={form.code} onChange={(e) => { setCodeTouched(true); set('code', e.target.value) }} placeholder="auto" />
          </Field>
        </div>

        <div className="form-row">
          <Field label="Program (optional)">
            <select value={form.programId} onChange={(e) => set('programId', e.target.value)}>
              <option value="">— none —</option>
              {programs.filter((p) => !branchId || p.branchId === branchId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Class capacity"><input type="number" min="0" value={form.capacity} onChange={(e) => set('capacity', e.target.value)} /></Field>
        </div>

        <Field label="Class Teacher (primary) *">
          <select value={form.classTeacherId} onChange={(e) => set('classTeacherId', e.target.value)}>
            <option value="">— select —</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>

        <Field label="Assistant / subject teachers">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {teachers.filter((t) => t.id !== form.classTeacherId).map((t) => {
              const on = form.assistantTeacherIds.includes(t.id)
              return (
                <button type="button" key={t.id} onClick={() => toggleAssistant(t.id)} className={`badge ${on ? 'orange' : 'gray'}`} style={{ cursor: 'pointer', border: 'none' }}>
                  {on ? '✓ ' : ''}{t.name}
                </button>
              )
            })}
            {teachers.length <= 1 && <span className="muted" style={{ fontSize: 12.5 }}>No other teachers in this branch.</span>}
          </div>
        </Field>

        <div className="form-row">
          <Field label="Min age (yr / mo)">
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" min="0" value={form.minY} onChange={(e) => set('minY', e.target.value)} style={{ width: '50%' }} />
              <input type="number" min="0" max="11" value={form.minM} onChange={(e) => set('minM', e.target.value)} style={{ width: '50%' }} />
            </div>
          </Field>
          <Field label="Max age (yr / mo)">
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" min="0" value={form.maxY} onChange={(e) => set('maxY', e.target.value)} style={{ width: '50%' }} />
              <input type="number" min="0" max="11" value={form.maxM} onChange={(e) => set('maxM', e.target.value)} style={{ width: '50%' }} />
            </div>
          </Field>
        </div>
        {!ageOk && <div style={{ color: 'var(--berry)', fontSize: 12.5, marginTop: -6, marginBottom: 10 }}>Min age must be less than max age.</div>}

        <div className="card-title" style={{ marginTop: 8 }}>
          <h3 style={{ fontSize: 15 }}>Sections</h3>
          <button className="btn sm subtle" onClick={addSection}><Plus size={13} /> Add section</button>
        </div>
        {form.sections.map((s, i) => (
          <div key={s.key} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr 1.4fr auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
            <Field label="Name"><input value={s.name} onChange={(e) => setSection(i, 'name', e.target.value)} placeholder="A" /></Field>
            <Field label="Seats"><input type="number" min="0" value={s.capacity} onChange={(e) => setSection(i, 'capacity', e.target.value)} /></Field>
            <Field label="Room"><input value={s.room} onChange={(e) => setSection(i, 'room', e.target.value)} placeholder="optional" /></Field>
            <Field label="Section teacher">
              <select value={s.teacherId} onChange={(e) => setSection(i, 'teacherId', e.target.value)}>
                <option value="">—</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <button className="btn sm ghost" style={{ marginBottom: 13 }} onClick={() => removeSection(i)} disabled={form.sections.length === 1} title="Remove section"><Trash2 size={13} /></button>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn ghost" onClick={() => navigate('/setup/classes')} disabled={saving}>Cancel</button>
          <button className="btn" disabled={!valid || saving} onClick={submit}>{editing ? 'Save changes' : 'Create class'}</button>
        </div>
      </div>
    </div>
  )
}
