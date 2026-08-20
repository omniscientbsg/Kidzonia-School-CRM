import { Router } from 'express'
import { list, find, insert, update, nextNumber } from '../db.js'
import { requireAuth, requirePermission, branchWhere } from '../auth.js'
import { audit } from '../audit.js'
import { notifyGuardiansOfStudent } from '../notify.js'
import { resolveStudentContext } from '../fees/context.js'
import { generateStudentCycles, monthsInRange } from '../fees/generate.js'
import { fmtPaise } from '../fees/money.js'
import { localToday, DEFAULT_TZ } from '../tasks/time.js'

const router = Router()
router.use(requireAuth)
// The school's day, not UTC's — see daily.routes.js.
const todayStr = () => localToday(DEFAULT_TZ)

const studentName = (s) => `${s.firstName} ${s.lastName}`
const headNameFn = (branchId) => { const m = Object.fromEntries(list('feeHeads', { branchId }).map((h) => [h.id, h.name])); return (id) => m[id] || id }

// students enrolled in the given classes for the session
function studentsInClasses(sessionId, classIds) {
  const set = new Set(classIds)
  const ids = [...new Set(list('enrolments', (e) => e.academicYearId === sessionId && set.has(e.classId) && !e.leftAt).map((e) => e.studentId))]
  return ids.map((id) => find('students', id)).filter(Boolean)
}

// a cycle key is already generated (estimated/approved) or already invoiced?
function alreadyExists(sessionId, studentId, cycleKey) {
  if (list('feeCycles', (c) => c.academicYearId === sessionId && c.studentId === studentId && c.cycleKey === cycleKey && c.status !== 'cancelled')[0]) return true
  if (list('invoices', (i) => i.academicYearId === sessionId && i.studentId === studentId && i.cycleKey === cycleKey && i.status !== 'cancelled')[0]) return true
  return false
}

function buildDrafts(req, sessionId, classIds, startMonth, endMonth) {
  const session = find('academicYears', sessionId)
  if (!session) return { error: 'Session not found' }
  if (req.scope.branchId && session.branchId !== req.scope.branchId) return { error: 'Not found' }
  if (!startMonth || !endMonth || startMonth > endMonth) return { error: 'Invalid month range' }
  const range = monthsInRange(startMonth, endMonth)
  const settings = list('feeSettings', (s) => s.academicYearId === sessionId && s.branchId === session.branchId)[0] || null
  const headName = headNameFn(session.branchId)
  const students = studentsInClasses(sessionId, classIds)
  const out = []
  for (const student of students) {
    const sc = resolveStudentContext(student, sessionId)
    const drafts = generateStudentCycles({ student, session, range, sc, settings, headName })
    out.push({ student, drafts })
  }
  return { session, students, perStudent: out }
}

// ---- Generation ----
router.post('/fee-generation/preview', requirePermission('fees', 'view'), (req, res) => {
  const { sessionId, classIds = [], startMonth, endMonth } = req.body || {}
  const built = buildDrafts(req, sessionId, classIds, startMonth, endMonth)
  if (built.error) return res.status(422).json({ error: built.error })
  let willCreate = 0, duplicates = 0, studentsWithNew = 0
  const perStudent = built.perStudent.map(({ student, drafts }) => {
    let create = 0, skip = 0
    for (const d of drafts) (alreadyExists(sessionId, student.id, d.cycleKey) ? (duplicates++, skip++) : (willCreate++, create++))
    if (create > 0) studentsWithNew++
    return { studentId: student.id, name: studentName(student), create, skip }
  })
  res.json({ students: built.students.length, studentsWithNew, willCreate, duplicates, months: monthsInRange(startMonth, endMonth).length, perStudent })
})

router.post('/fee-generation/commit', requirePermission('fees', 'edit'), (req, res) => {
  const { sessionId, classIds = [], startMonth, endMonth } = req.body || {}
  const built = buildDrafts(req, sessionId, classIds, startMonth, endMonth)
  if (built.error) return res.status(422).json({ error: built.error })
  let created = 0, skipped = 0
  for (const { student, drafts } of built.perStudent) {
    for (const d of drafts) {
      if (alreadyExists(sessionId, student.id, d.cycleKey)) { skipped++; continue }
      insert('feeCycles', d, req.user.id)
      created++
    }
  }
  audit(req, 'generate', 'feeCycles', sessionId, { classIds, startMonth, endMonth }, { created, skipped })
  res.json({ created, skipped })
})

