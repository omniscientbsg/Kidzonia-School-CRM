import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { list, find, insert, update, softDelete } from '../db.js'
import { requireAuth, requirePermission, branchWhere, staffOnly } from '../auth.js'
import { audit } from '../audit.js'
import { sanitizeUser, crudRoutes } from './util.js'
import { createStaffUser, validateStaffPayload } from '../users/service.js'
import { guardianUserIdsOfStudent } from '../notify.js'

const router = Router()
router.use(requireAuth)

// ============================================================================
// Day Care — reusable dish library + weekly meal plan (menu) with per-child
// allergy warnings. Activities reuse the existing daily-logs / check-in-out.
// ============================================================================
const MEAL_TYPES = ['breakfast', 'lunch', 'snack', 'dinner']

// dish library
crudRoutes(router, '/dishes', 'dishes', 'daycare', { filters: ['branchId'], readAnyStaff: false })

// Activity master catalog — reusable activity *definitions* (Check In, Nap, Meal…)
// that the operational Daily module logs against. NOT per-child records.
crudRoutes(router, '/daycare-activities', 'daycareActivities', 'daycare', { filters: ['branchId'], readAnyStaff: true, auditable: true })

// ============================================================================
// Groups — cross-class cohorts (activity / transport / custom), session-scoped.
// ============================================================================
crudRoutes(router, '/groups', 'groups', 'setup', { filters: ['branchId', 'academicYearId', 'type'], readAnyStaff: true, auditable: true })

// resolve a group's student members to summaries
router.get('/groups/:id/members', staffOnly, (req, res) => {
  const group = find('groups', req.params.id)
  if (!group) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && group.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const sectionName = Object.fromEntries(list('sections').map((s) => [s.id, s.name]))
  const classOfSection = Object.fromEntries(list('sections').map((s) => [s.id, s.classId]))
  const className = Object.fromEntries(list('classes').map((c) => [c.id, c.name]))
  const members = (group.memberIds || []).map((sid) => {
    const st = find('students', sid)
    if (!st) return null
    const enr = list('enrolments', (e) => e.studentId === sid && !e.leftAt)[0]
    return { id: sid, name: `${st.firstName} ${st.lastName}`, section: enr ? sectionName[enr.sectionId] : '', className: enr ? className[classOfSection[enr.sectionId]] : '' }
  }).filter(Boolean)
  res.json(members)
})

// resolve a group into notification recipients (for the Communication module):
// staff users directly + guardians of member students + guardians of students
// in any whole-class the group targets.
router.get('/groups/:id/recipients', staffOnly, (req, res) => {
  const group = find('groups', req.params.id)
  if (!group) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && group.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })

  const staffUserIds = (group.staffIds || []).filter((id) => { const u = find('users', id); return u && u.active !== false })
  const studentIds = new Set(group.memberIds || [])
  for (const classId of group.classIds || []) {
    for (const sec of list('sections', { classId })) {
      for (const e of list('enrolments', (x) => x.sectionId === sec.id && !x.leftAt)) studentIds.add(e.studentId)
    }
  }
  const guardianUserIds = [...new Set([...studentIds].flatMap((sid) => guardianUserIdsOfStudent(sid)))]
  res.json({
    groupId: group.id, name: group.name, type: group.type,
    staff: staffUserIds, guardians: guardianUserIds,
    studentCount: studentIds.size, total: staffUserIds.length + guardianUserIds.length,
  })
})

// daycare-cohort students in a session (for allergy cross-reference)
function daycareStudentIds(session) {
  const classes = list('classes', (c) => c.academicYearId === session.id && (c.programId || '').includes('daycare'))
  const classIds = new Set(classes.map((c) => c.id))
  return list('enrolments', (e) => classIds.has(e.classId) && !e.leftAt).map((e) => e.studentId)
}

