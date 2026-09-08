import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { buildSeed, seedOrgTree, seedHqUsers, seedTasks } from './seed.js'
import { ACTIVITIES, isTracked } from './capabilities/activities.js'
import { localDate, DEFAULT_TZ } from './tasks/time.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.SCHOOL_CRM_DB || path.join(__dirname, 'data', 'db.json')

export const COLLECTIONS = [
  'branches', 'academicYears', 'programs', 'classes', 'sections',
  'users', 'rolePermissions',
  'leads', 'leadActivities', 'followUpTasks',
  'applications', 'applicationDocuments',
  'families', 'guardians', 'guardianStudentLinks', 'students', 'enrolments',
  'attendanceRecords', 'leaveRequests',
  'feeHeads', 'feeStructures', 'invoices', 'payments', 'receipts',
  'discounts', 'refunds', 'ledgerEntries',
  'diaryPosts', 'diaryComments', 'dailyLogs', 'checkInOuts',
  'albums', 'mediaAssets', 'homework', 'consents',
  'announcements', 'announcementReads', 'chatThreads', 'messages',
  'events', 'eventRsvps', 'publishedResources',
  'notifications', 'notificationLog', 'auditLog',
  'staffAttendance', 'dishes', 'dcMeals', 'groups', 'daycareActivities',
  'studentFeeStructures', 'feeSettings',
  'concessions', 'studentConcessions', 'corporates', 'feeCycles', 'adhocFees',
  'orgNodes', 'orgLevels', 'orgPositions',
  'tasks', 'taskInstances', 'taskApprovals', 'taskAttachments', 'taskCategories', 'taskGateReleases',
  'taskVerifications', 'taskActionRuns', 'taskLocks', 'taskLockRequests',
  'escalationPolicies', 'dayEndReports', 'activityLog',
  // task master data — a collection listed here is created empty by initDb(),
  // so a new one needs no migration of its own
  'taskPriorities', 'taskTags', 'taskTemplates', 'dayEndForms',
]

// Writes to the org collections invalidate the in-memory ancestry index.
const ORG_COLLECTIONS = new Set(['orgNodes', 'orgLevels', 'orgPositions'])
let orgRev = 0
export const getOrgRev = () => orgRev
const touchOrg = (coll) => { if (ORG_COLLECTIONS.has(coll)) orgRev++ }

let db = null

export function initDb() {
  if (db) return db
  if (fs.existsSync(DB_PATH)) {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))
  } else {
    db = buildSeed()
    persist()
  }
  for (const c of COLLECTIONS) if (!db[c]) db[c] = []
  if (!db._counters) db._counters = {}
  migrate()
  return db
}

export function getDb() {
  return initDb()
}

