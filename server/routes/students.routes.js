import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { list, find, insert, update } from '../db.js'
import { requireAuth, requirePermission, parentOnly } from '../auth.js'
import { audit } from '../audit.js'
import { notifyGuardiansOfStudent, notifyUsers } from '../notify.js'
import { emit } from '../capabilities/bus.js'
import taskLock from '../capabilities/taskLock.js'
import { crudRoutes } from './util.js'

const router = Router()
router.use(requireAuth)

// ---------- helpers ----------
function activeEnrolment(studentId) {
  return list('enrolments', { studentId }).find((e) => !e.leftAt) || null
}

function enrichStudent(s) {
  const enr = activeEnrolment(s.id)
  const cls = enr ? find('classes', enr.classId) : null
  const section = enr ? find('sections', enr.sectionId) : null
  return { ...s, enrolment: enr, className: cls?.name || null, sectionName: section?.name || null, sectionId: section?.id || null }
}

function attendanceSummary(studentId, month = null) {
  let rows = list('attendanceRecords', { studentId })
  if (month) rows = rows.filter((r) => r.date.startsWith(month))
  const counts = { present: 0, absent: 0, late: 0, half_day: 0, leave: 0 }
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1
  const total = rows.length
  const attended = counts.present + counts.late + counts.half_day
  return { counts, total, pct: total ? Math.round((attended / total) * 100) : null, records: rows }
}

function datesBetween(from, to) {
  const out = []
  let d = new Date(from)
  const end = new Date(to)
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d = new Date(d.getTime() + 86400000)
  }
  return out
}

// ---------- staff: students ----------
// registered before crudRoutes so the enriched list wins the GET route
router.get('/students', requirePermission('students', 'view'), (req, res) => {
  let where = {}
  for (const f of ['status', 'familyId']) if (req.query[f]) where[f] = req.query[f]
  if (req.scope.branchId) where.branchId = req.scope.branchId
  else if (req.query.branchId) where.branchId = req.query.branchId
  res.json(list('students', where).map(enrichStudent))
})

crudRoutes(router, '/students', 'students', 'students', {
  filters: ['status', 'familyId'],
  auditable: true,
})

router.get('/students/:id/full', requirePermission('students', 'view'), (req, res) => {
  const s = find('students', req.params.id)
  if (!s) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && s.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const links = list('guardianStudentLinks', { studentId: s.id })
  const guardians = links.map((l) => ({ ...find('guardians', l.guardianId), relationship: l.relationship, isPrimary: l.isPrimary }))
  res.json({
    ...enrichStudent(s),
    guardians,
    family: find('families', s.familyId),
    invoices: list('invoices', { studentId: s.id }),
    ledger: list('ledgerEntries', { studentId: s.id }),
    attendance: attendanceSummary(s.id, new Date().toISOString().slice(0, 7)),
    leaveRequests: list('leaveRequests', { studentId: s.id }),
  })
})

router.post('/students/:id/guardians', requirePermission('students', 'edit'), (req, res) => {
  const s = find('students', req.params.id)
  if (!s) return res.status(404).json({ error: 'Not found' })
  const { name, relationship, phone, email } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  let user = email ? list('users', { email: email.toLowerCase().trim() })[0] : null
  let guardian = user?.guardianId ? find('guardians', user.guardianId) : null
  if (!guardian) {
    guardian = insert('guardians', {
      familyId: s.familyId, name, relationship: relationship || 'guardian', phone: phone || '', email: email || '',
      userId: null, notificationPrefs: { inApp: true, push: true, sms: false, whatsapp: true, email: true },
    }, req.user.id)
    user = insert('users', {
      name, email: (email || `${guardian.id}@kidzonia.local`).toLowerCase().trim(), phone: phone || null,
      passwordHash: bcrypt.hashSync('password', 10), role: 'parent', branchId: null, guardianId: guardian.id, active: true,
    }, req.user.id)
    update('guardians', guardian.id, { userId: user.id }, req.user.id)
  }
  insert('guardianStudentLinks', { guardianId: guardian.id, studentId: s.id, relationship: relationship || 'guardian', isPrimary: false }, req.user.id)
  insert('consents', { guardianId: guardian.id, studentId: s.id, type: 'media_share', granted: true }, req.user.id)
  audit(req, 'add_guardian', 'students', s.id, null, { guardianId: guardian.id })
  res.status(201).json(guardian)
})

