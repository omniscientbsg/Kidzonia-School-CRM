import { useGet, useAct, fmtDate } from '../../api/hooks'
import { Spinner, Empty, Badge } from '../../components/ui'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TYPE_COLORS = { holiday: 'red', ptm: 'blue', function: 'orange', other: 'gray' }

export default function ParentCalendar() {
  const { data: events = [], isLoading } = useGet('/parent/events')
  const act = useAct(['/parent/events'])
  const now = new Date()
  const month = now.getMonth()
  const year = now.getFullYear()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const dateStr = (d) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  if (isLoading) return <Spinner />

  return (
    <div>
      <h2 style={{ marginBottom: 14 }}>Calendar</h2>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3 style={{ marginBottom: 10 }}>{now.toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</h3>
        <div className="cal-grid">
          {DAYS.map((d) => <div key={d} className="cal-cell head">{d}</div>)}
          {cells.map((d, i) => {
            if (!d) return <div key={`e${i}`} className="cal-cell" />
            const hasEvent = events.some((e) => e.date === dateStr(d))
            const isHoliday = events.some((e) => e.date === dateStr(d) && e.type === 'holiday')
            return <div key={d} className={`cal-cell ${hasEvent ? 'event-dot' : ''}`} style={isHoliday ? { background: 'var(--berry-soft)', color: 'var(--berry)' } : {}}>{d}</div>
          })}
        </div>
      </div>

      <h3 style={{ marginBottom: 10 }}>Upcoming</h3>
      {events.length === 0 && <Empty emoji="📅" text="No events" />}
      {events.filter((e) => e.date >= now.toISOString().slice(0, 10)).map((e) => (
        <div className="card" key={e.id} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <b>{e.title}</b>
              <div className="muted">{fmtDate(e.date)}</div>
            </div>
            <Badge color={TYPE_COLORS[e.type] || 'gray'}>{e.type}</Badge>
          </div>
          {e.description && <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>{e.description}</p>}
          {e.rsvpEnabled && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              {['yes', 'no', 'maybe'].map((r) => (
                <button
                  key={r}
                  className={`btn sm ${e.myRsvp === r ? '' : 'ghost'}`}
                  style={{ textTransform: 'capitalize' }}
                  onClick={() => act.mutate({ path: `/events/${e.id}/rsvp`, body: { response: r }, success: `RSVP: ${r}` })}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