// Idempotent backfills for schema fields added after the initial seed, so
// existing db.json files keep working without a wipe/reseed.
function migrate() {
  let dirty = false
  for (const y of db.academicYears || []) {
    if (y.archived === undefined) {
      // legacy rows may have had status:'closed' — treat those as archived
      y.archived = y.status === 'closed' || y.status === 'archived'
      dirty = true
    }
  }
  for (const c of db.classes || []) {
    if (c.active === undefined) { c.active = true; dirty = true } // classes deactivate via active flag
  }
  for (const s of db.students || []) {
    if (s.category === undefined) { s.category = 'Not Provided'; dirty = true }
    if (s.ews === undefined) { s.ews = false; dirty = true }
    if (s.specialNeeds === undefined) { s.specialNeeds = false; dirty = true }
  }
  for (const g of db.groups || []) {
    if (g.staffIds === undefined) { g.staffIds = []; dirty = true }
    if (g.classIds === undefined) { g.classIds = []; dirty = true }
    if (g.charges === undefined) { g.charges = []; dirty = true } // group fee charges/discounts
  }
  for (const st of db.students || []) {
    if (st.corporateId === undefined) { st.corporateId = null; dirty = true } // corporate tie-up tag
  }
  for (const u of db.users || []) {
    if (u.role === 'parent') continue
    if (u.subjects === undefined) { u.subjects = []; dirty = true }
    if (u.classTeacherOf === undefined) { u.classTeacherOf = []; dirty = true }
    if (u.subjectTeacher === undefined) { u.subjectTeacher = false; dirty = true }
    if (u.groupAdmin === undefined) { u.groupAdmin = false; dirty = true }
    if (u.username === undefined) { u.username = (u.email || '').split('@')[0] || null; dirty = true }
  }
  // Fee heads -> first-class components: backfill periodicity + tax/refund/active.
  const oneTimeCodes = ['ADMISSION', 'DEPOSIT', 'UNIFORM', 'BOOKS', 'LATE_FEE', 'CAUTION']
  for (const h of db.feeHeads || []) {
    if (h.periodicity === undefined) {
      const code = (h.code || h.name || '').toUpperCase()
      h.periodicity = oneTimeCodes.some((c) => code.includes(c)) ? 'one_time' : code.includes('ACTIVITY') ? 'annual' : 'monthly'
      dirty = true
    }
    if (h.taxable === undefined) { h.taxable = false; dirty = true }
    if (h.gstPct === undefined) { h.gstPct = 0; dirty = true }
    if (h.refundable === undefined) { h.refundable = (h.code || '').toUpperCase().includes('DEPOSIT') || (h.code || '').toUpperCase().includes('CAUTION'); dirty = true }
    if (h.active === undefined) { h.active = true; dirty = true }
  }
  // Fee structures -> scope to a class (was program-only). Backfill classId by matching
  // the class with the same branch + session + program.
  for (const s of db.feeStructures || []) {
    if (s.classId === undefined) {
      const cls = (db.classes || []).find((c) => c.branchId === s.branchId && c.academicYearId === s.academicYearId && c.programId === s.programId)
      s.classId = cls ? cls.id : null
      dirty = true
    }
  }
  // Money V2: fee amounts moved from integer rupees -> integer paise. One-shot ×100 on
  // every stored money field, guarded by a flag so it never runs twice.
  if (!db._feesMoneyV2) {
    const x100 = (n) => (typeof n === 'number' ? Math.round(n * 100) : n)
    for (const s of db.feeStructures || []) for (const l of s.lines || []) l.amount = x100(l.amount)
    for (const inv of db.invoices || []) {
      inv.total = x100(inv.total)
      inv.paidAmount = x100(inv.paidAmount)
      inv.discountTotal = x100(inv.discountTotal)
      for (const l of inv.lines || []) l.amount = x100(l.amount)
    }
    for (const p of db.payments || []) p.amount = x100(p.amount)
    for (const d of db.discounts || []) d.amount = x100(d.amount)
    for (const r of db.refunds || []) r.amount = x100(r.amount)
    for (const e of db.ledgerEntries || []) { e.amount = x100(e.amount); e.balanceAfter = x100(e.balanceAfter) }
    db._feesMoneyV2 = true
    dirty = true
  }
  // Org tree V1: graft HQ/school hierarchy + the `org`/`tasks` permission modules
  // onto an existing db.json (the seed only runs for a brand-new file).
  if (!db._orgV1) {
    const now = new Date().toISOString()
    const push = (coll, row) => {
      db[coll] = db[coll] || []
      if (row.id && db[coll].some((r) => r.id === row.id)) return null
      db[coll].push({ createdAt: now, createdBy: null, updatedAt: now, updatedBy: null, deletedAt: null, ...row })
      return row
    }
    seedHqUsers(push)
    seedOrgTree(push)
    seedTasks(push)
    const P = (view, create, edit, del) => ({ view, create, edit, delete: del })
    const ALL = P(true, true, true, true)
    const VIEW = P(true, false, false, false)
    const NONE = P(false, false, false, false)
    const ORG_PERMS = {
      branch_admin: { org: ALL, tasks: ALL },
      hq_coordinator: { org: ALL, tasks: ALL },
      school_owner: { org: ALL, tasks: ALL },
      front_desk: { org: VIEW, tasks: ALL },
      accountant: { org: VIEW, tasks: ALL },
      teacher: { org: VIEW, tasks: ALL },
      daycare_staff: { org: VIEW, tasks: ALL },
      parent: { org: NONE, tasks: NONE },
    }
    for (const [role, perms] of Object.entries(ORG_PERMS)) {
      const rp = (db.rolePermissions || []).find((r) => r.role === role && !r.deletedAt)
      if (rp) rp.permissions = { ...perms, ...rp.permissions }   // never clobber an edited matrix
      else push('rolePermissions', { id: `rp-${role}`, role, permissions: { ...perms } })
    }
    db._orgV1 = true
    dirty = true
  }
  // Tasks V2: recurring demo set. Surgical on purpose — an existing db.json
  // already has the V1 board, so this only renames the daily task, turns on
  // holiday-skipping and adds the missing weekly template. No instances are
  // injected; the generator materializes them on the next sync.
  if (!db._tasksV2) {
    const daily = (db.tasks || []).find((t) => t.id === 'task-attendance')
    if (daily) {
      daily.title = 'Mark class attendance'
      daily.recurrence = { ...daily.recurrence, skipNonWorkingDays: true }
      const today = new Date().toISOString().slice(0, 10)
      // future, untouched occurrences follow the template — same rule the
      // template-edit path uses; history keeps the title it was assigned under
      for (const i of db.taskInstances || []) {
        if (i.taskId === 'task-attendance' && i.status === 'assigned' && i.serviceDate > today) {
          i.title = daily.title
        }
      }
    }
    const calls = (db.tasks || []).find((t) => t.id === 'task-parentcalls')
    if (calls) calls.recurrence = { ...calls.recurrence, skipNonWorkingDays: true }

    if (!(db.tasks || []).some((t) => t.id === 'task-weekly-inventory')) {
      const now = new Date().toISOString()
      const back = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
      db.tasks.push({
        id: 'task-weekly-inventory',
        title: 'Weekly day-care inventory count',
        description: 'Count nappies, wipes and spare uniforms; flag anything under a week of stock.',
        createdByUserId: 'u-sudhir', createdByPositionId: 'pos-sudhir', createdAtNodeId: 'node-sch-jh',
        approverPositionId: 'pos-sudhir',
        target: { kind: 'position', positionIds: ['pos-gayatri'], userIds: [], nodeIds: [], levelId: null, includeSubtree: true },
        priority: 'normal', categoryId: 'tcat-ops',
        dueType: 'end_of_day', dueConfig: { startDate: null, dueDate: null, days: null },
        recurrence: { freq: 'weekly', byWeekday: [5], dayOfMonth: null, interval: 1, startDate: back(21), endDate: null, count: null, skipNonWorkingDays: true },
        requiresApproval: true, requiresMedia: false, mediaTypes: ['photo', 'document'], minAttachments: 0,
        isBlocking: false, status: 'active', academicYearId: 'ay-jh-26',
        lastGeneratedThrough: back(0),
        createdAt: now, createdBy: null, updatedAt: now, updatedBy: null, deletedAt: null,
      })
    }
    db._tasksV2 = true
    dirty = true
  }
  // Tasks V3: rejection is no longer a status of its own — sending work back
  // returns it to `in_progress` so it stays live (and keeps blocking logout).
  // Normalise any row written under the old model; the UI derives the
  // "Sent back" pill from rejectionCount instead.
  if (!db._tasksV3) {
    for (const i of db.taskInstances || []) {
      if (i.status !== 'rejected') continue
      i.status = 'in_progress'
      i.submittedAt = null
      i.rejectionCount = i.rejectionCount || 1
      if (!i.lastRejection) {
        const decision = (db.taskApprovals || []).find((a) => a.instanceId === i.id && a.decision === 'rejected')
        i.lastRejection = {
          at: decision?.decidedAt || i.decidedAt || i.updatedAt,
          by: decision?.approverUserId || null,
          byName: (db.users || []).find((u) => u.id === decision?.approverUserId)?.name || null,
          reason: decision?.comment || i.lastComment || null,
          round: decision?.round || 1,
        }
      }
    }
    // carry the submit time onto older approval records so turnaround stats
    // keep counting rejections after the instance field was cleared
    for (const a of db.taskApprovals || []) {
      if (a.submittedAt !== undefined) continue
      const inst = (db.taskInstances || []).find((i) => i.id === a.instanceId)
      a.submittedAt = inst?.submittedAt || inst?.startedAt || a.decidedAt || null
    }
    db._tasksV3 = true
    dirty = true
  }
  // Tasks V4: staff get their own notification channel preferences (guardians
  // already had them on the guardian record).
  if (!db._tasksV4) {
    for (const u of db.users || []) {
      if (u.role === 'parent' || u.notificationPrefs) continue
      u.notificationPrefs = { inApp: true, push: true, sms: false, whatsapp: true, email: true }
    }
    db._tasksV4 = true
    dirty = true
  }
  // Tasks V5: the type × nature refactor. Existing rows predate both axes, so
  // they are mapped forward with NO DATA LOSS:
  //   origin    <- recurrence (none = a one-off someone assigned = 'manual')
  //   nature    <- 'custom' with an empty condition, because that is exactly
  //                what these tasks meant: the assignee's word, plus whatever
  //                requiresMedia / requiresApproval already demanded
  //   escalation<- escalationPolicyId: null (requiresApproval stays the trigger;
  //                ordered ancestor stages arrive in the escalation slice)
  // requiresMedia, minAttachments, mediaTypes and requiresApproval are NOT
  // consumed or rewritten — they keep being enforced where they always were,
  // and the derived statement mirrors them so the condition reads truthfully.
  if (!db._tasksV5) {
    const conditionOf = (t) => {
      const bits = ['Marked done by the assignee']
      if (t.requiresMedia) {
        const n = t.minAttachments || 1
        bits.push(`with ${n} ${(t.mediaTypes || ['photo']).join(' / ')} file${n > 1 ? 's' : ''} attached`)
      }
      if (t.requiresApproval) bits.push('and signed off by the approver')
      return {
        nature: 'custom',
        mcq: null,
        moduleLinked: null,
        custom: { statement: bits.join(' '), checklist: [], requireNote: false, noteLabel: 'What did you do?' },
        derivedFrom: 'legacy_boolean',
      }
    }
    for (const t of db.tasks || []) {
      if (t.origin === undefined) t.origin = t.recurrence?.freq && t.recurrence.freq !== 'none' ? 'automated' : 'manual'
      if (t.systemKey === undefined) t.systemKey = null
      if (!t.completionCondition) t.completionCondition = conditionOf(t)
      if (!t.onComplete) t.onComplete = { actions: [] }
      if (!t.lockOnComplete) t.lockOnComplete = []
      if (t.escalationPolicyId === undefined) t.escalationPolicyId = null
    }
    // Occurrences carry their own snapshot of the rules they were assigned
    // under, so they are migrated from their template, not left to read it.
    for (const i of db.taskInstances || []) {
      const t = (db.tasks || []).find((x) => x.id === i.taskId)
      if (i.origin === undefined) i.origin = t?.origin ?? 'manual'
      if (!i.completionCondition) i.completionCondition = t?.completionCondition || conditionOf(i)
      if (i.completion === undefined) i.completion = null
    }
    db._tasksV5 = true
    dirty = true
  }
  // Tasks V6: graft the day-care lunch example onto an existing db.json (the
  // seed only runs for a brand-new file). Starts from today with no watermark
  // backlog, so it opens clean instead of arriving with a week of synthetic
  // overdue occurrences.
  if (!db._tasksV6) {
    const today = new Date().toISOString().slice(0, 10)
    const now = new Date().toISOString()
    if (!(db.tasks || []).some((t) => t.id === 'task-daycare-lunch') && (db.orgPositions || []).some((p) => p.id === 'pos-gayatri')) {
      db.tasks.push({
        id: 'task-daycare-lunch', createdAt: now, createdBy: null, updatedAt: now, updatedBy: null, deletedAt: null,
        title: 'Day-care lunch served',
        description: 'Confirm the day-care children have been given their lunch, with a photo of the meal.',
        createdByUserId: 'u-sudhir', createdByPositionId: 'pos-sudhir', createdAtNodeId: 'node-sch-jh',
        approverPositionId: 'pos-sudhir',
        target: { kind: 'node_level', nodeIds: ['node-sch-jh'], levelId: 'lvl-daycare', positionIds: [], userIds: [], includeSubtree: true },
        priority: 'high', categoryId: 'tcat-parents',
        origin: 'automated', systemKey: null,
        dueType: 'end_of_day', dueConfig: { startDate: null, dueDate: null, days: null },
        recurrence: { freq: 'daily', byWeekday: [], dayOfMonth: null, interval: 1, startDate: today, endDate: null, count: null, skipNonWorkingDays: true },
        requiresApproval: false, requiresMedia: true, mediaTypes: ['photo'], minAttachments: 1,
        isBlocking: false, status: 'active', academicYearId: 'ay-jh-26',
        completionCondition: {
          nature: 'mcq',
          mcq: {
            question: 'Did you give food to the day-care children?',
            options: [{ value: 'yes', label: 'Yes', accepts: true }, { value: 'no', label: 'No', accepts: true }],
            requiredAnswer: 'yes', requireMedia: true,
          },
          moduleLinked: null, custom: null, derivedFrom: null,
        },
        onComplete: {
          actions: [{
            moduleKey: 'parents', actionKey: 'notify',
            paramBinding: { sectionId: { source: 'assignee.section' }, date: { source: 'instance.serviceDate' } },
            config: { message: '{child} was given lunch at day care on {date}.' },
            onFailure: 'warn', when: { answer: 'yes' },
          }],
        },
        lockOnComplete: [], escalationPolicyId: null, lastGeneratedThrough: null,
      })
    }
    db._tasksV6 = true
    dirty = true
  }
  // Tasks V7: switch day-end reporting ON for the demo school, so the feature is
  // visible in a database somebody is actually looking at. It stays OFF by
  // default everywhere else — a daily mandatory report that holds someone's
  // logout is not something to turn on for a whole group by surprise.
  // Guarded to the developer's own database (no SCHOOL_CRM_DB override), so a
  // demo switch can never alter a test fixture or a throwaway instance.
  if (!db._tasksV7 && !process.env.SCHOOL_CRM_DB) {
    const jh = (db.orgNodes || []).find((n) => n.id === 'node-sch-jh')
    if (jh) jh.settings = { ...(jh.settings || {}), dayEndReport: true }
    db._tasksV7 = true
    dirty = true
  }
  // Tasks V8: one way to tell parents something.
  //
  // `daycare.notifyParents` was an action that hardcoded "your child was fed",
  // so a task verified against anything else could still send it. It is gone.
  // Every task, occurrence and completed RUN that referenced it is re-pointed
  // at `parents.notify` carrying the same sentence as an ordinary message.
  //
  // Rewriting taskActionRuns matters as much as rewriting the tasks: the run
  // log is what stops an action firing twice, and it is keyed by module.action.
  // Leave those keys behind and every lunch already sent would be eligible to
  // send again the next time its occurrence reached completion.
  if (!db._tasksV8) {
    const MSG = '{child} was given lunch at day care on {date}.'
    const isOld = (a) => a?.moduleKey === 'daycare' && a?.actionKey === 'notifyParents'
    const port = (a) => (isOld(a)
      ? { ...a, moduleKey: 'parents', actionKey: 'notify', config: { message: a.config?.message || MSG } }
      : a)

    for (const coll of ['tasks', 'taskInstances']) {
      for (const row of db[coll] || []) {
        const acts = row.onComplete?.actions
        if (!Array.isArray(acts) || !acts.some(isOld)) continue
        row.onComplete = { ...row.onComplete, actions: acts.map(port) }
      }
    }
    for (const run of db.taskActionRuns || []) {
      if (run.key !== 'daycare.notifyParents') continue
      run.key = 'parents.notify'
      run.moduleKey = 'parents'
      run.actionKey = 'notify'
    }
    db._tasksV8 = true
    dirty = true
  }
  // Tasks V11: priorities become master data.
  //
  // They were four hardcoded strings. A school that wants to rename "Urgent" or
  // add a rung between High and Normal needs a table, and the table needs a
  // `rank`, because sorting must survive a rename.
  //
  // The seeded ids keep the old string as their suffix — `prio-urgent`, not a
  // uuid — so this is a prefix rewrite, an audit row written before the change
  // still reads next to one written after, and a stored task is legible without
  // a join.
  //
  // taskInstances are rewritten too: priority is snapshotted onto every
  // occurrence (generate.js), and the Today view sorts on it. Convert only the
  // templates and every list would silently sort 738 occurrences as "unknown".
  if (!db._tasksV11) {
    const SEEDED = [
      { id: 'prio-urgent', name: 'Urgent', rank: 10, color: '#e5484d', isDefault: false, active: true },
      { id: 'prio-high', name: 'High', rank: 20, color: '#f4772e', isDefault: false, active: true },
      { id: 'prio-normal', name: 'Normal', rank: 30, color: null, isDefault: true, active: true },
      { id: 'prio-low', name: 'Low', rank: 40, color: '#8b84a3', isDefault: false, active: true },
    ]
    const LEGACY = { urgent: 'prio-urgent', high: 'prio-high', normal: 'prio-normal', low: 'prio-low' }

    const at = new Date().toISOString()
    db.taskPriorities = db.taskPriorities || []
    for (const p of SEEDED) {
      if (db.taskPriorities.some((r) => r.id === p.id)) continue
      db.taskPriorities.push({ createdAt: at, createdBy: null, updatedAt: at, updatedBy: null, deletedAt: null, ...p })
    }

    // Idempotent by construction: a value that is already an id is not in LEGACY
    // and is left alone, so a partly converted database converges.
    for (const coll of ['tasks', 'taskInstances']) {
      for (const row of db[coll] || []) {
        const mapped = LEGACY[row.priority]
        if (mapped) row.priority = mapped
        else if (!row.priority) row.priority = 'prio-normal'
      }
    }
    db._tasksV11 = true
    dirty = true
  }
  // Org V2: working days, working hours and employment status on the POSITION.
  //
  // On the position rather than the person, because one person can hold two
  // positions at two schools with different weeks. Resolution is always
  // position -> node -> default.
  //
  // Everything backfills to NULL, which means "inherit". Copying the node's
  // workWeek down onto every position would freeze the fallback: changing the
  // school's week would then stop reaching anyone who had been backfilled.
  // Null-means-inherit is the entire point of the field.
  if (!db._orgV2) {
    for (const p of db.orgPositions || []) {
      if (p.workWeek === undefined) p.workWeek = null
      if (p.hours === undefined) p.hours = null
      // an already-ended position is someone who left; everyone else is active
      if (p.status === undefined) p.status = p.endDate ? 'left' : 'active'
      if (p.effectiveFrom === undefined) p.effectiveFrom = p.startDate || null
      if (p.effectiveTo === undefined) p.effectiveTo = p.endDate || null
    }
    for (const n of db.orgNodes || []) {
      n.settings = n.settings || {}
      if (n.settings.hours === undefined) n.settings.hours = null
      if (!n.settings.workWeek?.length) n.settings.workWeek = [1, 2, 3, 4, 5, 6]
    }
    db._orgV2 = true
    dirty = true
  }
  // Org V2 demo: give the day-care staffer a real shift so "end of their day"
  // is visible in a database somebody is actually looking at. Guarded to the
  // developer's own db (no SCHOOL_CRM_DB override) — same guard, same reason, as
  // _tasksV7: a demo switch must never alter a test fixture.
  //
  // Gayatri deliberately, not a teacher: several tests pin a teacher's dueAt at
  // the end of the local day, and this must not move it.
  if (!db._orgV2Demo && !process.env.SCHOOL_CRM_DB) {
    const g = (db.orgPositions || []).find((p) => p.id === 'pos-gayatri')
    if (g) {
      g.workWeek = [1, 2, 3, 4, 5, 6]
      g.hours = Object.fromEntries([1, 2, 3, 4, 5, 6].map((d) => [String(d), { from: '08:00', to: '18:30' }]))
    }
    db._orgV2Demo = true
    dirty = true
  }
  // Tasks V10: five target kinds collapse into one shape.
  //
  // The old model picked ONE kind by precedence — named people beat roles beat
  // nodes — so the form's three selects could never genuinely combine and
  // "every Teacher at Jubilee Hills plus Priya from HQ, except Renu" could not
  // be said at all. The new shape is three independent lists minus an exclusion
  // list, and `followJoiners` carries what `kind` used to encode about whether
  // the list is recomputed each run or frozen.
  //
  // `kind` stays on the row, derived and display-only, because AssignedByMe and
  // the audit log read it.
  //
  // The read-time shim in tasks/resolve.js keys off `followJoiners` being
  // absent, so a row this misses still resolves correctly — the migration is
  // about making the stored shape honest, not about correctness.
  if (!db._tasksV10) {
    const port = (t) => {
      if (!t || t.followJoiners !== undefined) return t         // already V10
      const levelIds = t.levelIds?.length ? t.levelIds : (t.levelId ? [t.levelId] : [])
      // EVERY list is carried through, not just the one the old `kind` happened
      // to consult. Clearing the others looks tidy and is data loss: the day-end
      // template stores kind:'node' AND a full positionIds, and the generator
      // reads positionIds directly for system tasks — porting it as a bare node
      // target empties the report for everybody.
      //
      // This is safe for ordinary tasks because normalizeTask always wrote the
      // unused lists as [], so there is nothing to carry.
      const positionIds = t.positionIds || []
      const userIds = t.userIds || []
      const named = positionIds.length + userIds.length
      const out = {
        nodeIds: t.nodeIds || [],
        levelIds,
        positionIds,
        userIds,
        excludePositionIds: [],
        includeSubtree: t.includeSubtree !== false,
        // frozen when people were named, live otherwise — exactly what the five
        // kinds meant, so nothing changes for an existing task
        followJoiners: named === 0,
      }
      out.kind = named ? 'position'
        : out.levelIds.length ? 'node_level'
          : out.nodeIds.length ? 'node' : 'downline'
      out.levelId = out.levelIds[0] || null
      return { ...t, ...out }
    }

    // The day-end template is the one to be careful with. Its target is
    // { kind:'node', nodeIds:[node], positionIds:[every active position] } and
    // syncDayEndTemplates rewriting positionIds IS its joiner mechanism. Under
    // the new shape named people win, so it becomes followJoiners:false with a
    // populated positionIds — and the sync keeps it fresh, exactly as before.
    for (const row of db.tasks || []) {
      if (row.target) row.target = port(row.target)
    }
    db._tasksV10 = true
    dirty = true
  }
  // Tasks V9: completion stops being three MUTUALLY EXCLUSIVE natures and
  // becomes one mode plus a list of questions. mcq IS one choose_one question;
  // custom IS one checklist question plus a text one when a note was asked for.
  //
  //   mcq            -> mode 'answers', one yes_no (exactly 2 options) or
  //                     choose_one question, proof.required <- requireMedia
  //   custom         -> mode 'answers', a checklist question when there are
  //                     items, a text question when a note was required, and
  //                     the statement carried across whole
  //   module_linked  -> mode 'system', system <- the moduleLinked object
  //   completion.{answer,checked,note}  -> completion.answers, keyed by the
  //                     SAME ids the read-time shim derives
  //   onComplete.actions[].when.answer  -> { questionId, answer }
  //
  // THE IDS ARE THE WHOLE RISK. They are duplicated here rather than imported
  // because there is a real cycle — db.js -> tasks/conditions.js ->
  // capabilities/index.js -> *.cap.js -> db.js — which is exactly why _tasksV5
  // writes its own conditionOf() instead of importing legacyCondition. If these
  // three strings ever drift from QID in server/tasks/conditions.js, a row this
  // migration converted disagrees with a row the shim converted and a live
  // completion.answers key is orphaned.
  //
  // It rewrites the taskInstances SNAPSHOT as well as the templates: the
  // snapshot is what an in-flight occurrence is judged against.
  //
  // Runs after V5 (which creates completionCondition on rows that never had
  // one), after V6 (which inserts the lunch task in the old shape, with the
  // when: {answer:'yes'} that must not silently stop telling parents), and
  // after V8 (which rewrites the same onComplete.actions array).
  if (!db._tasksV9) {
    const QID9 = { answer: 'answer', checklist: 'checklist', note: 'note' }
    const NO_PROOF = { required: false, types: null, min: null }

    const port = (c) => {
      if (!c || c.mode) return c || null
      const base = { statement: null, proof: NO_PROOF, derivedFrom: c.derivedFrom || null }
      if (c.nature === 'module_linked') {
        return { ...base, mode: 'system', questions: [], system: c.moduleLinked || null }
      }
      if (c.nature === 'mcq') {
        const mcq = c.mcq || {}
        const options = mcq.options || []
        return {
          ...base,
          mode: 'answers',
          system: null,
          questions: [{
            id: QID9.answer,
            type: options.length === 2 ? 'yes_no' : 'choose_one',
            prompt: mcq.question || '',
            required: true,
            options,
            requiredAnswer: mcq.requiredAnswer || '',
          }],
          proof: { required: !!mcq.requireMedia, types: null, min: null },
        }
      }
      const cu = c.custom || {}
      const questions = []
      if ((cu.checklist || []).length) {
        questions.push({
          id: QID9.checklist,
          type: 'checklist',
          prompt: cu.statement || 'Confirm each of these',
          required: true,
          items: cu.checklist,
        })
      }
      if (cu.requireNote) {
        questions.push({ id: QID9.note, type: 'text', prompt: cu.noteLabel || '', required: true })
      }
      return { ...base, mode: 'answers', system: null, questions, statement: cu.statement || null }
    }

    const portWhen = (row, cond) => {
      const acts = row?.onComplete?.actions
      if (!Array.isArray(acts)) return
      const choice = (cond?.questions || []).find((q) => q.type === 'yes_no' || q.type === 'choose_one')
      for (const a of acts) {
        if (!a?.when || a.when.questionId) continue
        a.when = { questionId: choice?.id || QID9.answer, answer: a.when.answer }
      }
    }

    const portCompletion = (inst) => {
      const done = inst.completion
      if (!done || done.answers) return
      const answers = {}
      for (const q of inst.completionCondition?.questions || []) {
        if (q.type === 'checklist') {
          if (Array.isArray(done.checked)) answers[q.id] = done.checked
        } else if (q.id === QID9.note) {
          if (done.note != null) answers[q.id] = done.note
        } else if (q.id === QID9.answer) {
          if (done.answer != null) answers[q.id] = done.answer
        }
      }
      inst.completion = { answers, at: done.at || null, byUserId: done.byUserId || null }
    }

    for (const t of db.tasks || []) {
      t.completionCondition = port(t.completionCondition)
      portWhen(t, t.completionCondition)
    }
    for (const i of db.taskInstances || []) {
      i.completionCondition = port(i.completionCondition)
      portWhen(i, i.completionCondition)
      portCompletion(i)
    }
    db._tasksV9 = true
    dirty = true
  }

  if (dirty) persist()
}