// ---------- staff: attendance ----------
router.get('/attendance', requirePermission('attendance', 'view'), (req, res) => {
  const { sectionId, date } = req.query
  if (!sectionId || !date) return res.status(400).json({ error: 'sectionId and date required' })
  const enrolments = list('enrolments', { sectionId }).filter((e) => !e.leftAt)
  const roster = enrolments.map((e) => {
    const s = find('students', e.studentId)
    const rec = list('attendanceRecords', { studentId: e.studentId, date })[0] || null
    const approvedLeave = list('leaveRequests', { studentId: e.studentId, status: 'approved' })
      .some((lr) => lr.fromDate <= date && date <= lr.toDate)
    return {
      studentId: e.studentId, name: `${s.firstName} ${s.lastName}`.trim(), rollNo: s.rollNo,
      status: rec?.status || (approvedLeave ? 'leave' : null), reason: rec?.reason || '', approvedLeave,
    }
  })
  res.json(roster.sort((a, b) => (a.rollNo || 0) - (b.rollNo || 0)))
})

router.post('/attendance', requirePermission('attendance', 'create'), (req, res) => {
  const { sectionId, date, records } = req.body
  if (!sectionId || !date || !Array.isArray(records)) return res.status(400).json({ error: 'sectionId, date, records[] required' })
  const section = find('sections', sectionId)
  const cls = section ? find('classes', section.classId) : null
  if (!cls) return res.status(400).json({ error: 'Unknown section' })

  // THE ONLY LINE THIS MODULE KNOWS ABOUT TASKS. If a completed task was
  // verified against this register, editing it needs an approved re-edit; the
  // call spends that approval if the person holds one.
  const ref = { collection: 'attendanceRecords', sectionId, date }
  const lock = taskLock.check('attendance', ref, { user: req.user })
  if (lock.locked) return res.status(423).json(lock.response)

  const saved = []
  const notified = []
  const touched = []
  for (const r of records) {
    if (!['present', 'absent', 'late', 'half_day', 'leave'].includes(r.status)) continue
    const existing = list('attendanceRecords', { studentId: r.studentId, date })[0]
    const changed = !existing || existing.status !== r.status
    let row
    if (existing) {
      row = update('attendanceRecords', existing.id, { status: r.status, reason: r.reason || '', markedBy: req.user.id }, req.user.id)
    } else {
      row = insert('attendanceRecords', {
        branchId: cls.branchId, sectionId, studentId: r.studentId, date,
        status: r.status, reason: r.reason || '', markedBy: req.user.id,
      }, req.user.id)
    }
    saved.push(row)
    if (changed) touched.push(row.id)
    if (changed && (r.status === 'absent' || r.status === 'late')) {
      const s = find('students', r.studentId)
      notifyGuardiansOfStudent(r.studentId, {
        title: r.status === 'absent' ? `${s.firstName} marked absent` : `${s.firstName} arrived late`,
        body: r.status === 'absent'
          ? `${s.firstName} ${s.lastName} was marked absent on ${date}. Please contact the school if this is unexpected.`
          : `${s.firstName} ${s.lastName} checked in late on ${date}${r.reason ? ` (${r.reason})` : ''}.`,
        type: 'attendance', refType: 'attendance', refId: row.id,
      })
      notified.push(r.studentId)
    }
  }
  // Tell anything that cares that this register moved. The task engine
  // subscribes through the capability registry; it is never imported here, and
  // a failed subscriber cannot fail the attendance write.
  const signalled = emit('attendance.marked', {
    sectionId, classId: cls.id, date, recordIds: touched, byUserId: req.user.id, ref,
    // an edit made under an approved re-edit is not silent drift
    authorised: !!lock.spentGrant,
  })
  res.json({ saved: saved.length, notified, signalled: signalled.delivered, reEdit: lock.spentGrant ? lock.grant.id : null })
})

router.get('/attendance/summary', requirePermission('attendance', 'view'), (req, res) => {
  const { studentId, month } = req.query
  if (!studentId) return res.status(400).json({ error: 'studentId required' })
  res.json(attendanceSummary(studentId, month || null))
})

