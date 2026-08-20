import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Home, CalendarCheck, Wallet, MessageCircle, Bell, User, BookOpen, CalendarDays, Plane, FileText } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useGet } from '../api/hooks'

const NAV = [
  { to: '/parent', icon: Home, text: 'Home', end: true },
  { to: '/parent/attendance', icon: CalendarCheck, text: 'Attendance' },
  { to: '/parent/fees', icon: Wallet, text: 'Fees' },
  { to: '/parent/chat', icon: MessageCircle, text: 'Chat' },
  { to: '/parent/notices', icon: Bell, text: 'Notices' },
]

export default function ParentLayout() {
  const { user, logout, activeChildId, setActiveChild } = useStore()
  const navigate = useNavigate()
  const { data: children = [] } = useGet('/parent/children')

  useEffect(() => {
    if (children.length && !activeChildId) setActiveChild(children[0].id)
  }, [children, activeChildId, setActiveChild])

  return (
    <div className="parent-shell">
      <div className="parent-head">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.7 }}>Welcome back</div>
            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)' }}>{user.name}</div>
          </div>
          <button
            onClick={() => { logout(); navigate('/login') }}
            style={{ background: 'rgba(255,255,255,0.14)', border: '1.5px solid rgba(255,255,255,0.25)', color: '#fff', padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
          >
            Log out
          </button>
        </div>
        {children.length > 1 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {children.map((c) => (
              <button
                key={c.id}
                className={`child-chip ${activeChildId === c.id ? 'on' : ''}`}
                onClick={() => setActiveChild(c.id)}
              >
                {c.firstName} {c.lastName}
                {c.className && <span style={{ opacity: 0.75, fontSize: 11 }}> · {c.className}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="parent-content">
        <Outlet context={{ children, activeChildId }} />
      </div>

      <nav className="parent-nav">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? 'active' : ''}>
            <item.icon />
            {item.text}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
