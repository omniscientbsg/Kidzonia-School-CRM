// Does every screen actually render?
//
// The 417 server tests cover behaviour and render nothing, so a crash inside a
// .jsx file passes both `npm test` and `npm run build` and is only discovered by
// opening the page. That happened twice: /tasks/new went blank because a helper
// was handed the wrong object, and neither the suite nor the build noticed.
//
// The fixtures below are deliberately SHAPED like the real payloads rather than
// empty — mounting a page in its loading state proves almost nothing, because
// most crashes happen once data arrives.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api/client', () => ({
  api: {
    get: (path) => Promise.resolve(fixtureFor(path)),
    post: (path) => Promise.resolve(fixtureFor(path)),
    put: (path) => Promise.resolve(fixtureFor(path)),
    del: () => Promise.resolve({ ok: true }),
    upload: () => Promise.resolve({ id: 'media-1' }),
  },
  mediaUrl: (id) => `/media/${id}`,
  setToken: () => {},
}))

const person = {
  workWeek: [1, 2, 3, 4, 5, 6], hours: null, workWeekOwn: null, hoursOwn: null,
  status: 'active', effectiveFrom: null, effectiveTo: null, id: 'pos-1', userId: 'u-1', userName: 'Anjali Rao', tier: 'Teacher', nodeId: 'node-1', nodeName: 'Jubilee Hills', levelId: 'lvl-teacher', rank: 40, depth: 2 }

const instance = {
  id: 'ti-1', taskId: 'task-1', title: 'Mark class attendance', serviceDate: '2026-08-20',
  dueAt: '2026-08-20T18:29:59.999Z', tz: 'Asia/Kolkata', status: 'assigned', priority: 'prio-normal',
  priorityId: 'prio-normal', priorityName: 'Normal', priorityColor: null, priorityRank: 30, tagNames: [],
  isBlocking: true, requiresApproval: false, requiresMedia: false, mediaTypes: [], minAttachments: 0,
  assigneeName: 'Anjali Rao', assigneeTier: 'Teacher', assignedByName: 'Lakshmi Devi', nodeName: 'Jubilee Hills',
  submissionRound: 1, rejectionCount: 0, attachments: [], approvals: [], verifications: [],
  completionCondition: { mode: 'answers', questions: [], system: null, statement: '', proof: { required: false, types: null, min: null } },
  condition: { satisfied: true, verifiable: true, summary: 'they mark it done', mode: 'answers', missing: [], derived: null, evidence: null, actions: [] },
  can: { start: true, submit: true, decide: false, defer: false, cancel: false, reassign: false, answer: true },
  completion: null, actionResults: [],
}

const task = {
  id: 'task-1', title: 'Mark class attendance', description: '', status: 'active', priority: 'prio-normal',
  priorityId: 'prio-normal', priorityName: 'Normal', priorityRank: 30, tagIds: [], tagNames: [],
  isBlocking: true, requiresApproval: false, requiresMedia: false, minAttachments: 0, mediaTypes: [],
  target: { kind: 'node_level', positionIds: [], nodeIds: ['node-1'], levelId: 'lvl-teacher', userIds: [] },
  recurrence: { freq: 'daily', byWeekday: [], dayOfMonth: null, interval: 1, startDate: '2026-08-01', endDate: null, skipNonWorkingDays: true },
  dueType: 'end_of_day', dueConfig: { startDate: null, dueDate: null, days: null },
  completionCondition: { mode: 'answers', questions: [], system: null, statement: '', proof: { required: false, types: null, min: null } },
  onComplete: { actions: [] }, lockOnComplete: [], createdByName: 'Lakshmi Devi', createdByTier: 'Principal',
  conditionSummary: 'they mark it done', actionSummary: [], progress: { done: 2, total: 5, overdue: 1, pct: 40 },
}

