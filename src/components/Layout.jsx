import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, UserPlus, GraduationCap, CalendarCheck, Plane,
  Wallet, ReceiptText, PiggyBank, BookOpen, Camera, ClipboardCheck, Baby,
  MessageCircle, Megaphone, CalendarDays, FileText, Settings, Bell, LogOut,
  School, Bus, UserCog, Album, NotebookPen, LibraryBig, Award,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { useGet, useAct, fmtDateTime } from '../api/hooks'

const NAV = [
  { label: 'Overview', items: [
    { to: '/', icon: LayoutDashboard, text: 'Dashboard', roles: 'all', end: true },
  ]},
  { label: 'CRM', roles: ['super_admin', 'branch_admin', 'front_desk'], items: [
    { to: '/crm/leads', icon: UserPlus, text: 'Enquiries / Leads' },
  ]},
  { label: 'Admissions', roles: ['super_admin', 'branch_admin', 'front_desk'], items: [
    { to: '/admissions', icon: GraduationCap, text: 'Applications' },
  ]},
  { label: 'Students', roles: ['super_admin', 'branch_admin', 'front_desk', 'teacher', 'accountant'], items: [
    { to: '/students', icon: Users, text: 'Student Directory' },
    { to: '/attendance', icon: CalendarCheck, text: 'Attendance', roles: ['super_admin', 'branch_admin', 'teacher'] },
    { to: '/leave', icon: Plane, text: 'Leave Requests', roles: ['super_admin', 'branch_admin', 'teacher'] },
    { to: '/classes', icon: School, text: 'Classes & Sections', roles: ['super_admin', 'branch_admin'] },
  ]},
  { label: 'Fees & Finance', roles: ['super_admin', 'branch_admin', 'accountant', 'front_desk'], items: [
    { to: '/fees/invoices', icon: ReceiptText, text: 'Invoices & Dues' },
    { to: '/fees/reports', icon: PiggyBank, text: 'Finance Reports', roles: ['super_admin', 'branch_admin', 'accountant'] },
    { to: '/fees/setup', icon: Wallet, text: 'Fee Structures', roles: ['super_admin', 'branch_admin', 'accountant'] },
  ]},
  { label: 'Daily', roles: ['super_admin', 'branch_admin', 'teacher', 'front_desk'], items: [
    { to: '/daily/feed', icon: Baby, text: 'Diary / Activity Feed' },
    { to: '/daily/logs', icon: NotebookPen, text: 'Meals / Nap / Health', roles: ['super_admin', 'branch_admin', 'teacher'] },
    { to: '/daily/checkin', icon: ClipboardCheck, text: 'Check-in / out', roles: ['super_admin', 'branch_admin', 'teacher'] },
    { to: '/daily/albums', icon: Album, text: 'Albums', roles: ['super_admin', 'branch_admin', 'teacher'] },
    { to: '/daily/homework', icon: BookOpen, text: 'Homework', roles: ['super_admin', 'branch_admin', 'teacher'] },
  ]},
  { label: 'Communication', items: [
    { to: '/comms/announcements', icon: Megaphone, text: 'Announcements', roles: 'all' },
    { to: '/comms/chat', icon: MessageCircle, text: 'Chat', roles: 'all' },
    { to: '/comms/calendar', icon: CalendarDays, text: 'Calendar & Events', roles: 'all' },
    { to: '/comms/worksheets', icon: FileText, text: 'Worksheets', roles: 'all' },
  ]},
  { label: 'Academics', items: [
    { icon: NotebookPen, text: 'Academic Planning', phase: 'PH 2' },
    { icon: LibraryBig, text: 'Curriculum / Courses', phase: 'PH 2' },
    { icon: Award, text: 'Report Card / Milestones', phase: 'PH 2' },
  ]},
  { label: 'Operations', items: [
    { icon: Camera, text: 'Audit & Observation', phase: 'PH 3' },
    { icon: Bus, text: 'Transport', phase: 'PH 3' },
    { icon: UserCog, text: 'Staff', phase: 'PH 3' },
  ]},
  { label: 'Admin', roles: ['super_admin', 'branch_admin'], items: [
    { to: '/settings', icon: Settings, text: 'Settings' },
  ]},
]

function canSee(roles, role) {
  if (!roles || roles === 'all') return true
  return roles.includes(role)
}

function BellMenu() {
  const [open, setOpen] = useState(false)
  const { data: notifs = [] } = useGet('/notifications', { poll: 30000 })
  const act = useAct(['/notifications'])
  const unread = notifs.filter((n) => !n.readAt).length
  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen(!open)} title="Notifications">
        <Bell size={17} />
        {unread > 0 && <span className="dot" />}
      </button>
      {open && (
        <div className="notif-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
            <b>Notifications</b>
            {unread > 0 && (
              <button className="btn sm subtle" onClick={() => act.mutate({ path: '/notifications/read-all' })}>
                Mark all read
              </button>
            )}
          </div>
          {notifs.length === 0 && <div className="notif-item muted">All caught up 🎉</div>}
          {notifs.slice(0, 20).map((n) => (
            <div
              key={n.id}
              className={`notif-item ${n.readAt ? '' : 'unread'}`}
              onClick={() => !n.readAt && act.mutate({ path: `/notifications/${n.id}/read` })}
            >
              <b>{n.title}</b>
              {n.body}
              <div className="muted">{fmtDateTime(n.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const { user, logout } = useStore()
  const navigate = useNavigate()
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-badge">🎒</div>
          <div>
            Kidzonia
            <small>School CRM</small>
          </div>
        </div>
        {NAV.filter((g) => canSee(g.roles, user.role)).map((group) => {
          const items = group.items.filter((i) => i.phase || canSee(i.roles ?? group.roles, user.role))
          if (!items.length) return null
          return (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {items.map((item) =>
                item.phase ? (
                  <div className="nav-item disabled" key={item.text} title={`Coming in Phase ${item.phase.slice(3)}`}>
                    <item.icon />
                    {item.text}
                    <span className="phase-tag">{item.phase}</span>
                  </div>
                ) : (
                  <NavLink to={item.to} end={item.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} key={item.to}>
                    <item.icon />
                    {item.text}
                  </NavLink>
                )
              )}
            </div>
          )
        })}
        <div style={{ height: 20 }} />
      </aside>
      <div className="main">
        <div className="topbar">
          <div>
            <b style={{ fontFamily: 'var(--font-display)' }}>{user.name}</b>
            <div className="muted" style={{ textTransform: 'capitalize' }}>{user.role.replace(/_/g, ' ')}</div>
          </div>
          <div className="spacer" />
          <BellMenu />
          <button className="icon-btn" title="Log out" onClick={() => { logout(); navigate('/login') }}>
            <LogOut size={17} />
          </button>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