let saveTimer = null
export function save() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    persist()
  }, 50)
}

function persist() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2))
}

export const uid = () => crypto.randomUUID()

export function list(coll, where = null) {
  const rows = getDb()[coll].filter((r) => !r.deletedAt)
  if (!where) return rows
  if (typeof where === 'function') return rows.filter(where)
  return rows.filter((r) =>
    Object.entries(where).every(([k, v]) => v === undefined || r[k] === v)
  )
}

export function find(coll, id) {
  return getDb()[coll].find((r) => r.id === id && !r.deletedAt) || null
}

// ---------------------------------------------------------------- activity ---
// THE ACTIVITY TRAIL, written from the one place every write in the app passes
// through. A task can then be verified against "did this person do that thing
// in that module today" for ANY module, without each module remembering to
// record anything — which is what audit() coverage showed does not happen: two
// whole route files had no audit calls at all.
//
// It stores who / what / when only. Never the row contents: this answers
// "was it done", and the record itself is already in its own collection.
function trackActivity(coll, op, row, userId) {
  if (!userId || !isTracked(coll)) return
  const meta = ACTIVITIES[coll]
  const at = new Date().toISOString()
  db.activityLog.push({
    id: uid(),
    collection: coll,
    module: meta.module,
    op,
    recordId: row?.id || null,
    userId,
    // the scope the row belongs to (a section, usually), so a task can ask for
    // "their class" rather than merely "somewhere"
    scopeId: meta.scopeKey ? row?.[meta.scopeKey] ?? null : null,
    branchId: row?.branchId ?? null,
    // the row's OWN date when it has one (attendance for the 3rd, marked on the
    // 4th, is activity for the 3rd), else the school's current day. NOT
    // at.slice(0,10) — that is UTC, and a task asks in the school's timezone.
    date: typeof row?.date === 'string' ? row.date : localDate(DEFAULT_TZ, at),
    at,
  })
}