// ---- Estimated cycles + approval ----
router.get('/fee-cycles', requirePermission('fees', 'view'), (req, res) => {
  let rows = list('feeCycles', branchWhere(req))
  for (const k of ['academicYearId', 'classId', 'studentId', 'status']) if (req.query[k]) rows = rows.filter((c) => c[k] === req.query[k])
  const withName = rows.map((c) => { const s = find('students', c.studentId); return { ...c, studentName: s ? studentName(s) : c.studentId } })
  res.json(withName.sort((a, b) => (a.cycleKey || '').localeCompare(b.cycleKey || '')))
})

router.post('/fee-cycles/approve', requirePermission('fees', 'edit'), (req, res) => {
  const { cycleIds = [] } = req.body || {}
  const approved = []
  const skipped = []
  for (const id of cycleIds) {
    const cyc = find('feeCycles', id)
    if (!cyc) { skipped.push({ id, reason: 'not found' }); continue }
    if (req.scope.branchId && cyc.branchId !== req.scope.branchId) { skipped.push({ id, reason: 'not found' }); continue }
    if (cyc.status !== 'estimated') { skipped.push({ id, reason: `already ${cyc.status}` }); continue } // guardrail: no double-approve
    const branch = find('branches', cyc.branchId)
    const seq = nextNumber(`invoice-${branch?.code || 'XX'}`)
    const invoice = insert('invoices', {
      branchId: cyc.branchId, academicYearId: cyc.academicYearId, studentId: cyc.studentId, cycleKey: cyc.cycleKey,
      number: `INV-${branch?.code || 'XX'}-${String(seq).padStart(4, '0')}`,
      dueDate: cyc.dueDate,
      lines: cyc.lines.map((l) => ({ feeHeadId: l.feeHeadId, description: l.description, amount: l.amount })),
      discountTotal: cyc.discountTotal, total: cyc.total, paidAmount: 0, status: 'pending',
    }, req.user.id)
    const prevBal = list('ledgerEntries', { studentId: cyc.studentId }).at(-1)?.balanceAfter || 0
    insert('ledgerEntries', { branchId: cyc.branchId, studentId: cyc.studentId, type: 'charge', refId: invoice.id, amount: cyc.total, balanceAfter: prevBal + cyc.total }, req.user.id)
    update('feeCycles', cyc.id, { status: 'approved', invoiceId: invoice.id }, req.user.id)
    audit(req, 'approve', 'feeCycles', cyc.id, { status: 'estimated' }, { status: 'approved', invoiceId: invoice.id, number: invoice.number })
    notifyGuardiansOfStudent(cyc.studentId, { title: 'New invoice', body: `${invoice.number} for ${cyc.cycleLabel} is ready.`, type: 'fees', refType: 'invoice', refId: invoice.id })
    approved.push({ id: cyc.id, invoiceId: invoice.id, number: invoice.number })
  }
  res.json({ approved, skipped })
})

router.post('/fee-cycles/cancel', requirePermission('fees', 'edit'), (req, res) => {
  const { cycleIds = [], reason = '' } = req.body || {}
  const cancelled = []
  const blocked = []
  for (const id of cycleIds) {
    const cyc = find('feeCycles', id)
    if (!cyc) { blocked.push({ id, reason: 'not found' }); continue }
    if (req.scope.branchId && cyc.branchId !== req.scope.branchId) { blocked.push({ id, reason: 'not found' }); continue }
    if (cyc.status === 'cancelled') { blocked.push({ id, reason: 'already cancelled' }); continue }
    if (cyc.status === 'approved') {
      const inv = find('invoices', cyc.invoiceId)
      if (inv && inv.paidAmount > 0) { blocked.push({ id, reason: 'invoice has payments — refund first' }); continue } // guardrail
      if (inv) {
        update('invoices', inv.id, { status: 'cancelled' }, req.user.id)
        const prevBal = list('ledgerEntries', { studentId: cyc.studentId }).at(-1)?.balanceAfter || 0
        insert('ledgerEntries', { branchId: cyc.branchId, studentId: cyc.studentId, type: 'adjustment', refId: inv.id, amount: -inv.total, balanceAfter: prevBal - inv.total, note: 'Invoice cancelled' }, req.user.id)
      }
    }
    update('feeCycles', cyc.id, { status: 'cancelled', cancelReason: reason }, req.user.id)
    audit(req, 'cancel', 'feeCycles', cyc.id, { status: cyc.status }, { status: 'cancelled', reason })
    cancelled.push({ id: cyc.id })
  }
  res.json({ cancelled, blocked })
})

