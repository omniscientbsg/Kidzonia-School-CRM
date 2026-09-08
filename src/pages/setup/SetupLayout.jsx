import { NavLink, Outlet } from 'react-router-dom'
import { useStore } from '../../store/useStore'

// Sub-sections of the Setup / Administration module. `ready:false` renders a
// disabled placeholder so the roadmap is visible while we build one at a time.
const SUB_NAV = [
  { to: '/setup', text: 'Overview', end: true, ready: true },
  { to: '/setup/sessions', text: 'Sessions', ready: true },
  { to: '/setup/classes', text: 'Classes', ready: true },
  { to: '/setup/staff', text: 'Staff', ready: true },
  { to: '/setup/daycare/activities', text: 'Day Care', ready: true },
  { to: '/setup/groups', text: 'Groups', ready: true },
  { to: '/setup/task-setup', text: 'Task setup', ready: true },
  // Organisation stays on its own route: OrgLayout renders its own heading and
  // tab strip, and nesting it here would double both. This is a link across, not
  // a move.
  { to: '/org', text: 'Organisation', ready: true },
]

// Only super_admin and branch_admin manage setup; daycare_staff (later) sees a subset.
const SETUP_ROLES = ['super_admin', 'branch_admin', 'daycare_staff']

export default function SetupLayout() {
  const { user } = useStore()
  const canManage = SETUP_ROLES.includes(user.role)
  return (
    <div>
      <div className="page-head">
        <h1>Setup / Administration</h1>
      </div>
      {!canManage && (
        <div className="card" style={{ marginBottom: 16 }}>
          <span className="muted">You have read-only access to setup data.</span>
        </div>
      )}
      <div className="tabs">
        {SUB_NAV.map((s) =>
          s.ready ? (
            <NavLink key={s.to} to={s.to} end={s.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
              {s.text}
            </NavLink>
          ) : (
            <span key={s.to} className="tab" style={{ opacity: 0.4, cursor: 'not-allowed' }} title="Coming soon">
              {s.text}
            </span>
          )
        )}
      </div>
      <Outlet />
    </div>
  )
}
