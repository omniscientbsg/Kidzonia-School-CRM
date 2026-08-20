// Data layer for the Tasks module. Components never call fetch directly.
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { useGet, useAct } from '../../api/hooks'

export const taskPaths = {
  tasks: '/tasks',
  my: '/tasks/my',
  approvals: '/tasks/approvals',
  instances: '/task-instances',
  categories: '/task-categories',
  logoutCheck: '/tasks/logout-check',
}

export const useMyTasks = (opts) => useGet(taskPaths.my, opts)
export const useApprovals = () => useGet(taskPaths.approvals)
export const useTasks = (query = '') => useGet(query ? `${taskPaths.tasks}?${query}` : taskPaths.tasks)
export const useTask = (id) => useGet(`${taskPaths.tasks}/${id}`, { enabled: !!id })
export const useInstance = (id) => useGet(`${taskPaths.instances}/${id}`, { enabled: !!id })
export const useTimeline = (id) => useGet(`${taskPaths.instances}/${id}/timeline`, { enabled: !!id })
// per-assignee rollup for the "Tasks I Assigned" tracking view
export const useTaskProgress = (id) => useGet(`${taskPaths.tasks}/${id}/progress`, { enabled: !!id })
export const useCategories = () => useGet(taskPaths.categories)
// What other modules expose to the task engine. The completion pickers render
// themselves from this, so a newly registered module needs no form change.
export const useCapabilities = () => useGet('/tasks/capabilities')
// Records a completed task turned into evidence, and the requests to change them.
export const useLocks = () => useGet('/tasks/locks')
// Where a login lands: today's work, the sign-off banner and the Day-End CTA.
export const useToday = () => useGet('/tasks/today')
export const useDayEndPreview = () => useGet('/tasks/day-end/preview')
export const useDayEndReceived = (date = '') => useGet(date ? `/tasks/day-end/received?date=${date}` : '/tasks/day-end/received')
export const useLockRequests = (status = '') => useGet(status ? `/tasks/lock-requests?status=${status}` : '/tasks/lock-requests')
// Who in my downline is held at the door right now (admin-facing safety valve).
export const useBlockedUsers = () => useGet('/tasks/gate/blocked')

// Role-aware dashboard payload. All roll-ups are computed server-side against
// the org tree, so filters here can only narrow what the caller may see.
export function useAnalytics(params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null))
  const suffix = qs.toString()
  return useGet(suffix ? `/tasks/analytics?${suffix}` : '/tasks/analytics')
}

export function useInstances(params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null))
  const suffix = qs.toString()
  return useGet(suffix ? `${taskPaths.instances}?${suffix}` : taskPaths.instances)
}

// Blocking work between the user and the door. Polled so a manager's deferral
// releases the gate without a page reload.
export function useLogoutCheck(enabled = true) {
  return useQuery({
    queryKey: [taskPaths.logoutCheck],
    queryFn: () => api.get(taskPaths.logoutCheck),
    enabled,
    refetchInterval: 60000,
  })
}

// One mutation hook for the module — task and org state move together.
export function useTaskAct() {
  return useAct(['/tasks', '/task-instances', '/org'])
}

// Live "who will get this" preview for the assignment picker. Plain call, no
// toast: it fires on every keystroke in the form.
export const previewTargets = (target) => api.post('/tasks/preview-targets', { target })

export const uploadProof = async (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.upload('/media', form)
}