// ============================================================================
// Ad-hoc fees — one-off charges targeted at a class / group / picked students.
// Each targeted student gets a real invoice that flows into Invoices & Dues,
// Collect, ledger and reports.
// ============================================================================
function audienceStudents(audience, sessionId) {
  const set = new Set()
  const add = (id) => id && set.add(id)
  if (audience?.type === 'students') (audience.ids || []).forEach(add)
  else if (audience?.type === 'class') list('enrolments', (e) => (audience.ids || []).includes(e.classId) && e.academicYearId === sessionId && !e.leftAt).forEach((e) => add(e.studentId))
  else if (audience?.type === 'group') {
    for (const gid of audience.ids || []) {
      const g = find('groups', gid); if (!g) continue
      ;(g.memberIds || []).forEach(add)
      for (const cid of g.classIds || []) list('enrolments', (e) => e.classId === cid && e.academicYearId === sessionId && !e.leftAt).forEach((e) => add(e.studentId))
    }
  }
  return [...set].map((id) => find('students', id)).filter(Boolean)
}

function createAdhocInvoice(student, adhoc, userId) {
  const branch = find('branches', student.branchId)
  const seq = nextNumber(`invoice-${branch?.code || 'XX'}`)
  const inv = insert('invoices', {
    branchId: student.branchId, academicYearId: adhoc.academicYearId, studentId: student.id, adhocFeeId: adhoc.id, cycleKey: null,
    number: `INV-${branch?.code || 'XX'}-${String(seq).padStart(4, '0')}`, dueDate: adhoc.dueDate,
    lines: [{ feeHeadId: null, description: adhoc.title, amount: adhoc.amount }],
    discountTotal: 0, total: adhoc.amount, paidAmount: 0, status: adhoc.dueDate < todayStr() ? 'overdue' : 'pending',
  }, userId)
  const prevBal = list('ledgerEntries', { studentId: student.id }).at(-1)?.balanceAfter || 0
  insert('ledgerEntries', { branchId: student.branchId, studentId: student.id, type: 'charge', refId: inv.id, amount: adhoc.amount, balanceAfter: prevBal + adhoc.amount }, userId)
  return inv
}

const adhocInvoices = (adhocId) => list('invoices', (i) => i.adhocFeeId === adhocId)
function adhocSummary(a) {
  const invs = adhocInvoices(a.id).filter((i) => i.status !== 'cancelled')
  const paid = invs.filter((i) => i.paidAmount >= i.total).length
  return {
    ...a, targeted: invs.length, paidCount: paid, pendingCount: invs.length - paid,
    collected: invs.reduce((s, i) => s + i.paidAmount, 0), outstanding: invs.reduce((s, i) => s + (i.total - i.paidAmount), 0),
  }
}