// ---------- leave requests ----------
router.get('/leave-requests', requirePermission('students', 'view'), (req, res) => {
  let rows = list('leaveRequests')
  if (req.query.status) rows = rows.filter((r) => r.status === req.query.status)
  if (req.scope.branchId) rows = rows.filter((r) => find('students', r.studentId)?.branchId === req.scope.branchId)
  res.json(rows.map((r) => {
    const s = find('students', r.studentId)
    return { ...r, studentName: s ? `${s.firstName} ${s.lastName}`.trim() : 'Unknown' }
  }))
})

router.post('/leave-requests/:id/decide', requirePermission('students', 'edit'), (req, res) => {
  const lr = find('leaveRequests', req.params.id)
  if (!lr) return res.status(404).json({ error: 'Not found' })
  const { status } = req.body
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved|rejected' })
  const row = update('leaveRequests', lr.id, { status, decidedBy: req.user.id }, req.user.id)
  if (status === 'approved') {
    const enr = activeEnrolment(lr.studentId)
    const s = find('students', lr.studentId)
    for (const date of datesBetween(lr.fromDate, lr.toDate)) {
      const existing = list('attendanceRecords', { studentId: lr.studentId, date })[0]
      if (existing) update('attendanceRecords', existing.id, { status: 'leave', reason: lr.reason }, req.user.id)
      else if (enr) insert('attendanceRecords', {
        branchId: s.branchId, sectionId: enr.sectionId, studentId: lr.studentId, date,
        status: 'leave', reason: lr.reason, markedBy: req.user.id,
      }, req.user.id)
      // This is the OTHER way a register moves, and it deliberately is not
      // blocked — refusing to approve a child's leave because a task locked
      // that day would be the wrong trade. Instead it announces itself, so any
      // completed task verified against that register is re-checked and
      // flagged. An unannounced write is the only thing we cannot catch.
      if (enr) {
        emit('attendance.marked', {
          sectionId: enr.sectionId, date, byUserId: req.user.id, authorised: false,
          ref: { collection: 'attendanceRecords', sectionId: enr.sectionId, date },
        })
      }
    }
  }
  const s = find('students', lr.studentId)
  notifyGuardiansOfStudent(lr.studentId, {
    title: `Leave ${status}`,
    body: `Leave for ${s.firstName} (${lr.fromDate} → ${lr.toDate}) was ${status}.`,
    type: 'leave', refType: 'leaveRequest', refId: lr.id,
  })
  audit(req, `leave_${status}`, 'leaveRequests', lr.id, lr, row)
  res.json(row)
})

// ---------- parent endpoints ----------
router.get('/parent/children', parentOnly, (req, res) => {
  const children = (req.scope.studentIds || []).map((id) => find('students', id)).filter(Boolean).map(enrichStudent)
  res.json(children)
})

router.get('/parent/children/:id/attendance', parentOnly, (req, res) => {
  if (!req.scope.studentIds.includes(req.params.id)) return res.status(403).json({ error: 'Not your child' })
  res.json(attendanceSummary(req.params.id, req.query.month || null))
})

router.get('/parent/leave-requests', parentOnly, (req, res) => {
  const rows = list('leaveRequests', (r) => req.scope.studentIds.includes(r.studentId))
  res.json(rows)
})

router.post('/parent/leave-requests', parentOnly, (req, res) => {
  const { studentId, fromDate, toDate, reason } = req.body
  if (!req.scope.studentIds.includes(studentId)) return res.status(403).json({ error: 'Not your child' })
  if (!fromDate || !toDate || !reason) return res.status(400).json({ error: 'fromDate, toDate, reason required' })
  const row = insert('leaveRequests', { studentId, fromDate, toDate, reason, status: 'pending', decidedBy: null }, req.user.id)
  const s = find('students', studentId)
  const enr = activeEnrolment(studentId)
  const section = enr ? find('sections', enr.sectionId) : null
  const staffToNotify = [section?.teacherId, ...list('users', { role: 'branch_admin', branchId: s.branchId }).map((u) => u.id)].filter(Boolean)
  notifyUsers(staffToNotify, {
    title: 'New leave request',
    body: `${s.firstName} ${s.lastName}: ${fromDate} → ${toDate} (${reason})`,
    type: 'leave', refType: 'leaveRequest', refId: row.id,
  })
  res.status(201).json(row)
})

export default router
