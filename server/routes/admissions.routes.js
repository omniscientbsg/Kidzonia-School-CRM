import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { list, find, insert, update, nextNumber } from '../db.js'
import { requireAuth, requirePermission, branchWhere, staffOnly } from '../auth.js'
import { audit } from '../audit.js'
import { notifyUsers } from '../notify.js'
import { crudRoutes } from './util.js'

const router = Router()
router.use(requireAuth, staffOnly)

const APP_STATUSES = ['draft', 'submitted', 'waitlisted', 'offered', 'confirmed', 'rejected']

router.get('/waitlist', requirePermission('admissions', 'view'), (req, res) => {
  res.json(list('applications', branchWhere(req, { status: 'waitlisted' })))
})

crudRoutes(router, '/applications', 'applications', 'admissions', {
  filters: ['status', 'programId', 'leadId'],
  auditable: true,
  prepare: (body, req) => ({
    status: 'submitted',
    guardiansDraft: [],
    siblingStudentIds: [],
    decisions: body.decisions || [{ status: body.status || 'submitted', byId: req.user.id, at: new Date().toISOString(), note: 'Application created' }],
    ...body,
  }),
})

router.post('/applications/:id/status', requirePermission('admissions', 'edit'), (req, res) => {
  const app = find('applications', req.params.id)
  if (!app) return res.status(404).json({ error: 'Not found' })
  const { status, note } = req.body
  if (!APP_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' })
  if (status === 'confirmed') return res.status(400).json({ error: 'Use /applications/:id/confirm' })
  const before = { ...app }
  const decisions = [...(app.decisions || []), { status, byId: req.user.id, at: new Date().toISOString(), note: note || '' }]
  const row = update('applications', app.id, { status, decisions }, req.user.id)
  audit(req, 'status_change', 'applications', app.id, before, row)
  res.json(row)
})

router.get('/applications/:id/documents', requirePermission('admissions', 'view'), (req, res) => {
  res.json(list('applicationDocuments', { applicationId: req.params.id }))
})
router.post('/applications/:id/documents', requirePermission('admissions', 'create'), (req, res) => {
  const app = find('applications', req.params.id)
  if (!app) return res.status(404).json({ error: 'Not found' })
  const row = insert('applicationDocuments', { applicationId: app.id, type: req.body.type, status: req.body.status || 'pending', mediaId: req.body.mediaId || null }, req.user.id)
  res.status(201).json(row)
})
router.put('/application-documents/:id', requirePermission('admissions', 'edit'), (req, res) => {
  const row = update('applicationDocuments', req.params.id, req.body, req.user.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

function splitName(full) {
  const parts = (full || '').trim().split(/\s+/)
  return { firstName: parts[0] || 'Child', lastName: parts.slice(1).join(' ') || '' }
}

// pro-rata: remaining days in the current month / days in month
function proRataFactor(from = new Date()) {
  const daysInMonth = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate()
  const remaining = daysInMonth - from.getDate() + 1
  return remaining / daysInMonth
}

router.post('/applications/:id/confirm', requirePermission('admissions', 'edit'), (req, res) => {
  const app = find('applications', req.params.id)
  if (!app) return res.status(404).json({ error: 'Not found' })
  if (app.status === 'confirmed') return res.status(409).json({ error: 'Already confirmed' })
  const { sectionId, feeStructureId } = req.body
  const section = find('sections', sectionId)
  const structure = find('feeStructures', feeStructureId)
  if (!section || !structure) return res.status(400).json({ error: 'sectionId and feeStructureId required' })
  const cls = find('classes', section.classId)
  const branch = find('branches', app.branchId)
  const year = list('academicYears', { branchId: app.branchId, active: true })[0]

  const enrolled = list('enrolments', { sectionId }).filter((e) => !e.leftAt).length
  if (enrolled >= section.capacity) {
    const decisions = [...(app.decisions || []), { status: 'waitlisted', byId: req.user.id, at: new Date().toISOString(), note: `Section ${cls.name}-${section.name} at capacity` }]
    const row = update('applications', app.id, { status: 'waitlisted', decisions }, req.user.id)
    return res.status(409).json({ error: 'Section at capacity — application waitlisted', application: row })
  }

  const nameParts = splitName(app.childName)
  const family = insert('families', { branchId: app.branchId, name: `${nameParts.lastName || nameParts.firstName} Family`, address: '' }, req.user.id)

  const guardianRecords = []
  const createdLogins = []
  for (const g of app.guardiansDraft || []) {
    let user = g.email ? list('users', { email: g.email.toLowerCase().trim() })[0] : null
    let guardian
    if (user && user.role === 'parent' && user.guardianId) {
      guardian = find('guardians', user.guardianId) // sibling admission — reuse login
    } else {
      guardian = insert('guardians', {
        familyId: family.id, name: g.name, relationship: g.relationship || 'guardian',
        phone: g.phone || '', email: g.email || '', userId: null,
        notificationPrefs: { inApp: true, push: true, sms: false, whatsapp: true, email: true },
      }, req.user.id)
      user = insert('users', {
        name: g.name,
        email: (g.email || `${guardian.id}@kidzonia.local`).toLowerCase().trim(),
        phone: g.phone || null,
        passwordHash: bcrypt.hashSync('password', 10), // temp password, forced comms via welcome note
        role: 'parent', branchId: null, guardianId: guardian.id, active: true,
      }, req.user.id)
      update('guardians', guardian.id, { userId: user.id }, req.user.id)
      guardian.userId = user.id
      createdLogins.push({ email: user.email, tempPassword: 'password' })
    }
    guardianRecords.push(guardian)
  }

  const rollNo = list('enrolments', { sectionId }).length + 1
  const student = insert('students', {
    branchId: app.branchId, familyId: family.id, applicationId: app.id,
    firstName: nameParts.firstName, lastName: nameParts.lastName,
    dob: app.childDob, gender: app.gender || null, photoId: null,
    bloodGroup: '', allergies: '', medicalNotes: '',
    emergencyContacts: (app.guardiansDraft || []).map((g) => ({ name: g.name, phone: g.phone })),
    authorisedPickups: (app.guardiansDraft || []).map((g) => ({ name: g.name, relation: g.relationship || 'guardian' })),
    rollNo, status: 'active',
  }, req.user.id)

  for (const guardian of guardianRecords) {
    insert('guardianStudentLinks', { guardianId: guardian.id, studentId: student.id, relationship: guardian.relationship, isPrimary: guardian === guardianRecords[0] }, req.user.id)
    insert('consents', { guardianId: guardian.id, studentId: student.id, type: 'media_share', granted: true }, req.user.id)
  }

  insert('enrolments', {
    studentId: student.id, academicYearId: year?.id || null, classId: cls.id, sectionId,
    joinedAt: new Date().toISOString().slice(0, 10), leftAt: null,
  }, req.user.id)

  // first invoice: one-time heads in full + first month of monthly heads pro-rata
  const factor = proRataFactor()
  const monthLabel = new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' })
  const lines = []
  for (const l of structure.lines) {
    const head = find('feeHeads', l.feeHeadId)
    if (l.cycle === 'one_time' || l.cycle === 'annual') {
      lines.push({ feeHeadId: l.feeHeadId, description: `${head?.name || 'Fee'}${l.cycle === 'annual' ? ' (annual)' : ''}`, amount: l.amount })
    } else if (l.cycle === 'monthly') {
      lines.push({ feeHeadId: l.feeHeadId, description: `${head?.name || 'Fee'} – ${monthLabel} (pro-rata)`, amount: Math.round(l.amount * factor) })
    }
  }
  const total = lines.reduce((s, l) => s + l.amount, 0)
  const seq = nextNumber(`invoice-${branch.code}`)
  const invoice = insert('invoices', {
    branchId: app.branchId, studentId: student.id,
    number: `INV-${branch.code}-${String(seq).padStart(4, '0')}`,
    dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    lines, discountTotal: 0, total, paidAmount: 0, status: 'pending',
  }, req.user.id)
  const prevBalance = list('ledgerEntries', { studentId: student.id }).at(-1)?.balanceAfter || 0
  insert('ledgerEntries', { branchId: app.branchId, studentId: student.id, type: 'charge', refId: invoice.id, amount: total, balanceAfter: prevBalance + total }, req.user.id)

  const decisions = [...(app.decisions || []), { status: 'confirmed', byId: req.user.id, at: new Date().toISOString(), note: `Enrolled in ${cls.name}-${section.name}` }]
  const before = { ...app }
  const confirmed = update('applications', app.id, { status: 'confirmed', decisions, studentId: student.id }, req.user.id)
  audit(req, 'confirm', 'applications', app.id, before, confirmed)
  if (app.leadId) {
    const lead = find('leads', app.leadId)
    if (lead) update('leads', lead.id, { convertedStudentId: student.id }, req.user.id)
  }

  notifyUsers(guardianRecords.map((g) => g.userId), {
    title: 'Welcome to Kidzonia!',
    body: `${student.firstName}'s admission to ${cls.name}-${section.name} is confirmed. Your first invoice ${invoice.number} is ready in the app.`,
    type: 'admissions', refType: 'invoice', refId: invoice.id,
  })

  res.status(201).json({ application: confirmed, student, guardians: guardianRecords, createdLogins, invoice })
})

export default router