router.get('/adhoc-fees', requirePermission('fees', 'view'), (req, res) => {
  let rows = list('adhocFees', branchWhere(req))
  if (req.query.sessionId) rows = rows.filter((a) => a.academicYearId === req.query.sessionId)
  if (req.query.status) rows = rows.filter((a) => a.status === req.query.status)
  if (req.query.from) rows = rows.filter((a) => (a.dueDate || '') >= req.query.from)
  if (req.query.to) rows = rows.filter((a) => (a.dueDate || '') <= req.query.to)
  if (req.query.q) rows = rows.filter((a) => a.title.toLowerCase().includes(req.query.q.toLowerCase()))
  res.json(rows.map(adhocSummary).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
})

router.get('/adhoc-fees/:id', requirePermission('fees', 'view'), (req, res) => {
  const a = find('adhocFees', req.params.id)
  if (!a) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && a.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const students = adhocInvoices(a.id).map((inv) => {
    const s = find('students', inv.studentId)
    return { invoiceId: inv.id, invoiceNumber: inv.number, studentId: inv.studentId, studentName: s ? `${s.firstName} ${s.lastName}` : inv.studentId, amount: inv.total, paid: inv.paidAmount, status: inv.status }
  })
  res.json({ ...adhocSummary(a), students })
})

router.post('/adhoc-fees', requirePermission('fees', 'edit'), (req, res) => {
  const { sessionId, title, description = '', amount, dueDate, audience } = req.body || {}
  const session = find('academicYears', sessionId)
  if (!session) return res.status(422).json({ error: 'sessionId required' })
  if (req.scope.branchId && session.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  if (!title || !title.trim()) return res.status(422).json({ error: 'Title is required' })
  if (!(amount > 0)) return res.status(422).json({ error: 'Amount must be positive' })
  if (!dueDate) return res.status(422).json({ error: 'Due date is required' })
  const students = audienceStudents(audience, sessionId).filter((s) => s.branchId === session.branchId)
  if (students.length === 0) return res.status(422).json({ error: 'No students in the selected audience' })

  const adhoc = insert('adhocFees', { branchId: session.branchId, academicYearId: sessionId, title: title.trim(), description, amount, dueDate, audience, status: 'active' }, req.user.id)
  for (const student of students) {
    const inv = createAdhocInvoice(student, adhoc, req.user.id)
    notifyGuardiansOfStudent(student.id, { title: 'New fee', body: `${adhoc.title} — ${fmtPaise(adhoc.amount)} due ${adhoc.dueDate}. Invoice ${inv.number}.`, type: 'fees', refType: 'invoice', refId: inv.id })
  }
  audit(req, 'create', 'adhocFees', adhoc.id, null, { title, amount, students: students.length })
  res.status(201).json({ adhocFee: adhocSummary(find('adhocFees', adhoc.id)), invoicesCreated: students.length })
})

router.post('/adhoc-fees/:id/cancel', requirePermission('fees', 'edit'), (req, res) => {
  const a = find('adhocFees', req.params.id)
  if (!a) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && a.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  let cancelledInvoices = 0, keptPaid = 0
  for (const inv of adhocInvoices(a.id)) {
    if (inv.status === 'cancelled') continue
    if (inv.paidAmount > 0) { keptPaid++; continue } // keep collected ones
    update('invoices', inv.id, { status: 'cancelled' }, req.user.id)
    const prevBal = list('ledgerEntries', { studentId: inv.studentId }).at(-1)?.balanceAfter || 0
    insert('ledgerEntries', { branchId: inv.branchId, studentId: inv.studentId, type: 'adjustment', refId: inv.id, amount: -inv.total, balanceAfter: prevBal - inv.total, note: 'Ad-hoc cancelled' }, req.user.id)
    cancelledInvoices++
  }
  const row = update('adhocFees', a.id, { status: 'cancelled', cancelReason: req.body.reason || '' }, req.user.id)
  audit(req, 'cancel', 'adhocFees', a.id, { status: a.status }, { status: 'cancelled', cancelledInvoices, keptPaid })
  res.json({ ...adhocSummary(row), cancelledInvoices, keptPaid })
})

router.post('/adhoc-fees/:id/remind', requirePermission('fees', 'edit'), (req, res) => {
  const a = find('adhocFees', req.params.id)
  if (!a) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && a.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const now = new Date().toISOString()
  let sent = 0
  for (const inv of adhocInvoices(a.id)) {
    if (!['pending', 'partial', 'overdue'].includes(inv.status)) continue
    notifyGuardiansOfStudent(inv.studentId, { title: 'Fee reminder', body: `${a.title}: ${fmtPaise(inv.total - inv.paidAmount)} due by ${inv.dueDate}.`, type: 'fees', refType: 'invoice', refId: inv.id })
    update('invoices', inv.id, { lastReminderAt: now, reminderCount: (inv.reminderCount || 0) + 1 }, req.user.id)
    sent++
  }
  audit(req, 'remind', 'adhocFees', a.id, null, { sent })
  res.json({ sent })
})

export default router
