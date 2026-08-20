import { NavLink, Outlet } from 'react-router-dom'
import { useOrgMe } from '../../services/org/api'

const SUB_NAV = [
  { to: '/org', text: 'Org Chart', end: true },
  { to: '/org/levels', text: 'Levels & Tiers' },
  { to: '/org/positions', text: 'People & Positions' },
]

export default function OrgLayout() {
  const { data: me } = useOrgMe()
  return (
    <div>
      <div className="page-head">
        <h1>Organisation</h1>
        <div className="spacer" />
        {me?.tier && (
          <span className="muted">
            You are <b style={{ color: 'var(--ink)' }}>{me.tier}</b> · level {me.depth} ·{' '}
            {me.downlineCount} {me.downlineCount === 1 ? 'person' : 'people'} below you
          </span>
        )}
      </div>
      <div className="tabs">
        {SUB_NAV.map((s) => (
          <NavLink key={s.to} to={s.to} end={s.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            {s.text}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  )
}
