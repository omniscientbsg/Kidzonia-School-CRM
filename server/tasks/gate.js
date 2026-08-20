// Mandatory-task gating. The React client is only the messenger: it can drop
// its own JWT at any time, so the rule is enforced here.
//
// WHAT BLOCKS: an occurrence blocks only when it is mandatory (isBlocking),
// still open, AND its DEADLINE has arrived — i.e. the last day of its window is
// today or earlier. An end-of-day task blocks the day it is set; a task with a
// three-day window does not block until day three. Non-blocking work never
// blocks. Submitted work never blocks: nobody waits on a senior to go home.
//
// Two layers:
//   1. POST /auth/logout answers 409 while blocking work is still open, so the
//      normal path cannot complete a logout.
//   2. taskGate() refuses every WRITE elsewhere in the API once blocking work
//      from a PREVIOUS local day is still open — i.e. the user walked out
//      anyway. Reads stay open so they can see what they owe and clear it.
//
// Safety valves, all required so nobody is ever permanently trapped:
//   - a manager can defer the occurrence (POST /task-instances/:id/defer)
//   - a manager can release the person for the day (POST /tasks/gate/release)
//   - the person can ask to be released (POST /tasks/gate/request-release),
//     which notifies everyone above them
import { list, find, insert } from '../db.js'
import { buildOrgIndex } from '../org/tree.js'
import { getModule } from '../capabilities/index.js'
import { OPEN_STATUSES } from './model.js'
import { localToday, localDate, DEFAULT_TZ } from './time.js'

// Paths a gated user may still POST to: authentication, the tasks module
// itself, uploads for proof, and marking notifications read. Rule (3): never
// block access to the tasks, or to anything needed to finish them.
const EXEMPT = [
  /^\/auth\//,
  /^\/tasks(\/|$)/,
  /^\/task-instances(\/|$)/,
  /^\/task-categories(\/|$)/,
  /^\/media(\/|$)/,
  /^\/notifications(\/|$)/,
]

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// An active release lifts the gate for one person for one local day.
export function activeRelease(userId, today) {
  return list('taskGateReleases', (r) => r.userId === userId && r.forDate === today && !r.revokedAt)[0] || null
}

// THE predicate. Mandatory + still open + deadline already arrived. Exported so
// My Tasks and the dashboards count exactly what the gate enforces.
export function isGatingNow(inst, idx = buildOrgIndex()) {
  if (!inst?.isBlocking || !OPEN_STATUSES.includes(inst.status)) return false
  const node = idx.nodeById.get(inst.assigneeNodeId)
  if (node?.settings?.blockingLogoutEnabled === false) return false
  const tz = inst.tz || DEFAULT_TZ
  return localDate(tz, inst.dueAt) <= localToday(tz)
}

// Blocking work whose deadline has already arrived.
export function evaluate(user, idx = buildOrgIndex()) {
  const tz = (i) => i.tz || DEFAULT_TZ
  const rows = list('taskInstances', (i) =>
    i.assigneeUserId === user.id && i.isBlocking && OPEN_STATUSES.includes(i.status))
    .filter((i) => isGatingNow(i, idx))
    // the day-end report is the LAST thing anyone does, so it sorts to the
    // bottom — its body even says to finish the others first. Ordering, not a
    // hard dependency: a real dependency would deadlock on someone else's queue.
    .sort((a, b) => (a.gateOrder ?? 0) - (b.gateOrder ?? 0) || a.serviceDate.localeCompare(b.serviceDate))

  const anyTz = rows[0] ? tz(rows[0]) : DEFAULT_TZ
  const today = localToday(anyTz)
  const release = rows.length ? activeRelease(user.id, today) : null
  const stale = rows.filter((i) => localDate(tz(i), i.dueAt) < localToday(tz(i)))

  return {
    blocked: rows.length > 0 && !release,
    armed: stale.length > 0 && !release,
    released: !!release,
    release: release
      ? { by: release.byName, reason: release.reason, at: release.createdAt, forDate: release.forDate }
      : null,
    instances: rows.map((i) => ({
      id: i.id,
      taskId: i.taskId,
      title: i.title,
      serviceDate: i.serviceDate,
      dueAt: i.dueAt,
      status: i.status,
      requiresMedia: i.requiresMedia,
      requiresApproval: i.requiresApproval,
      rejectionCount: i.rejectionCount || 0,
      assignedByName: find('users', i.assignedByUserId)?.name || null,
    })),
  }
}

export function recordRelease({ userId, byUser, byPositionId, reason, forDate }) {
  return insert('taskGateReleases', {
    userId,
    forDate,
    reason,
    byUserId: byUser.id,
    byName: byUser.name,
    byPositionId: byPositionId || null,
    revokedAt: null,
  }, byUser.id)
}

// Rule (3) again, for module-linked work: never block the thing the person has
// to do to get unblocked. If someone owes a mandatory task that completes on a
// module signal, the endpoints that module uses to record the work stay open to
// THEM — and only while they owe it. Read off the descriptors, so a new
// integration is covered without touching this list.
function moduleEscapes(user) {
  const owed = list('taskInstances', (i) =>
    i.assigneeUserId === user.id && i.isBlocking && OPEN_STATUSES.includes(i.status) &&
    i.completionCondition?.nature === 'module_linked')
  const paths = []
  for (const inst of owed) {
    const mod = getModule(inst.completionCondition.moduleLinked?.moduleKey)
    for (const re of mod?.writePaths || []) paths.push(re)
  }
  return paths
}

export function taskGate(req, res, next) {
  if (!MUTATING.has(req.method)) return next()
  if (EXEMPT.some((re) => re.test(req.path))) return next()
  if (!req.user || req.user.role === 'parent') return next()

  const gate = evaluate(req.user)
  if (!gate.armed) return next()
  if (moduleEscapes(req.user).some((re) => re.test(req.path))) return next()
  const n = gate.instances.length
  return res.status(403).json({
    error: 'task_gate',
    message: `You have ${n} mandatory task${n > 1 ? 's' : ''} left over from an earlier day. Finish ${n > 1 ? 'them' : 'it'}, or ask your manager to defer or release you, and this unlocks straight away.`,
    instances: gate.instances,
  })
}