const summary = {
  date: '2026-08-20',
  counts: { completed: 1, pending: 2, overdue: 0, awaitingApproval: 0, blockingOpen: 1, total: 3 },
  completed: [], pending: [], overdue: [], awaitingApproval: [],
}

// path -> payload. Anything unmatched gets an empty list, which is the right
// default for the many plain collection endpoints.
function fixtureFor(path) {
  const p = String(path).split('?')[0]
  const map = {
    '/tasks/today': {
      today: '2026-08-20', timezone: 'Asia/Kolkata', greetingName: 'Anjali Rao',
      overdue: [instance], dueToday: [instance], later: [], waiting: [], doneToday: 1,
      signOff: { blocked: true, armed: false, released: false, release: null, items: [instance], count: 1 },
      dayEnd: { instanceId: 'ti-de', submitted: false }, reportsWaiting: 2,
    },
    '/tasks/my': {
      today: '2026-08-20', weekEnd: '2026-08-23', timezone: 'Asia/Kolkata',
      overdue: [instance], dueToday: [instance], thisWeek: [], upcoming: [], deferred: [], waiting: [],
      doneToday: 1, blockingOpen: 1,
    },
    '/tasks': [task],
    '/tasks/approvals': [{ ...instance, status: 'submitted', submittedAt: '2026-08-20T09:00:00.000Z' }],
    '/tasks/locks': [],
    '/tasks/lock-requests': [],
    '/tasks/analytics': { totals: {}, byPerson: [], byNode: [], byTier: [], overTime: [], leaderboard: [], blockedNow: [], turnaround: {} },
    '/tasks/capabilities': {
      bindSources: [{ key: 'assignee.section', label: 'the assignee’s class', types: ['section'] }],
      verifiable: [], modules: [], activities: [],
    },
    '/tasks/day-end/preview': { date: '2026-08-20', timezone: 'Asia/Kolkata', summary, reportsTo: { userId: 'u-2', name: 'Lakshmi Devi', tier: 'Principal' }, instanceId: 'ti-de', alreadySubmitted: false },
    '/tasks/day-end/received': { date: '2026-08-20', reports: [], totals: { completed: 0, pending: 0, overdue: 0, awaitingApproval: 0 }, outstanding: [], missed: [], received: 0 },
    '/tasks/gate/blocked': [],
    '/tasks/logout-check': { blocked: false, armed: false, released: false, release: null, instances: [], staleInstances: [] },
    '/task-instances': [instance],
    '/task-categories': [{ id: 'tcat-1', name: 'Compliance', color: '#e5484d' }],
    '/task-priorities': [
      { id: 'prio-urgent', name: 'Urgent', rank: 10, color: '#e5484d', isDefault: false, active: true },
      { id: 'prio-normal', name: 'Normal', rank: 30, color: null, isDefault: true, active: true },
    ],
    '/task-tags': [{ id: 'ttag-1', name: 'Parent-facing', color: '#5b4a99', active: true }],
    '/task-templates': [{ id: 'ttpl-1', name: 'Daily attendance', description: '' }],
    '/day-end-forms': [],
    '/escalation-policies': [],
    '/org/me': { canAssign: true, tier: 'Principal', downlineCount: 9, positions: [person], downlineNodeIds: ['node-1'] },
    '/org/tree': { tree: { id: 'node-1', name: 'Jubilee Hills', type: 'school', path: ['node-1'], children: [] } },
    '/org/levels': [{ id: 'lvl-teacher', name: 'Teacher', rank: 40, scopeNodeId: 'node-1' }],
    '/org/downline': [person],
    '/org/positions': [{ ...person, manageable: true }],
    '/org/unplaced-staff': [],
    '/staff': [{ id: 'u-1', name: 'Anjali Rao', role: 'teacher', designation: 'Teacher' }],
    '/notifications': [],
    '/audit-log': [],
  }
  if (p in map) return map[p]
  if (p.startsWith('/tasks/') && p.endsWith('/progress')) {
    return { completion: 40, assignees: 2, totals: { approved: 2, overdue: 1 }, people: [{ ...person, positionId: person.id, done: 2, total: 5, pct: 40, open: 3, overdue: 1, latestStatus: 'assigned', latestServiceDate: '2026-08-20' }] }
  }
  if (p.startsWith('/task-instances/') && p.endsWith('/timeline')) return { events: [] }
  if (p.startsWith('/task-instances/')) return instance
  if (p.startsWith('/tasks/')) return task
  return []
}

