import { useEffect, useState } from 'react'
import { useGet, useAct, todayISO, initials } from '../../api/hooks'
import { Spinner, Empty, Badge, Field, Modal } from '../../components/ui'

const LOG_TYPES = ['meal', 'nap', 'diaper', 'mood', 'health']
const LOG_EMOJI = { meal: '🍽️', nap: '😴', diaper: '🧷', mood: '😊', health: '🩺' }
const MEAL_OPTIONS = ['all', 'some', 'none']
const MOOD_OPTIONS = ['happy', 'calm', 'cranky', 'sleepy', 'upset']

function LogEntryModal({ studentId, studentName, onClose }) {
  const act = useAct(['/daily-logs'])
  const [type, setType] = useState('meal')
  const [data, setData] = useState({})

  function reset(t) {
    setType(t)
    if (t === 'meal') setData({ meal: 'lunch', items: '', ate: 'all', newFood: '' })
    else if (t === 'nap') setData({ start: '', end: '' })
    else if (t === 'diaper') setData({ time: '', kind: 'wet' })
    else if (t === 'mood') setData({ mood: 'happy', note: '' })
    else if (t === 'health') setData({ flag: '', note: '' })
  }

  useEffect(() => { reset('meal') }, [])

  return (
    <Modal title={`Log for ${studentName}`} onClose={onClose}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {LOG_TYPES.map((t) => (
          <button key={t} className={`btn sm ${type === t ? '' : 'ghost'}`} onClick={() => reset(t)}>
            {LOG_EMOJI[t]} {t}
          </button>
        ))}
      </div>

      {type === 'meal' && (
        <>
          <div className="form-row">
            <Field label="Meal"><select value={data.meal} onChange={(e) => setData({ ...data, meal: e.target.value })}>
              <option>breakfast</option><option>lunch</option><option>snack</option><option>dinner</option>
            </select></Field>
            <Field label="How much"><select value={data.ate} onChange={(e) => setData({ ...data, ate: e.target.value })}>
              {MEAL_OPTIONS.map((o) => <option key={o}>{o}</option>)}
            </select></Field>
          </div>
          <Field label="Items"><input value={data.items} onChange={(e) => setData({ ...data, items: e.target.value })} placeholder="Dal rice, fruits…" /></Field>
          <Field label="New food tried"><input value={data.newFood} onChange={(e) => setData({ ...data, newFood: e.target.value })} /></Field>
        </>
      )}
      {type === 'nap' && (
        <div className="form-row">
          <Field label="Started"><input type="time" value={data.start} onChange={(e) => setData({ ...data, start: e.target.value })} /></Field>
          <Field label="Ended"><input type="time" value={data.end} onChange={(e) => setData({ ...data, end: e.target.value })} /></Field>
        </div>
      )}
      {type === 'diaper' && (
        <div className="form-row">
          <Field label="Time"><input type="time" value={data.time} onChange={(e) => setData({ ...data, time: e.target.value })} /></Field>
          <Field label="Kind"><select value={data.kind} onChange={(e) => setData({ ...data, kind: e.target.value })}>
            <option>wet</option><option>soiled</option><option>dry</option>
          </select></Field>
        </div>
      )}
      {type === 'mood' && (
        <>
          <Field label="Mood">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {MOOD_OPTIONS.map((m) => (
                <button key={m} className={`btn sm ${data.mood === m ? '' : 'ghost'}`} onClick={() => setData({ ...data, mood: m })} style={{ textTransform: 'capitalize' }}>{m}</button>
              ))}
            </div>
          </Field>
          <Field label="Note"><input value={data.note || ''} onChange={(e) => setData({ ...data, note: e.target.value })} /></Field>
        </>
      )}
      {type === 'health' && (
        <>
          <Field label="Flag"><input value={data.flag || ''} onChange={(e) => setData({ ...data, flag: e.target.value })} placeholder="e.g. fever, cough, rash" /></Field>
          <Field label="Note"><textarea value={data.note || ''} onChange={(e) => setData({ ...data, note: e.target.value })} /></Field>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={() => act.mutate(
          { path: '/daily-logs', body: { studentId, type, data }, success: `${type} log saved` },
          { onSuccess: onClose }
        )}>Save log</button>
      </div>
    </Modal>
  )
}

export default function DailyLogs() {
  const { data: sections = [] } = useGet('/sections')
  const { data: classes = [] } = useGet('/classes')
  const [sectionId, setSectionId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [logFor, setLogFor] = useState(null)
  const act = useAct(['/daily-logs'])

  useEffect(() => { if (!sectionId && sections.length) setSectionId(sections[0].id) }, [sections, sectionId])

  const sectionName = (s) => `${classes.find((c) => c.id === s.classId)?.name || ''} — ${s.name}`
  const logsPath = sectionId ? `/daily-logs?sectionId=${sectionId}&date=${date}` : null
  const { data: logs = [], isLoading } = useGet(logsPath || '/daily-logs?sectionId=none', { enabled: !!sectionId })

  // Group logs by student
  const { data: att = [] } = useGet(sectionId ? `/attendance?sectionId=${sectionId}&date=${date}` : '/attendance?sectionId=none&date=none', { enabled: !!sectionId })
  const students = att.map((r) => ({
    ...r,
    logs: logs.filter((l) => l.studentId === r.studentId),
  }))

  return (
    <div>
      <div className="page-head">
        <h1>Daily Logs</h1>
        <div className="spacer" />
        <div className="filters">
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {sections.map((s) => <option key={s.id} value={s.id}>{sectionName(s)}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {isLoading && <Spinner />}
      {!isLoading && students.length === 0 && <Empty emoji="📝" text="No students in this section" />}
      {!isLoading && students.length > 0 && (
        <div className="card">
          {students.map((s) => (
            <div key={s.studentId} className="att-row" style={{ cursor: 'pointer' }} onClick={() => setLogFor(s)}>
              <span className="avatar">{initials(s.name)}</span>
              <div style={{ flex: 1 }}>
                <b>{s.name}</b>
                <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                  {s.logs.length === 0 && <span className="muted">No logs yet</span>}
                  {s.logs.map((l) => (
                    <Badge key={l.id} color="gray">
                      {LOG_EMOJI[l.type]} {l.type}
                      {l.type === 'meal' ? `: ${l.data?.ate || ''}` : ''}
                      {l.type === 'nap' ? `: ${l.data?.start || ''}–${l.data?.end || ''}` : ''}
                      {l.type === 'mood' ? `: ${l.data?.mood || ''}` : ''}
                    </Badge>
                  ))}
                </div>
              </div>
              <button className="btn sm subtle" onClick={(e) => { e.stopPropagation(); setLogFor(s) }}>+ Log</button>
            </div>
          ))}
        </div>
      )}

      {logFor && <LogEntryModal studentId={logFor.studentId} studentName={logFor.name} onClose={() => setLogFor(null)} />}
    </div>
  )
}
