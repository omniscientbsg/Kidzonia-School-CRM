// Task notifications.
//
// One dispatcher for every lifecycle event. In-app delivery is real; email,
// SMS, WhatsApp and push are MOCK senders that record what they would have sent
// — the seam is a driver table, so wiring a real provider is one function each
// and no call site changes.
//
// Every send is logged per channel in `notificationLog`, including the mocked
// ones, so "did the 6pm reminder actually go out, and to whom" is answerable.
import { insert, update, list, find } from '../db.js'
import { buildOrgIndex, describePosition } from '../org/tree.js'
import { localDate, DEFAULT_TZ } from './time.js'

export const TASK_EVENTS = [
  'assigned',        // work landed on someone
  'due_soon',        // configurable lead time before the deadline
  'overdue',         // deadline passed with the work still open
  'expired',         // it closed — the work can no longer be done at all
  'submitted',       // -> the approver
  'approved',        // -> the assignee
  'rejected',        // -> the assignee
  'blocking_eod',    // mandatory work still open near the end of the local day
  'progress',        // -> the assigner, when their task finishes
  'gate_released',   // a manager lifted someone's sign-off lock
  'gate_request',    // someone asked to be released
  'lock_request',    // someone wants to edit a record a completed task locked
  'lock_approved',   // -> the requester, with a bounded window
  'lock_rejected',   // -> the requester
  'verification_broken', // completed work whose evidence was edited afterwards
  'escalated',       // an approval moved up the chain on the clock
  'sla_breach',      // the chain ran out and nobody decided
  'day_end',         // a day-end report landed with the reporting user
]

// Channel drivers. Only `inApp` writes something a user can actually read
// today; the rest record a stubbed send with the payload they would have used.
const DRIVERS = {
  inApp: {
    real: true,
    send: () => ({ status: 'sent', provider: 'in-app' }),
  },
  email: {
    send: (user, msg) => ({ status: 'stubbed', provider: 'mock-smtp', to: user.email || null, subject: msg.title }),
  },
  sms: {
    send: (user, msg) => ({ status: 'stubbed', provider: 'mock-sms', to: user.phone || null, text: `${msg.title}: ${msg.body}`.slice(0, 160) }),
  },
  whatsapp: {
    send: (user, msg) => ({ status: 'stubbed', provider: 'mock-whatsapp', to: user.phone || null, text: `${msg.title}\n${msg.body}` }),
  },
  push: {
    send: (user, msg) => ({ status: 'stubbed', provider: 'mock-push', title: msg.title, body: msg.body }),
  },
}

// Which channels each event uses by default. A node can override any of it.
export const DEFAULT_NOTIFY_SETTINGS = {
  leadTimeHours: 4,          // "due soon" fires this long before the deadline
  endOfDayLeadHours: 2,      // mandatory-work nudge this long before local EOD
  channels: {
    assigned: ['inApp'],
    due_soon: ['inApp', 'push'],
    overdue: ['inApp', 'push', 'email'],
    expired: ['inApp', 'push', 'email'],
    submitted: ['inApp'],
    approved: ['inApp'],
    rejected: ['inApp', 'push'],
    blocking_eod: ['inApp', 'push', 'whatsapp'],
    progress: ['inApp'],
    gate_released: ['inApp', 'push'],
    gate_request: ['inApp', 'push'],
    lock_request: ['inApp', 'push'],
    lock_approved: ['inApp', 'push'],
    lock_rejected: ['inApp'],
    verification_broken: ['inApp', 'push', 'email'],
    escalated: ['inApp', 'push'],
    sla_breach: ['inApp', 'push', 'email'],
    day_end: ['inApp'],
  },
}

const DEFAULT_USER_PREFS = { inApp: true, push: true, sms: false, whatsapp: true, email: true }

export function notifySettings(node) {
  const custom = node?.settings?.taskNotifications || {}
  return {
    ...DEFAULT_NOTIFY_SETTINGS,
    ...custom,
    channels: { ...DEFAULT_NOTIFY_SETTINGS.channels, ...(custom.channels || {}) },
  }
}

// Staff prefs live on the user; guardians keep theirs on the guardian record.
function prefsFor(user) {
  if (user.guardianId) {
    const guardian = find('guardians', user.guardianId)
    return { ...DEFAULT_USER_PREFS, ...(guardian?.notificationPrefs || {}) }
  }
  return { ...DEFAULT_USER_PREFS, ...(user.notificationPrefs || {}) }
}

