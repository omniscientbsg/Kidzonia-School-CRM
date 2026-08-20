// What counts as "activity" in this app, as config.
//
// The task engine can verify a task against ANY of these without a line of
// per-module code: pick a module, pick a thing, pick what was done to it.
// Adding a module to that picker is one line in the table below.
//
// The trail itself is written centrally by server/db.js — every insert, update
// and soft-delete in the whole application — so this file only has to say what
// each collection IS, never how to record it.
//
// `scopeKey` names the field that ties a row to a class/section where one
// exists, so a task can ask "did they do it FOR THEIR CLASS" rather than just
// "did they do it somewhere".

export const ACTIVITY_MODULES = {
  attendance: 'Attendance',
  students: 'Students',
  daily: 'Daily',
  daycare: 'Day Care',
  fees: 'Fees',
  comms: 'Communication',
  admissions: 'Admissions',
  crm: 'Enquiries',
  setup: 'Setup',
  staff: 'Staff',
}

// collection -> what it is
export const ACTIVITIES = {
  attendanceRecords: { module: 'attendance', label: 'Class attendance', scopeKey: 'sectionId', verb: 'marked' },
  leaveRequests: { module: 'students', label: 'Leave request', scopeKey: null, verb: 'handled' },

  dailyLogs: { module: 'daily', label: 'Meal / nap / health log', scopeKey: null, verb: 'recorded' },
  checkInOuts: { module: 'daily', label: 'Check-in / out', scopeKey: null, verb: 'recorded' },
  diaryPosts: { module: 'daily', label: 'Diary post', scopeKey: 'sectionId', verb: 'posted' },
  homework: { module: 'daily', label: 'Homework', scopeKey: 'sectionId', verb: 'set' },
  albums: { module: 'daily', label: 'Photo album', scopeKey: 'sectionId', verb: 'updated' },

  dcMeals: { module: 'daycare', label: 'Day-care menu', scopeKey: null, verb: 'set' },
  daycareActivities: { module: 'daycare', label: 'Day-care activity', scopeKey: null, verb: 'logged' },

  payments: { module: 'fees', label: 'Fee payment', scopeKey: null, verb: 'collected' },
  invoices: { module: 'fees', label: 'Invoice', scopeKey: null, verb: 'raised' },
  discounts: { module: 'fees', label: 'Discount', scopeKey: null, verb: 'applied' },

  announcements: { module: 'comms', label: 'Announcement', scopeKey: null, verb: 'published' },
  messages: { module: 'comms', label: 'Chat message', scopeKey: null, verb: 'sent' },
  events: { module: 'comms', label: 'Calendar event', scopeKey: null, verb: 'added' },

  applications: { module: 'admissions', label: 'Admission application', scopeKey: null, verb: 'handled' },
  leads: { module: 'crm', label: 'Enquiry', scopeKey: null, verb: 'handled' },
  leadActivities: { module: 'crm', label: 'Enquiry follow-up', scopeKey: null, verb: 'logged' },

  students: { module: 'students', label: 'Student record', scopeKey: null, verb: 'updated' },
  staffAttendance: { module: 'staff', label: 'Staff attendance', scopeKey: null, verb: 'marked' },
}

// What can be done to a thing. Deliberately three, not the full CRUD vocabulary
// — a person picking this does not think in verbs the database uses.
export const ACTIVITY_OPS = {
  any: 'added or changed',
  created: 'added',
  updated: 'changed',
}

// Collections the trail ignores: engine bookkeeping, not somebody's work. Left
// in and the log would be mostly the task engine writing about itself.
export const ACTIVITY_IGNORED = new Set([
  'auditLog', 'activityLog', 'notifications', 'notificationLog',
  'taskInstances', 'taskVerifications', 'taskActionRuns', 'taskApprovals',
  'taskLocks', 'taskLockRequests', 'taskGateReleases', 'dayEndReports',
  'rolePermissions', 'mediaAssets', 'announcementReads', 'eventRsvps',
])

export const isTracked = (collection) => !ACTIVITY_IGNORED.has(collection) && !!ACTIVITIES[collection]

// The picker's option list: module -> things -> ops, already in words.
export function activityCatalogue() {
  const byModule = new Map()
  for (const [collection, meta] of Object.entries(ACTIVITIES)) {
    const moduleLabel = ACTIVITY_MODULES[meta.module] || meta.module
    if (!byModule.has(meta.module)) byModule.set(meta.module, { key: meta.module, label: moduleLabel, things: [] })
    byModule.get(meta.module).things.push({
      collection,
      label: meta.label,
      verb: meta.verb,
      scoped: !!meta.scopeKey,
    })
  }
  return [...byModule.values()].sort((a, b) => a.label.localeCompare(b.label))
}

// "a Diary post was posted for their class" — used for the plain-language line
// the assigner reads back.
export function describeActivity({ collection, op = 'any', scoped = false }) {
  const meta = ACTIVITIES[collection]
  if (!meta) return null
  const what = meta.label.toLowerCase()
  const did = op === 'created' ? 'added' : op === 'updated' ? 'changed' : meta.verb
  return `they have ${did} ${/^[aeiou]/.test(what) ? 'an' : 'a'} ${what}${scoped && meta.scopeKey ? ' for their class' : ''}`
}