// weekly menu + dishes library + allergy warnings
router.get('/dc-menu', requirePermission('daycare', 'view'), (req, res) => {
  const session = resolveSession(req)
  if (!session) return res.json({ session: null, meals: [], dishes: [], mealTypes: MEAL_TYPES })
  if (req.scope.branchId && session.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })

  const dishes = list('dishes', { branchId: session.branchId })
  const dishById = Object.fromEntries(dishes.map((d) => [d.id, d]))
  const dcKids = daycareStudentIds(session).map((sid) => find('students', sid)).filter(Boolean)

  const meals = list('dcMeals', { branchId: session.branchId, sessionId: session.id }).map((m) => {
    const mDishes = (m.dishIds || []).map((id) => dishById[id]).filter(Boolean)
    const allergens = [...new Set(mDishes.flatMap((d) => d.allergens || []))]
    const warnings = []
    for (const kid of dcKids) {
      const allergies = (kid.allergies || '').toLowerCase()
      if (!allergies) continue
      const hit = allergens.filter((a) => allergies.includes(a.toLowerCase()))
      if (hit.length) warnings.push({ studentId: kid.id, name: `${kid.firstName} ${kid.lastName}`, allergens: hit })
    }
    return { ...m, dishes: mDishes, allergens, allergyWarnings: warnings }
  })
  res.json({ session: { id: session.id, name: session.name }, meals, dishes, mealTypes: MEAL_TYPES })
})