// The single send path. Returns the notification rows created.
export function dispatchTask(event, { userIds = [], title, body, instance = null, meta = null, settings = null }) {
  if (!TASK_EVENTS.includes(event)) throw new Error(`Unknown task notification event: ${event}`)
  const cfg = settings || DEFAULT_NOTIFY_SETTINGS
  const channels = cfg.channels[event] || ['inApp']
  const out = []

  for (const userId of [...new Set(userIds)].filter(Boolean)) {
    const user = find('users', userId)
    if (!user || user.active === false) continue

    const notification = insert('notifications', {
      userId,
      title,
      body,
      type: 'task',
      event,
      refType: instance ? 'taskInstance' : meta?.refType || null,
      refId: instance ? instance.id : meta?.refId || null,
      readAt: null,
    })

    const prefs = prefsFor(user)
    for (const channel of channels) {
      const driver = DRIVERS[channel]
      if (!driver) continue
      if (!prefs[channel]) {
        // still recorded: "not sent because they opted out" is an answer too
        insert('notificationLog', {
          notificationId: notification.id, userId, channel, event,
          status: 'suppressed', reason: 'user_opted_out',
          refType: 'taskInstance', refId: instance?.id || null,
        })
        continue
      }
      const result = driver.send(user, { title, body })
      insert('notificationLog', {
        notificationId: notification.id,
        userId,
        channel,
        event,
        status: result.status,
        provider: result.provider,
        payload: { ...result, status: undefined, provider: undefined },
        refType: 'taskInstance',
        refId: instance?.id || null,
        taskId: instance?.taskId || null,
      })
    }
    out.push(notification)
  }
  return out
}

// ---------------------------------------------------------------- sweeps ----
const settingsForInstance = (inst, idx) => notifySettings(idx.nodeById.get(inst.assigneeNodeId))
const hoursUntil = (iso, now) => (Date.parse(iso) - now) / 3600000

// "Due in 4 hours". Fires once per occurrence.
export function sweepDueSoon(now = Date.now(), idx = buildOrgIndex()) {
  const sent = []
  for (const inst of list('taskInstances', (i) => ['assigned', 'in_progress'].includes(i.status))) {
    if (inst.notifiedDueSoonAt || !inst.dueAt) continue
    const cfg = settingsForInstance(inst, idx)
    const left = hoursUntil(inst.dueAt, now)
    if (left <= 0 || left > cfg.leadTimeHours) continue
    dispatchTask('due_soon', {
      userIds: [inst.assigneeUserId],
      title: 'Task due soon',
      body: `“${inst.title}” is due in about ${Math.max(1, Math.round(left))} hour${Math.round(left) === 1 ? '' : 's'}.`,
      instance: inst,
      settings: cfg,
    })
    update('taskInstances', inst.id, { notifiedDueSoonAt: new Date(now).toISOString() }, null)
    sent.push(inst.id)
  }
  return sent
}

// Mandatory work still open near the end of the local day — the nudge that
// stops the logout gate being a surprise at 6pm.
export function sweepBlockingEndOfDay(now = Date.now(), idx = buildOrgIndex()) {
  const sent = []
  // The message counts a PERSON's outstanding work, so it goes out once per
  // person per local day — not once per task they happen to owe.
  const alreadyToldToday = new Set(
    list('taskInstances', (i) => !!i.notifiedEodAt)
      .filter((i) => i.notifiedEodAt === localDate(i.tz || DEFAULT_TZ, new Date(now)))
      .map((i) => i.assigneeUserId),
  )
  for (const inst of list('taskInstances', (i) => i.isBlocking && ['assigned', 'in_progress', 'overdue'].includes(i.status))) {
    if (!inst.dueAt) continue
    const tz = inst.tz || DEFAULT_TZ
    const today = localDate(tz, new Date(now))
    if (alreadyToldToday.has(inst.assigneeUserId)) continue
    const node = idx.nodeById.get(inst.assigneeNodeId)
    if (node?.settings?.blockingLogoutEnabled === false) continue
    const cfg = notifySettings(node)
    const left = hoursUntil(inst.dueAt, now)
    if (left <= 0 || left > cfg.endOfDayLeadHours) continue

    const open = list('taskInstances', (i) =>
      i.assigneeUserId === inst.assigneeUserId && i.isBlocking &&
      ['assigned', 'in_progress', 'overdue'].includes(i.status) &&
      localDate(i.tz || DEFAULT_TZ, i.dueAt) <= today).length

    dispatchTask('blocking_eod', {
      userIds: [inst.assigneeUserId],
      title: 'Finish before you sign off',
      body: `${open} mandatory task${open > 1 ? 's' : ''} still open today — you will not be able to log out until ${open > 1 ? 'they are' : 'it is'} done. Ask your manager if something has come up.`,
      instance: inst,
      settings: cfg,
    })
    update('taskInstances', inst.id, { notifiedEodAt: today }, null)
    alreadyToldToday.add(inst.assigneeUserId)
    sent.push(inst.id)
  }
  return sent
}

