import { Link } from 'react-router-dom'
import { CalendarRange, School, UserCog, Baby, Users, ListChecks, Network } from 'lucide-react'
import { useGet } from '../../api/hooks'
import { useStore } from '../../store/useStore'
import { StatCard } from '../../components/ui'

const CARDS = [
  { to: '/setup/sessions', icon: CalendarRange, title: 'Sessions', desc: 'Academic years — activate the current session', ready: true },
  { to: '/setup/classes', icon: School, title: 'Classes', desc: 'Classes, sections, promotion & breakups', ready: true },
  { to: '/setup/staff', icon: UserCog, title: 'Staff', desc: 'Staff, attendance & access rights', ready: true },
  { to: '/setup/daycare/activities', icon: Baby, title: 'Day Care', desc: 'Activities feed & weekly meal menu', ready: true },
  { to: '/setup/groups', icon: Users, title: 'Groups', desc: 'Cross-class cohorts', ready: true },
  { to: '/setup/task-setup', icon: ListChecks, title: 'Task setup', desc: 'Categories, priorities, tags, templates & escalation', ready: true },
  { to: '/org', icon: Network, title: 'Organisation', desc: 'Org chart, tiers & who reports to whom', ready: true },
]

export default function Overview() {
  const { activeSessionId } = useStore()
  const { data: sessions = [] } = useGet('/academic-years')
  const { data: classes = [] } = useGet('/classes')
  const active = sessions.find((s) => s.id === activeSessionId) || sessions.find((s) => s.active)

  return (
    <div>
      <div className="stat-grid">
        <StatCard label="Active session" value={active?.name || '—'} sub={active ? `${active.startDate} → ${active.endDate}` : 'No active session'} />
        <StatCard label="Sessions" value={sessions.length} tone="blue" />
        <StatCard label="Classes" value={classes.length} tone="green" />
      </div>
      <div className="stat-grid">
        {CARDS.map((c) => (
          <Link
            key={c.to}
            to={c.ready ? c.to : '#'}
            className="card"
            style={{ textDecoration: 'none', color: 'inherit', display: 'block', opacity: c.ready ? 1 : 0.55, pointerEvents: c.ready ? 'auto' : 'none' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <c.icon size={20} />
              <b>{c.title}</b>
              {!c.ready && <span className="badge gray" style={{ marginLeft: 'auto' }}>soon</span>}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>{c.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