router.post('/dc-meals', requirePermission('daycare', 'create'), (req, res) => {
  const session = req.body.sessionId ? find('academicYears', req.body.sessionId) : resolveSession(req)
  if (!session) return res.status(422).json({ error: 'Session required' })
  if (req.scope.branchId && session.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const b = req.body
  if (!MEAL_TYPES.includes(b.mealType)) return res.status(422).json({ error: 'Invalid meal type' })
  if (b.dayOfWeek === undefined || b.dayOfWeek < 0 || b.dayOfWeek > 6) return res.status(422).json({ error: 'Invalid day of week' })
  if (!b.name || !b.name.trim()) return res.status(422).json({ error: 'Name is required' })
  const row = insert('dcMeals', {
    branchId: session.branchId, sessionId: session.id, dayOfWeek: b.dayOfWeek, mealType: b.mealType,
    name: b.name.trim(), description: b.description || '', dishIds: b.dishIds || [],
    showStartTime: !!b.showStartTime, startTime: b.showStartTime ? (b.startTime || null) : null, published: false,
  }, req.user.id)
  audit(req, 'create', 'dcMeals', row.id, null, row)
  res.status(201).json(row)
})

router.put('/dc-meals/:id', requirePermission('daycare', 'edit'), (req, res) => {
  const before = find('dcMeals', req.params.id)
  if (!before) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && before.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const b = req.body
  const patch = {}
  for (const k of ['dayOfWeek', 'mealType', 'name', 'description', 'dishIds', 'showStartTime', 'startTime', 'published']) {
    if (b[k] !== undefined) patch[k] = b[k]
  }
  if (patch.name !== undefined) patch.name = String(patch.name).trim()
  const row = update('dcMeals', before.id, patch, req.user.id)
  res.json(row)
})

router.delete('/dc-meals/:id', requirePermission('daycare', 'delete'), (req, res) => {
  const row = find('dcMeals', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && row.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  softDelete('dcMeals', req.params.id, req.user.id)
  res.json({ ok: true })
})

// publish the whole week's menu to parents
router.post('/dc-menu/publish', requirePermission('daycare', 'edit'), (req, res) => {
  const session = req.body.sessionId ? find('academicYears', req.body.sessionId) : resolveSession(req)
  if (!session) return res.status(422).json({ error: 'Session required' })
  if (req.scope.branchId && session.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const publish = req.body.published !== false
  const meals = list('dcMeals', { branchId: session.branchId, sessionId: session.id })
  for (const m of meals) update('dcMeals', m.id, { published: publish }, req.user.id)
  audit(req, publish ? 'publish' : 'unpublish', 'dcMeals', session.id, null, { count: meals.length })
  res.json({ published: publish, count: meals.length })
})

// ============================================================================
// Staff — reuses the `users` collection (role !== 'parent') with extra HR fields.
// ============================================================================

// Validation lives in the user master (server/users/service.js) so Settings and
// Setup cannot drift apart. This is a thin alias kept for the local call sites.
const validateStaff = (body, selfId = null) => validateStaffPayload(body, { existingId: selfId })

router.get('/staff', requirePermission('staff', 'view'), (req, res) => {
  let rows = list('users', (u) => u.role !== 'parent')
  if (req.scope.branchId) rows = rows.filter((u) => u.branchId === req.scope.branchId || !u.branchId)
  if (req.query.branchId) rows = rows.filter((u) => u.branchId === req.query.branchId)
  res.json(rows.map(sanitizeUser))
})

router.post('/staff', requirePermission('staff', 'create'), (req, res) => {
  const err = validateStaff(req.body)
  if (err) return res.status(422).json({ error: err })
  const row = createStaffUser(req.body, req.user.id, { branchFallback: req.scope.branchId })
  audit(req, 'create', 'users', row.id, null, sanitizeUser(row))
  res.status(201).json(sanitizeUser(row))
})

router.put('/staff/:id', requirePermission('staff', 'edit'), (req, res) => {
  const before = find('users', req.params.id)
  if (!before || before.role === 'parent') return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && before.branchId && before.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const b = req.body
  const merged = { ...before, ...b }
  const err = validateStaff({ name: merged.name, username: merged.username, role: merged.role, phone: merged.phone }, before.id)
  if (err) return res.status(422).json({ error: err })
  const patch = {}
  for (const k of ['name', 'phone', 'role', 'designation', 'subjects', 'classTeacherOf', 'subjectTeacher', 'groupAdmin', 'photoId', 'active', 'branchId']) {
    if (b[k] !== undefined) patch[k] = b[k]
  }
  if (b.username !== undefined) { patch.username = b.username.toLowerCase().trim(); patch.email = `${patch.username}@kidzonia.com` }
  if (b.password) patch.passwordHash = bcrypt.hashSync(b.password, 10)
  const row = update('users', before.id, patch, req.user.id)
  audit(req, 'update', 'users', row.id, sanitizeUser(before), sanitizeUser(row))
  res.json(sanitizeUser(row))
})

// ---- Staff attendance ----
const STAFF_ATT = ['present', 'absent', 'half_day', 'leave']

router.get('/staff-attendance', requirePermission('staff', 'view'), (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10)
  let staff = list('users', (u) => u.role !== 'parent' && u.active !== false)
  if (req.scope.branchId) staff = staff.filter((u) => u.branchId === req.scope.branchId)
  else if (req.query.branchId) staff = staff.filter((u) => u.branchId === req.query.branchId)
  const marks = Object.fromEntries(list('staffAttendance', (a) => a.date === date).map((a) => [a.staffId, a]))
  const rows = staff
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ staffId: u.id, name: u.name, employeeId: u.employeeId || null, designation: u.designation || '', role: u.role, status: marks[u.id]?.status || null }))
  res.json({ date, staff: rows })
})

router.post('/staff-attendance', requirePermission('staff', 'edit'), (req, res) => {
  const { date, records = [] } = req.body || {}
  if (!date) return res.status(422).json({ error: 'Date is required' })
  let saved = 0
  for (const r of records) {
    if (!STAFF_ATT.includes(r.status)) continue
    const staff = find('users', r.staffId)
    if (!staff || staff.role === 'parent') continue
    if (req.scope.branchId && staff.branchId !== req.scope.branchId) continue
    const existing = list('staffAttendance', (a) => a.staffId === r.staffId && a.date === date)[0]
    if (existing) update('staffAttendance', existing.id, { status: r.status }, req.user.id)
    else insert('staffAttendance', { branchId: staff.branchId, staffId: r.staffId, date, status: r.status, note: r.note || '', markedBy: req.user.id }, req.user.id)
    saved += 1
  }
  res.json({ saved })
})