export function insert(coll, data, userId = null) {
  const now = new Date().toISOString()
  const row = {
    id: uid(),
    ...data,
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    deletedAt: null,
  }
  getDb()[coll].push(row)
  trackActivity(coll, 'created', row, userId)
  touchOrg(coll)
  save()
  return row
}

export function update(coll, id, patch, userId = null) {
  const row = find(coll, id)
  if (!row) return null
  Object.assign(row, patch, { updatedAt: new Date().toISOString(), updatedBy: userId })
  trackActivity(coll, 'updated', row, userId)
  touchOrg(coll)
  save()
  return row
}

export function softDelete(coll, id, userId = null) {
  const row = find(coll, id)
  if (!row) return null
  row.deletedAt = new Date().toISOString()
  row.updatedBy = userId
  trackActivity(coll, 'deleted', row, userId)
  touchOrg(coll)
  save()
  return row
}

// Real delete, no tombstone. Used only where a soft-deleted row would collide
// with a deterministic id later (unstarted future task occurrences that their
// template no longer schedules).
export function hardDelete(coll, id) {
  const rows = getDb()[coll]
  const at = rows.findIndex((r) => r.id === id)
  if (at === -1) return false
  rows.splice(at, 1)
  touchOrg(coll)
  save()
  return true
}

export function nextNumber(key) {
  const d = getDb()
  d._counters[key] = (d._counters[key] || 0) + 1
  save()
  return d._counters[key]
}