// Screens under test. Imported directly rather than through App so a failure
// names the page instead of the router.
import Today from '../pages/tasks/Today'
import MyTasks from '../pages/tasks/MyTasks'
import AssignedByMe from '../pages/tasks/AssignedByMe'
import Approvals from '../pages/tasks/Approvals'
import TaskForm from '../pages/tasks/TaskForm'
import DayEnd, { DayEndReceived } from '../pages/tasks/DayEnd'
import Blocked from '../pages/tasks/Blocked'
import { useStore } from '../store/useStore'
import Behind from '../pages/tasks/Behind'
import TasksLayout from '../pages/tasks/TasksLayout'
import { TaskCategories, TaskPriorities, TaskTags, TaskTemplates } from '../pages/setup/tasks/TaskSetup'
import EscalationPolicies from '../pages/setup/tasks/EscalationPolicies'
import Positions from '../pages/org/Positions'

function mount(ui, { route = '/' } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  )
}

describe('every Tasks screen renders with real-shaped data', () => {
  beforeEach(() => {
    // every one of these screens sits behind the auth gate, so a signed-in user
    // is the real precondition — not something to defend against in each file
    useStore.setState({ token: 't', user: { id: 'u-1', name: 'Lakshmi Devi', role: 'branch_admin' } })

    // a render crash surfaces as a console error before the assertion fails;
    // failing loudly beats a silently empty page
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      const msg = String(args[0] || '')
      if (/not wrapped in act|validateDOMNesting/.test(msg)) return
      throw new Error(`console.error during render: ${msg}`)
    })
  })

  const screens = [
    ['Today', <Today key="t" />, /Today/i],
    ['My Tasks', <MyTasks key="m" />, /Today|Late|Nothing/i],
    ['My team', <AssignedByMe key="a" />, /Mark class attendance|not assigned anything/i],
    ['Needs me', <Approvals key="ap" />, /Mark class attendance|Nothing waiting/i],
    ['Assign a task', <TaskForm key="f" />, /Assign a task|What needs doing/i],
    ['Day-End', <DayEnd key="d" />, /Day-End|already filed|not required/i],
    ['Day-End received', <DayEndReceived key="dr" />, /Day-end reports/i],
    ['Blocked', <Blocked key="b" />, /./],
    ['Finish before today', <Behind key="bh" />, /Nothing is left over|mandatory/i],
    ['Tasks shell', <TasksLayout key="tl" />, /Tasks/i],
    ['Setup · Categories', <TaskCategories key="sc" />, /Categories/i],
    ['Setup · Priorities', <TaskPriorities key="sp" />, /Priorities|Urgent/i],
    ['Setup · Tags', <TaskTags key="st" />, /Tags|Parent-facing/i],
    ['Setup · Templates', <TaskTemplates key="stp" />, /Task templates/i],
    ['Setup · Escalation policies', <EscalationPolicies key="se" />, /Escalation policies/i],
    ['People & positions', <Positions key="pp" />, /Person|No positions match/i],
  ]

  for (const [name, element, expected] of screens) {
    it(`${name} renders`, async () => {
      mount(element)
      // getAllByText, not getByText: a heading and a row legitimately share a
      // word, and this test is about "did it render", not "is it unique"
      await waitFor(() => expect(screen.getAllByText(expected).length).toBeGreaterThan(0), { timeout: 4000 })
    })
  }
})