router.get('/staff-attendance/summary', requirePermission('staff', 'view'), (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7)
  let staff = list('users', (u) => u.role !== 'parent' && u.active !== false)
  if (req.scope.branchId) staff = staff.filter((u) => u.branchId === req.scope.branchId)
  else if (req.query.branchId) staff = staff.filter((u) => u.branchId === req.query.branchId)
  const rows = staff.sort((a, b) => a.name.localeCompare(b.name)).map((u) => {
    const recs = list('staffAttendance', (a) => a.staffId === u.id && a.date.startsWith(month))
    const c = { present: 0, absent: 0, half_day: 0, leave: 0 }
    for (const r of recs) if (r.status in c) c[r.status] += 1
    const marked = recs.length
    const presentPct = marked ? Math.round(((c.present + 0.5 * c.half_day) / marked) * 1000) / 10 : 0
    return { staffId: u.id, name: u.name, employeeId: u.employeeId || '', designation: u.designation || '', ...c, marked, presentPct }
  })
  res.json({ month, staff: rows })
})

// ============================================================================
// Sessions (academic years)
// Model: `active` (exactly one true per branch) + `archived` (read-only when
// true). CRUD lives here (not the generic crudRoutes) so we can enforce
// date-order + overlap validation and the archive lifecycle.
// ============================================================================

// Resolve which branch a write targets: super admin passes branchId, everyone
// else is pinned to their own scope.
function targetBranch(req, body) {
  return req.scope.branchId || body?.branchId || req.query.branchId || null
}

const rangesOverlap = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && bStart <= aEnd

// Returns an error string, or null when the payload is valid.
function validateSession(body, branchId, excludeId = null) {
  const { name, startDate, endDate } = body
  if (!name || !name.trim()) return 'Name is required'
  if (!startDate || !endDate) return 'Start and end dates are required'
  if (endDate <= startDate) return 'End date must be after the start date'
  const siblings = list('academicYears', (y) => y.branchId === branchId && y.id !== excludeId)
  for (const s of siblings) {
    if (s.startDate && s.endDate && rangesOverlap(startDate, endDate, s.startDate, s.endDate)) {
      return `Dates overlap with "${s.name}" (${s.startDate} → ${s.endDate})`
    }
  }
  return null
}

// list — readable by any staff (structural data), branch-scoped
router.get('/academic-years', staffOnly, (req, res) => {
  let where = {}
  if (req.query.active !== undefined) where.active = req.query.active === 'true'
  where = branchWhere(req, where)
  res.json(list('academicYears', where))
})

