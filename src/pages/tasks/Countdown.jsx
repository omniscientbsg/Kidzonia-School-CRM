import { useEffect, useState } from 'react'
import { Timer } from 'lucide-react'
import { countdown } from '../../services/tasks/status'

// Live "3h 12m left" for a task closing at the end of the school's day.
// Ticks locally; the deadline itself came from the server in the school's zone.
export default function Countdown({ inst, big = false }) {
  const [now, setNow] = useState(() => Date.now())   // lazy: no clock read during render

  useEffect(() => {
    const initial = countdown(inst, Date.now())
    if (!initial || initial.expired) return
    // once a minute is enough above an hour; every second in the last minute
    const fast = Date.parse(inst.dueAt) - Date.now() < 60000
    const id = setInterval(() => setNow(Date.now()), fast ? 1000 : 30000)
    return () => clearInterval(id)
  }, [inst.dueAt, inst.status])   // eslint-disable-line react-hooks/exhaustive-deps

  const left = countdown(inst, now)
  if (!left) return null
  const color = left.expired || left.urgent ? 'var(--berry)' : 'var(--marmalade-deep)'
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color, fontWeight: 700, fontSize: big ? 13.5 : 12 }}
      title={`Due ${new Date(inst.dueAt).toLocaleString('en-IN', { timeZone: inst.tz || 'Asia/Kolkata' })} (${inst.tz})`}
    >
      <Timer size={big ? 14 : 11} />
      {left.text}
    </span>
  )
}
