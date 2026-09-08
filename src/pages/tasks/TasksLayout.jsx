import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Group, Text, Title, Button, Stack } from '@mantine/core'
import { Plus } from 'lucide-react'
import { useOrgMe } from '../../services/org/api'
import { useMyTasks, useApprovals, useDayEndReceived, useLogoutCheck } from '../../services/tasks/api'

export default function TasksLayout() {
  const navigate = useNavigate()
  const { data: me } = useOrgMe()
  const { data: my } = useMyTasks({ poll: 60000 })
  const { data: approvals = [] } = useApprovals()
  const { data: dayEnd } = useDayEndReceived()
  const { data: gate } = useLogoutCheck()

  const open = (my?.overdue?.length || 0) + (my?.dueToday?.length || 0)
  const waiting = approvals.length + (dayEnd?.received || 0)
  // `armed` is work from a strictly EARLIER day — the subset that actually
  // freezes writes. `blocked` is the wider "holds your sign-off" list. Two
  // different things, and easy to conflate, so this tab shows only the first.
  const behind = gate?.staleInstances?.length || 0

  // Six tabs. "Finish before today" is the only one that is ever red, and it is
  // hidden entirely when there is nothing in it — a permanently visible empty
  // warning trains people to stop reading it.
  const tabs = [
    behind > 0 && { to: '/tasks/behind', text: `Finish before today (${behind})`, tone: 'danger' },
    { to: '/tasks', text: `Today${open ? ` (${open})` : ''}`, end: true },
    { to: '/tasks/mine', text: 'My tasks' },
    { to: '/tasks/approvals', text: `Approvals${waiting ? ` (${waiting})` : ''}` },
    { to: '/tasks/assigned', text: 'My team' },
    { to: '/tasks/reports', text: 'Reports' },
  ].filter(Boolean)

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={1} style={{ fontSize: 24 }}>Tasks</Title>
        <Group gap="sm">
          {me?.tier && <Text size="sm" c="dimmed">{me.tier} · {me.downlineCount} below you</Text>}
          {me?.canAssign && (
            <Button size="xs" leftSection={<Plus size={14} />} onClick={() => navigate('/tasks/new')}>
              Assign task
            </Button>
          )}
        </Group>
      </Group>

      {/* the tab strip stays on the app's own class: it is shared with Setup,
          Org and Fees, and swapping it here alone would make Tasks the odd one
          out on every screen that has one */}
      <div className="tabs">
        {tabs.map((s) => (
          <NavLink
            key={s.to} to={s.to} end={s.end}
            className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}
            style={s.tone === 'danger' ? { color: 'var(--berry)' } : undefined}
          >
            {s.text}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </Stack>
  )
}
