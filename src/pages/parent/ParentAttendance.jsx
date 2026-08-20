import { useState } from 'react'
import { useGet } from '../../api/hooks'
import { Spinner, Badge } from '../../components/ui'
import { useStore } from '../../store/useStore'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function ParentAttendance() {
  const { activeChildId } = useStore()
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const { data, isLoading } = useGet(`/parent/children/${activeChildId}/attendance?month=${month}`, { enabled: !!activeChildId })

  if (!activeChildId) return <Spinner />

  const [y, m] = month.split('-').map(Number)
  const firstDay = new Date(y, m - 1, 1).getDay()
  const daysInMonth = new Date(y, m, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const recordMap = {}
  if (data?.records) {
    for (const r of data.records) {
      const day = Number(r.date.slice(8, 10))
      recordMap[day] = r.status
    }
  }

  return (
    <div>
      <h2 style={{ marginBottom: 14 }}>Attendance</h2>

      {data && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <Badge color="green">Present: {data.counts.present}</Badge>
          <Badge color="red">Absent: {data.counts.absent}</Badge>
          <Badge color="yellow">Late: {data.counts.late}</Badge>
          <Badge color="blue">Leave: {data.counts.leave || 0}</Badge>
          {data.pct != null && <Badge color="gray">{data.pct}%</Badge>}
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <button className="btn sm ghost" onClick={() => {
            const d = new Date(y, m - 2, 1)
            setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
          }}>‹</button>
          <h3>{new Date(y, m - 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</h3>
          <button className="btn sm ghost" onClick={() => {
            const d = new Date(y, m, 1)
            setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
          }}>›</button>
        </div>

        {isLoading ? <Spinner /> : (
          <div className="cal-grid">
            {DAYS.map((d) => <div key={d} className="cal-cell head">{d}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} className="cal-cell" />
              const status = recordMap[d] || ''
              return <div key={d} className={`cal-cell ${status}`}>{d}</div>
            })}
          </div>
        )}
      </div>
    </div>
  )
}
