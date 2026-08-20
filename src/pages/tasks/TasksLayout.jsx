import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useOrgMe } from '../../services/org/api'
import { useMyTasks, useApprovals, useDayEndReceived } from '../../services/tasks/api'

export default function TasksLayout() {
  const navigate = useNavigate()
  const { data: me } = useOrgMe()
  const { data: my } = useMyTasks({ poll: 60000 })
  const { data: approvals = [] } = useApprovals()
  const { data: dayEnd } = useDayEndReceived()

  const open = (my?.overdue?.length || 0) + (my?.dueToday?.length || 0)
  const waiting = approvals.length + (dayEnd?.received || 0)

  // Four tabs, not seven. "Assigned by me", "Blocked" and "Day-end" were three
  // separate answers to one question — how is my team doing — so they live
  // together under Team.
  const tabs = [
    { to: '/tasks', text: `Today${open ? ` (${open})` : ''}`, end: true },
    { to: '/tasks/mine', text: 'All my tasks' },
    { to: '/tasks/approvals', text: `Needs me${waiting ? ` (${waiting})` : ''}` },
    { to: '/tasks/assigned', text: 'My team' },
    { to: '/tasks/reports', text: 'Reports' },
  ]

  return (
    <div>
      <div className="page-head">
        <h1>Tasks</h1>
        <div className="spacer" />
        {me?.tier && <span className="muted">{me.tier} · {me.downlineCount} below you</span>}
        {me?.canAssign && (
          <button className="btn" onClick={() => navigate('/tasks/new')}><Plus size={14} /> Assign task</button>
        )}
      </div>
      <div className="tabs">
        {tabs.map((s) => (
          <NavLink key={s.to} to={s.to} end={s.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            {s.text}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  )
}
