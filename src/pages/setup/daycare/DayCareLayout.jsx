import { NavLink, Outlet } from 'react-router-dom'

export default function DayCareLayout() {
  return (
    <div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        <NavLink to="/setup/daycare/activities" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>Activities</NavLink>
        <NavLink to="/setup/daycare/meals" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>Meals</NavLink>
      </div>
      <Outlet />
    </div>
  )
}
