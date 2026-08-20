import { useState } from 'react'
import { Plus, FileText } from 'lucide-react'
import { useGet, useAct, fmtDate } from '../../api/hooks'
import { Spinner, Empty, Badge, Field, Modal } from '../../components/ui'

function CreateHomeworkModal({ sections, onClose }) {
  const act = useAct(['/homework'])
  const [sectionId, setSectionId] = useState(sections[0]?.id || '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')

  return (
    <Modal title="Assign homework" onClose={onClose}>
      <Field label="Section">
        <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          {sections.map((s) => <option key={s.id} value={s.id}>{s.className} — {s.name}</option>)}
        </select>
      </Field>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Math worksheet Ch 4" autoFocus /></Field>
      <Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details, page numbers…" /></Field>
      <Field label="Due date"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!title.trim()} onClick={() => act.mutate(
          { path: '/homework', body: { sectionId, title: title.trim(), description, dueDate: dueDate || null }, success: 'Homework assigned — parents notified' },
          { onSuccess: onClose }
        )}>Assign</button>
      </div>
    </Modal>
  )
}

export default function HomeworkPage() {
  const { data: sections = [] } = useGet('/sections')
  const { data: classes = [] } = useGet('/classes')
  const secs = sections.map((s) => ({ ...s, className: classes.find((c) => c.id === s.classId)?.name || '' }))
  const [sectionFilter, setSectionFilter] = useState('')
  const path = sectionFilter ? `/homework?sectionId=${sectionFilter}` : '/homework'
  const { data: homework = [], isLoading } = useGet(path)
  const [creating, setCreating] = useState(false)
  const act = useAct(['/homework'])

  if (isLoading) return <Spinner />

  return (
    <div>
      <div className="page-head">
        <h1>Homework</h1>
        <div className="spacer" />
        <div className="filters">
          <select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
            <option value="">All sections</option>
            {secs.map((s) => <option key={s.id} value={s.id}>{s.className} — {s.name}</option>)}
          </select>
          <button className="btn" onClick={() => setCreating(true)}><Plus size={15} /> Assign</button>
        </div>
      </div>

      {homework.length === 0 && <Empty emoji="📚" text="No homework assigned" />}
      <div className="card">
        {homework.map((hw) => {
          const sec = sections.find((s) => s.id === hw.sectionId)
          const cls = sec ? classes.find((c) => c.id === sec.classId) : null
          return (
            <div key={hw.id} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid #f4efe6', alignItems: 'flex-start' }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--sky-soft)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <FileText size={18} color="var(--sky)" />
              </div>
              <div style={{ flex: 1 }}>
                <b>{hw.title}</b>
                {hw.description && <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 2 }}>{hw.description}</div>}
                <div className="muted" style={{ marginTop: 3 }}>
                  {cls?.name || ''}{sec ? ` — ${sec.name}` : ''} · Posted {fmtDate(hw.createdAt)}
                  {hw.dueDate && <> · Due <b style={{ color: new Date(hw.dueDate) < new Date() ? 'var(--berry)' : 'var(--ink)' }}>{fmtDate(hw.dueDate)}</b></>}
                </div>
              </div>
              <button className="btn sm ghost" onClick={() => act.mutate({ method: 'del', path: `/homework/${hw.id}`, success: 'Deleted' })}>Delete</button>
            </div>
          )
        })}
      </div>

      {creating && <CreateHomeworkModal sections={secs} onClose={() => setCreating(false)} />}
    </div>
  )
}