router.get('/academic-years/:id', staffOnly, (req, res) => {
  const row = find('academicYears', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && row.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

// class + student counts per session, for the card stats
router.get('/session-stats', staffOnly, (req, res) => {
  const sessions = list('academicYears', branchWhere(req))
  const classes = list('classes')
  const enrolments = list('enrolments')
  const stats = sessions.map((s) => {
    const classCount = classes.filter((c) => c.academicYearId === s.id).length
    const studentIds = new Set(enrolments.filter((e) => e.academicYearId === s.id && !e.leftAt).map((e) => e.studentId))
    return { sessionId: s.id, classes: classCount, students: studentIds.size }
  })
  res.json(stats)
})

router.post('/academic-years', requirePermission('settings', 'create'), (req, res) => {
  const branchId = targetBranch(req, req.body)
  if (!branchId) return res.status(400).json({ error: 'Branch is required' })
  const err = validateSession(req.body, branchId)
  if (err) return res.status(422).json({ error: err })
  const row = insert('academicYears', {
    name: req.body.name.trim(),
    startDate: req.body.startDate,
    endDate: req.body.endDate,
    branchId,
    active: false,
    archived: false,
  }, req.user.id)
  audit(req, 'create', 'academicYears', row.id, null, row)
  res.status(201).json(row)
})

router.put('/academic-years/:id', requirePermission('settings', 'edit'), (req, res) => {
  const before = find('academicYears', req.params.id)
  if (!before) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && before.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  if (before.archived) return res.status(409).json({ error: 'Archived sessions are read-only. Restore it first to edit.' })
  const err = validateSession({ name: req.body.name ?? before.name, startDate: req.body.startDate ?? before.startDate, endDate: req.body.endDate ?? before.endDate }, before.branchId, before.id)
  if (err) return res.status(422).json({ error: err })
  const snapshot = { ...before }
  const row = update('academicYears', before.id, {
    name: (req.body.name ?? before.name).trim(),
    startDate: req.body.startDate ?? before.startDate,
    endDate: req.body.endDate ?? before.endDate,
  }, req.user.id)
  audit(req, 'update', 'academicYears', row.id, snapshot, row)
  res.json(row)
})

// Activate: becomes the single active session for its branch; the previous
// active one is demoted (kept editable, not archived).
router.put('/academic-years/:id/activate', requirePermission('settings', 'edit'), (req, res) => {
  const target = find('academicYears', req.params.id)
  if (!target) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && target.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  if (target.archived) return res.status(409).json({ error: 'Restore the session before activating it' })

  for (const s of list('academicYears', { branchId: target.branchId })) {
    if (s.id !== target.id && s.active) update('academicYears', s.id, { active: false }, req.user.id)
  }
  const before = { ...target }
  const row = update('academicYears', target.id, { active: true }, req.user.id)
  audit(req, 'update', 'academicYears', row.id, before, row)
  res.json(row)
})

// Archive (soft, reversible). The active session cannot be archived.
router.put('/academic-years/:id/archive', requirePermission('settings', 'edit'), (req, res) => {
  const row = find('academicYears', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && row.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const archived = req.body.archived !== false
  if (archived && row.active) return res.status(409).json({ error: 'Cannot archive the active session. Activate another session first.' })
  const before = { ...row }
  const updated = update('academicYears', row.id, { archived }, req.user.id)
  audit(req, archived ? 'archive' : 'restore', 'academicYears', row.id, before, updated)
  res.json(updated)
})

// Clone structure into a brand-new session: copies classes + sections (incl.
// teacher assignments), NOT students / enrolments.
router.post('/academic-years/:id/clone', requirePermission('settings', 'create'), (req, res) => {
  const source = find('academicYears', req.params.id)
  if (!source) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && source.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const err = validateSession(req.body, source.branchId)
  if (err) return res.status(422).json({ error: err })

  const newSession = insert('academicYears', {
    name: req.body.name.trim(),
    startDate: req.body.startDate,
    endDate: req.body.endDate,
    branchId: source.branchId,
    active: false,
    archived: false,
  }, req.user.id)

  const srcClasses = list('classes', { academicYearId: source.id })
  let classCount = 0
  let sectionCount = 0
  for (const c of srcClasses) {
    const newClass = insert('classes', {
      branchId: c.branchId,
      academicYearId: newSession.id,
      programId: c.programId,
      name: c.name,
      capacity: c.capacity,
    }, req.user.id)
    classCount += 1
    for (const s of list('sections', { classId: c.id })) {
      insert('sections', { classId: newClass.id, name: s.name, capacity: s.capacity, teacherId: s.teacherId }, req.user.id)
      sectionCount += 1
    }
  }
  audit(req, 'clone', 'academicYears', newSession.id, { from: source.id }, { classCount, sectionCount })
  res.status(201).json({ session: newSession, classCount, sectionCount })
})

// ============================================================================
// Classes (admin config layer — reuses the same `classes` + `sections` rows
// the student module uses; only adds read helpers here)
// ============================================================================

// Live student + section counts per class, branch-scoped. Optional ?academicYearId
router.get('/class-stats', staffOnly, (req, res) => {
  let classes = list('classes', branchWhere(req))
  if (req.query.academicYearId) classes = classes.filter((c) => c.academicYearId === req.query.academicYearId)
  const enrolments = list('enrolments')
  const sections = list('sections')
  const stats = classes.map((c) => ({
    classId: c.id,
    students: enrolments.filter((e) => e.classId === c.id && !e.leftAt).length,
    sections: sections.filter((s) => s.classId === c.id).length,
  }))
  res.json(stats)
})

// Roster of currently-enrolled students in a class, for CSV/Excel/PDF export.
router.get('/classes/:id/roster', staffOnly, (req, res) => {
  const cls = find('classes', req.params.id)
  if (!cls) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && cls.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const sectionName = Object.fromEntries(list('sections', { classId: cls.id }).map((s) => [s.id, s.name]))
  const rows = list('enrolments', (e) => e.classId === cls.id && !e.leftAt)
    .map((e) => {
      const st = find('students', e.studentId)
      if (!st) return null
      return {
        id: st.id,
        rollNo: st.rollNo,
        name: `${st.firstName} ${st.lastName}`,
        section: sectionName[e.sectionId] || '',
        gender: st.gender,
        dob: st.dob,
        bloodGroup: st.bloodGroup || '',
        allergies: st.allergies || '',
        status: st.status,
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.section || '').localeCompare(b.section || '') || (a.rollNo || 0) - (b.rollNo || 0))
  res.json({ class: { id: cls.id, name: cls.name, code: cls.code }, students: rows })
})

// ============================================================================
// Student Breakup — read-only reporting aggregated live from student records
// for a session. Tallies strength/EWS, category-wise, and age-band/special-needs.
// ============================================================================
const CATEGORIES = ['General', 'OBC', 'SC', 'ST', 'Not Provided', 'Others']
const AGE_BANDS = ['<2', '2-3', '3-4', '4-5', '5-6', '6+']

const triple = () => ({ boys: 0, girls: 0, total: 0 })
function addTo(t, gender) {
  if (gender === 'male') t.boys += 1
  else t.girls += 1
  t.total += 1
}
function ageYearsAt(dob, refISO) {
  const d = new Date(dob), r = new Date(refISO)
  let m = (r.getFullYear() - d.getFullYear()) * 12 + (r.getMonth() - d.getMonth())
  if (r.getDate() < d.getDate()) m -= 1
  return Math.floor(m / 12)
}
const bandOf = (y) => (y < 2 ? '<2' : y >= 6 ? '6+' : `${y}-${y + 1}`)

function blankRow(classId, className) {
  return {
    classId, className,
    strength: triple(), ews: triple(), specialNeeds: triple(),
    categories: Object.fromEntries(CATEGORIES.map((c) => [c, triple()])),
    ageBands: Object.fromEntries(AGE_BANDS.map((b) => [b, triple()])),
  }
}
function mergeInto(acc, row) {
  const addTriple = (a, b) => { a.boys += b.boys; a.girls += b.girls; a.total += b.total }
  addTriple(acc.strength, row.strength); addTriple(acc.ews, row.ews); addTriple(acc.specialNeeds, row.specialNeeds)
  for (const c of CATEGORIES) addTriple(acc.categories[c], row.categories[c])
  for (const b of AGE_BANDS) addTriple(acc.ageBands[b], row.ageBands[b])
}

router.get('/reports/student-breakup', requirePermission('students', 'view'), (req, res) => {
  const scoped = list('academicYears', branchWhere(req))
  let session = req.query.sessionId ? find('academicYears', req.query.sessionId) : null
  if (!session) session = scoped.find((s) => s.active) || scoped[0] || null
  if (!session) return res.json({ session: null, categories: CATEGORIES, ageBands: AGE_BANDS, rows: [], totals: null })
  if (req.scope.branchId && session.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })

  const classes = list('classes', { academicYearId: session.id }).filter((c) => c.active !== false).sort((a, b) => a.name.localeCompare(b.name))
  const enrolments = list('enrolments', (e) => e.academicYearId === session.id && !e.leftAt)
  const enrolByClass = {}
  for (const e of enrolments) (enrolByClass[e.classId] ||= []).push(e)

  const rows = classes.map((c) => {
    const row = blankRow(c.id, c.name)
    for (const e of enrolByClass[c.id] || []) {
      const st = find('students', e.studentId)
      if (!st) continue
      const g = st.gender
      addTo(row.strength, g)
      if (st.ews) addTo(row.ews, g)
      if (st.specialNeeds) addTo(row.specialNeeds, g)
      const cat = CATEGORIES.includes(st.category) ? st.category : 'Not Provided'
      addTo(row.categories[cat], g)
      addTo(row.ageBands[bandOf(ageYearsAt(st.dob, session.startDate))], g)
    }
    return row
  })

  const totals = blankRow(null, 'TOTAL')
  for (const r of rows) mergeInto(totals, r)

  res.json({ session: { id: session.id, name: session.name }, categories: CATEGORIES, ageBands: AGE_BANDS, rows, totals })
})

// ============================================================================
// Class Attendance analytics — read-only reporting over attendanceRecords.
// (Daily marking lives elsewhere; this is the analytics layer.)
// ============================================================================
const emptyAtt = () => ({ present: 0, absent: 0, late: 0, leave: 0, half_day: 0 })
function addAtt(c, status) { if (status in c) c[status] += 1 }
const attTotal = (c) => c.present + c.absent + c.late + c.leave + c.half_day
// late counts as attended; half-day as 0.5
const attPct = (c) => { const t = attTotal(c); return t ? Math.round(((c.present + c.late + 0.5 * c.half_day) / t) * 1000) / 10 : 0 }

function resolveSession(req) {
  const scoped = list('academicYears', branchWhere(req))
  let session = req.query.sessionId ? find('academicYears', req.query.sessionId) : null
  if (!session) session = scoped.find((s) => s.active) || scoped[0] || null
  return session
}
function attRange(req) {
  const to = req.query.to || new Date().toISOString().slice(0, 10)
  let from = req.query.from
  if (!from) { const d = new Date(to); d.setDate(d.getDate() - 27); from = d.toISOString().slice(0, 10) }
  return { from, to }
}

// Class-wise summary + overall daily trend for a session/date-range
router.get('/reports/attendance', requirePermission('attendance', 'view'), (req, res) => {
  const session = resolveSession(req)
  if (!session) return res.json({ session: null, from: null, to: null, classes: [], trend: [], totals: emptyAtt() })
  if (req.scope.branchId && session.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const { from, to } = attRange(req)

  const classes = list('classes', { academicYearId: session.id }).filter((c) => c.active !== false).sort((a, b) => a.name.localeCompare(b.name))
  const classOfSection = {}
  for (const c of classes) for (const s of list('sections', { classId: c.id })) classOfSection[s.id] = c.id

  const perClass = Object.fromEntries(classes.map((c) => [c.id, emptyAtt()]))
  const byDate = {}
  for (const r of list('attendanceRecords', (x) => x.date >= from && x.date <= to)) {
    const cid = classOfSection[r.sectionId]
    if (!cid) continue
    addAtt(perClass[cid], r.status)
    if (!byDate[r.date]) byDate[r.date] = emptyAtt()
    addAtt(byDate[r.date], r.status)
  }

  const totals = emptyAtt()
  const classesOut = classes.map((c) => {
    const counts = perClass[c.id]
    for (const k of Object.keys(totals)) totals[k] += counts[k]
    return { classId: c.id, className: c.name, counts, records: attTotal(counts), presentPct: attPct(counts) }
  })
  const trend = Object.keys(byDate).sort().map((d) => ({ date: d, pct: attPct(byDate[d]), records: attTotal(byDate[d]) }))

  res.json({ session: { id: session.id, name: session.name }, from, to, classes: classesOut, trend, totals, totalPct: attPct(totals) })
})

// Drill-down: per-student attendance % for one class + that class's trend
router.get('/reports/attendance/class/:classId', requirePermission('attendance', 'view'), (req, res) => {
  const cls = find('classes', req.params.classId)
  if (!cls) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && cls.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const { from, to } = attRange(req)
  const sectionIds = new Set(list('sections', { classId: cls.id }).map((s) => s.id))
  const sectionName = Object.fromEntries(list('sections', { classId: cls.id }).map((s) => [s.id, s.name]))

  const perStudent = {}
  const studentSection = {}
  const byDate = {}
  for (const r of list('attendanceRecords', (x) => x.date >= from && x.date <= to && sectionIds.has(x.sectionId))) {
    if (!perStudent[r.studentId]) perStudent[r.studentId] = emptyAtt()
    addAtt(perStudent[r.studentId], r.status)
    studentSection[r.studentId] = sectionName[r.sectionId] || ''
    if (!byDate[r.date]) byDate[r.date] = emptyAtt()
    addAtt(byDate[r.date], r.status)
  }

  const students = Object.entries(perStudent).map(([sid, counts]) => {
    const st = find('students', sid)
    const p = attPct(counts)
    return { studentId: sid, name: st ? `${st.firstName} ${st.lastName}` : sid, section: studentSection[sid], counts, records: attTotal(counts), presentPct: p, chronic: p < 75 }
  }).sort((a, b) => a.presentPct - b.presentPct)

  const trend = Object.keys(byDate).sort().map((d) => ({ date: d, pct: attPct(byDate[d]) }))
  res.json({ class: { id: cls.id, name: cls.name }, from, to, students, trend })
})

// ============================================================================
// Transfer / Promotion — move students between classes/sections, typically
// across sessions (year rollover). Closes the current enrolment and opens a
// new one in the target. Section capacity is enforced unless override:true.
// ============================================================================
router.post('/transfers', requirePermission('students', 'edit'), (req, res) => {
  const { fromSessionId, toSessionId, fromClassId, toClassId, toSectionId, studentIds = [], override = false } = req.body || {}
  const fromClass = find('classes', fromClassId)
  const toClass = find('classes', toClassId)
  if (!fromClass || !toClass) return res.status(404).json({ error: 'Class not found' })
  if (req.scope.branchId && (fromClass.branchId !== req.scope.branchId || toClass.branchId !== req.scope.branchId)) {
    return res.status(404).json({ error: 'Not found' })
  }
  if (fromClass.branchId !== toClass.branchId) return res.status(422).json({ error: 'Cannot transfer across branches' })
  if (fromClass.academicYearId !== fromSessionId || toClass.academicYearId !== toSessionId) {
    return res.status(422).json({ error: 'Class does not belong to the selected session' })
  }
  if (fromClassId === toClassId && fromSessionId === toSessionId) return res.status(422).json({ error: 'Source and destination are the same' })
  if (!studentIds.length) return res.status(422).json({ error: 'No students selected' })

  const toSection = toSectionId ? find('sections', toSectionId) : null
  if (toSectionId && (!toSection || toSection.classId !== toClassId)) return res.status(422).json({ error: 'Invalid destination section' })

  // capacity guard (section-level)
  if (toSection && toSection.capacity) {
    const current = list('enrolments', (e) => e.sectionId === toSectionId && !e.leftAt).length
    if (current + studentIds.length > toSection.capacity && !override) {
      return res.status(409).json({ error: 'over_capacity', capacity: toSection.capacity, current, incoming: studentIds.length })
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  let transferred = 0
  const skipped = []
  for (const sid of studentIds) {
    const cur = list('enrolments', (e) => e.studentId === sid && e.classId === fromClassId && e.academicYearId === fromSessionId && !e.leftAt)[0]
    if (!cur) { skipped.push(sid); continue }
    update('enrolments', cur.id, { leftAt: today }, req.user.id)
    insert('enrolments', { studentId: sid, academicYearId: toSessionId, classId: toClassId, sectionId: toSectionId || null, joinedAt: today, leftAt: null }, req.user.id)
    transferred += 1
  }

  audit(req, 'promote', 'enrolments', toClassId,
    { fromClassId, fromSessionId, fromClass: fromClass.name },
    { toClassId, toSessionId, toSectionId, toClass: toClass.name, transferred, studentIds })

  res.json({ transferred, skipped, from: fromClass.name, to: toClass.name })
})

export default router