// Called by refreshOverdue when an occurrence flips. The assignee is told, and
// so is whoever assigned it — that is the assigner's progress ping.
// It closed. Both the person who owed it and the person who asked for it are
// told, because unlike `overdue` there is nothing either of them can do about
// it afterwards — this is the only notice they will get.
export function notifyExpired(inst, idx = buildOrgIndex()) {
  const cfg = settingsForInstance(inst, idx)
  dispatchTask('expired', {
    userIds: [inst.assigneeUserId],
    title: 'Task closed',
    body: `“${inst.title}” (for ${inst.serviceDate}) closed without being done.`,
    instance: inst,
    settings: cfg,
  })
  if (inst.assignedByUserId && inst.assignedByUserId !== inst.assigneeUserId) {
    dispatchTask('progress', {
      userIds: [inst.assignedByUserId],
      title: 'A task you assigned has closed',
      body: `${inst.assigneeName || 'Someone'} did not finish “${inst.title}” (for ${inst.serviceDate}) before it closed.`,
      instance: inst,
      settings: cfg,
    })
  }
}

export function notifyOverdue(inst, idx = buildOrgIndex()) {
  const cfg = settingsForInstance(inst, idx)
  dispatchTask('overdue', {
    userIds: [inst.assigneeUserId],
    title: 'Task overdue',
    body: `“${inst.title}” (for ${inst.serviceDate}) passed its deadline.`,
    instance: inst,
    settings: cfg,
  })
  if (inst.assignedByUserId && inst.assignedByUserId !== inst.assigneeUserId) {
    dispatchTask('progress', {
      userIds: [inst.assignedByUserId],
      title: 'A task you assigned is overdue',
      body: `${inst.assigneeName || 'Someone'} has not finished “${inst.title}” (for ${inst.serviceDate}).`,
      instance: inst,
      settings: cfg,
    })
  }
}

// New work landing on someone, digested per person per generation run so a
// daily task for five teachers does not fire five notifications every night.
export function notifyAssigned(created, idx = buildOrgIndex()) {
  const byUser = new Map()
  for (const inst of created) {
    if (!byUser.has(inst.assigneeUserId)) byUser.set(inst.assigneeUserId, [])
    byUser.get(inst.assigneeUserId).push(inst)
  }
  const sent = []
  for (const [userId, rows] of byUser) {
    const soonest = rows.slice().sort((a, b) => a.serviceDate.localeCompare(b.serviceDate))[0]
    const cfg = settingsForInstance(soonest, idx)
    const assigner = find('users', soonest.assignedByUserId)?.name || 'Someone'
    const body = rows.length === 1
      ? `${assigner} assigned you “${soonest.title}” for ${soonest.serviceDate}.`
      : `${assigner} assigned you ${rows.length} tasks, starting with “${soonest.title}” on ${soonest.serviceDate}.`
    dispatchTask('assigned', {
      userIds: [userId],
      title: rows.length === 1 ? 'New task assigned to you' : `${rows.length} new tasks assigned to you`,
      body,
      instance: soonest,
      settings: cfg,
    })
    sent.push(userId)
  }
  return sent
}

// Progress ping upward when a task finishes.
export function notifyCompleted(inst, idx = buildOrgIndex()) {
  if (!inst.assignedByUserId || inst.assignedByUserId === inst.assigneeUserId) return
  dispatchTask('progress', {
    userIds: [inst.assignedByUserId],
    title: 'Task completed',
    body: `${inst.assigneeName || 'Someone'} finished “${inst.title}”.`,
    instance: inst,
    settings: settingsForInstance(inst, idx),
  })
}

// Who should be told about an occurrence, by role in the hierarchy.
export function recipientsFor(inst, idx = buildOrgIndex()) {
  const approver = idx.positionById.get(inst.approverPositionId)
  return {
    assignee: inst.assigneeUserId,
    assigner: inst.assignedByUserId,
    approver: approver?.userId || null,
    approverName: approver ? describePosition(approver, idx).userName : null,
  }
}
