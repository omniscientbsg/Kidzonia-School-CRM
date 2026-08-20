import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, UserPlus, GraduationCap, CalendarCheck, Plane,
  Wallet, ReceiptText, PiggyBank, BookOpen, Camera, ClipboardCheck, Baby,
  MessageCircle, Megaphone, CalendarDays, FileText, Settings, Bell, LogOut,
  School, Bus, UserCog, Album, NotebookPen, LibraryBig, Award, SlidersHorizontal,
  Network, ListChecks, Lock, Sunset,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { useGet, useAct, fmtDateTime } from '../api/hooks'
import { api } from '../api/client'
import { useLogoutCheck } from '../services/tasks/api'
import BlockingTasksModal from './BlockingTasksModal'
import { Button, ActionIcon, Text, Tooltip } from '@mantine/core'

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
    { to: '/fees/generate', icon: Wallet, text: 'Generate Fees', roles: ['super_admin', 'branch_admin', 'accountant'] },
    { to: '/fees/approvals', icon: Wallet, text: 'Approval Requests', roles: ['super_admin', 'branch_admin', 'accountant'] },
    { to: '/fees/collect', icon: ReceiptText, text: 'Collect Fees', roles: ['super_admin', 'branch_admin', 'accountant', 'front_desk'] },
    { to: '/fees/invoices', icon: ReceiptText, text: 'Invoices & Dues' },
    { to: '/fees/pending', icon: ReceiptText, text: 'Pending Dues', roles: ['super_admin', 'branch_admin', 'accountant', 'front_desk'] },
    { to: '/fees/adhoc', icon: ReceiptText, text: 'Ad-hoc Fees', roles: ['super_admin', 'branch_admin', 'accountant'] },
    { to: '/fees/reports', icon: PiggyBank, text: 'Finance Reports', roles: ['super_admin', 'branch_admin', 'accountant'] },
    { to: '/fees/heads', icon: Wallet, text: 'Fee Components', roles: ['super_admin', 'branch_admin', 'accountant'] },
    { to: '/fees/setup', icon: Wallet, text: 'Fee Structures', roles: ['super_admin', 'branch_admin', 'accountant'] },
    { to: '/fees/students', icon: Wallet, text: 'Student Fees', roles: ['super_admin', 'branch_admin', 'accountant'] },
    { to: '/fees/concessions', icon: Wallet, text: 'Concessions', roles: ['super_admin', 'branch_admin', 'accountant'] },
    { to: '/fees/settings', icon: Wallet, text: 'Fee Settings', roles: ['super_admin', 'branch_admin', 'accountant'] },
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
  { label: 'Organisation & Tasks', items: [
    // One way in. The tabs inside Tasks do the rest — three sidebar entries for
    // one module was the module competing with itself for attention.
    { to: '/tasks', icon: ListChecks, text: 'Tasks', roles: 'all', end: true },
    { to: '/tasks/day-end', icon: Sunset, text: 'Day-End Report', roles: 'all' },
    { to: '/org', icon: Network, text: 'Org Chart', roles: 'all' },
  ]},
  { label: 'Day Care', roles: ['super_admin', 'branch_admin', 'daycare_staff'], items: [
    { to: '/setup/daycare/activities', icon: Baby, text: 'Day Care' },
  ]},
  { label: 'Admin', roles: ['super_admin', 'branch_admin'], items: [
    { to: '/setup', icon: SlidersHorizontal, text: 'Setup / Administration' },
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

function SessionSwitcher() {
  const { activeSessionId, setActiveSession } = useStore()
  const { data: sessions = [] } = useGet('/academic-years')
  // Default the global session to the server-side active one until the user picks.
  useEffect(() => {
    if (!activeSessionId && sessions.length) {
      const def = sessions.find((s) => s.active) || sessions[0]
      if (def) setActiveSession(def.id)
    }
  }, [activeSessionId, sessions, setActiveSession])
  if (!sessions.length) return null
  return (
    <div className="filters" title="Active academic session">
      <select value={activeSessionId || ''} onChange={(e) => setActiveSession(e.target.value)}>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>{s.name}{s.active ? ' • current' : s.archived ? ' • archived' : ''}</option>
        ))}
      </select>
    </div>
  )
}

export default function Layout() {
  const { user, logout } = useStore()
  const navigate = useNavigate()
  const [blocking, setBlocking] = useState(null)
  const { data: gate } = useLogoutCheck(user.role !== 'parent')

  // Logging out is a server decision: we only drop the token on a 200.
  async function attemptLogout() {
    try {
      await api.post('/auth/logout')
      logout()
      navigate('/login')
    } catch (err) {
      const check = await api.get('/tasks/logout-check').catch(() => null)
      setBlocking({ instances: check?.instances || [], armed: check?.armed || false, error: err.message })
    }
  }

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
            <Text fw={700} ff="'Baloo 2', sans-serif">{user.name}</Text>
            <Text size="xs" c="dimmed" tt="capitalize">{user.role.replace(/_/g, ' ')}</Text>
          </div>
          <div className="spacer" />
          <SessionSwitcher />
          {gate?.blocked && (
            <Tooltip label="Mandatory tasks are still open">
              <Button
                size="xs" variant="light" color="marmalade" leftSection={<Lock size={13} />}
                onClick={() => setBlocking({ instances: gate.instances, armed: gate.armed })}
              >
                {gate.instances.length} mandatory
              </Button>
            </Tooltip>
          )}
          <BellMenu />
          <Tooltip label="Log out">
            <ActionIcon variant="subtle" color="ink" size="lg" onClick={attemptLogout} aria-label="Log out">
              <LogOut size={17} />
            </ActionIcon>
          </Tooltip>
        </div>
        {/* The mandatory-work warning lives in ONE place: the chip in the top
            bar above, which opens the full list. It used to be rendered here as
            a full-width banner as well, so the same fact shouted three times on
            every screen. */}
        <div className="content">
          <Outlet />
        </div>
      </div>
      {blocking && (
        <BlockingTasksModal instances={blocking.instances} armed={blocking.armed} onClose={() => setBlocking(null)} />
      )}
    </div>
  )
}
