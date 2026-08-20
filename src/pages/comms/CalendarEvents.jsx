import { useState } from 'react'
import { Plus, Check, X, HelpCircle } from 'lucide-react'
import { useGet, useAct, fmtDate } from '../../api/hooks'
import { Spinner, Empty, Badge, Field, Modal } from '../../components/ui'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function EventModal({ onClose }) {
  const act = useAct(['/events'])
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [type, setType] = useState('other')
  const [description, setDescription] = useState('')
  const [rsvpEnabled, setRsvpEnabled] = useState(false)

  return (
    <Modal title="New event" onClose={onClose}>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Annual Sports Day" autoFocus /></Field>
      <div className="form-row">
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="holiday">Holiday</option>
            <option value="ptm">PTM</option>
            <option value="function">Function</option>
            <option value="other">Other</option>
          </select>
        </Field>
      </div>
      <Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 13.5, marginBottom: 14 }}>
        <input type="checkbox" checked={rsvpEnabled} onChange={(e) => setRsvpEnabled(e.target.checked)} style={{ accentColor: 'var(--marmalade)', width: 16, height: 16 }} />
        Enable RSVP
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!title.trim() || !date} onClick={() => act.mutate(
          { path: '/events', body: { title: title.trim(), date, type, description, rsvpEnabled }, success: 'Event created' },
          { onSuccess: onClose }
        )}>Create event</button>
      </div>
    </Modal>
  )
}

function RsvpModal({ event, onClose }) {
  const { data: rsvps, isLoading } = useGet(`/events/${event.id}/rsvps`)
  return (
    <Modal title={`RSVP — ${event.title}`} onClose={onClose}>
      {isLoading ? <Spinner /> : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <Badge color="green"><Check size={12} /> Yes: {rsvps.counts.yes}</Badge>
            <Badge color="red"><X size={12} /> No: {rsvps.counts.no}</Badge>
            <Badge color="yellow"><HelpCircle size={12} /> Maybe: {rsvps.counts.maybe}</Badge>
          </div>
          <div className="table-wrap" style={{ boxShadow: 'none' }}>
            <table>
              <thead><tr><th>Name</th><th>Response</th></tr></thead>
              <tbody>
                {rsvps.rows.map((r) => <tr key={r.id}><td>{r.userName}</td><td><Badge status={r.response === 'yes' ? 'approved' : r.response === 'no' ? 'rejected' : 'pending'}>{r.response}</Badge></td></tr>)}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  )
}

function CalendarGrid({ events, month, year }) {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const dateStr = (d) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  return (
    <div className="cal-grid">
      {DAYS.map((d) => <div key={d} className="cal-cell head">{d}</div>)}
      {cells.map((d, i) => {
        if (!d) return <div key={`e${i}`} className="cal-cell" />
        const hasEvent = events.some((e) => e.date === dateStr(d))
        const isHoliday = events.some((e) => e.date === dateStr(d) && e.type === 'holiday')
        return (
          <div key={d} className={`cal-cell ${hasEvent ? 'event-dot' : ''}`} style={isHoliday ? { background: 'var(--berry-soft)', color: 'var(--berry)' } : {}}>
            {d}
          </div>
        )
      })}
    </div>
  )
}

export default function CalendarEvents() {
  const { data: events = [], isLoading } = useGet('/events')
  const [creating, setCreating] = useState(false)
  const [rsvpFor, setRsvpFor] = useState(null)
  const act = useAct(['/events'])
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth())
  const [year, setYear] = useState(now.getFullYear())

  const TYPE_COLORS = { holiday: 'red', ptm: 'blue', function: 'orange', other: 'gray' }

  if (isLoading) return <Spinner />

  return (
    <div>
      <div className="page-head">
        <h1>Calendar & Events</h1>
        <div className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}><Plus size={15} /> New event</button>
      </div>

      <div className="two-col">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <button className="btn sm ghost" onClick={() => { if (month === 0) { setMonth(11); setYear(year - 1) } else setMonth(month - 1) }}>‹</button>
            <h3>{new Date(year, month).toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</h3>
            <button className="btn sm ghost" onClick={() => { if (month === 11) { setMonth(0); setYear(year + 1) } else setMonth(month + 1) }}>›</button>
          </div>
          <CalendarGrid events={events} month={month} year={year} />
        </div>

        <div>
          {events.length === 0 && <Empty emoji="📅" text="No events" />}
          {events.sort((a, b) => a.date.localeCompare(b.date)).map((e) => (
            <div className="card" key={e.id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: 15 }}>{e.title}</h3>
                  <div className="muted">{fmtDate(e.date)}</div>
                </div>
                <Badge color={TYPE_COLORS[e.type] || 'gray'}>{e.type}</Badge>
              </div>
              {e.description && <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 6 }}>{e.description}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                {e.rsvpEnabled && <button className="btn sm subtle" onClick={() => setRsvpFor(e)}>RSVP stats</button>}
                <button className="btn sm ghost" onClick={() => act.mutate({ method: 'del', path: `/events/${e.id}`, success: 'Deleted' })}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {creating && <EventModal onClose={() => setCreating(false)} />}
      {rsvpFor && <RsvpModal event={rsvpFor} onClose={() => setRsvpFor(null)} />}
    </div>
  )
}
