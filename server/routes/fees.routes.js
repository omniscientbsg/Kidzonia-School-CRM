import { Router } from 'express'
import { list, find, insert, update, nextNumber, uid } from '../db.js'
import { requireAuth, requirePermission, branchWhere, parentOnly } from '../auth.js'
import { audit } from '../audit.js'
import { notifyGuardiansOfStudent } from '../notify.js'
import { crudRoutes } from './util.js'
import { fmtPaise } from '../fees/money.js'

const router = Router()

const today = () => new Date().toISOString().slice(0, 10)

function invoiceStatus(inv) {
  if (inv.status === 'cancelled') return 'cancelled'
  if (inv.paidAmount >= inv.total) return 'paid'
  if (inv.paidAmount > 0) return 'partial'
  return inv.dueDate < today() ? 'overdue' : 'pending'
}

function refreshInvoice(inv, userId) {
  const status = invoiceStatus(inv)
  if (status !== inv.status) return update('invoices', inv.id, { status }, userId)
  return inv
}

function studentName(id) {
  const s = find('students', id)
  return s ? `${s.firstName} ${s.lastName}`.trim() : 'Unknown'
}

function ledgerBalance(studentId) {
  return list('ledgerEntries', { studentId }).at(-1)?.balanceAfter || 0
}

function addLedger(inv, type, refId, amount, userId) {
  const bal = ledgerBalance(inv.studentId)
  return insert('ledgerEntries', {
    branchId: inv.branchId, studentId: inv.studentId, type, refId, amount, balanceAfter: bal + amount,
  }, userId)
}

// success settlement — idempotent, shared by webhook / offline / mock gateway
function settleSuccess(payment, userId) {
  if (payment.status === 'success') {
    const receipt = list('receipts', { paymentId: payment.id })[0]
    return { payment, receipt, alreadySettled: true }
  }
  const inv = find('invoices', payment.invoiceId)
  const branch = find('branches', inv.branchId)
  update('payments', payment.id, { status: 'success' }, userId)
  const seq = nextNumber(`receipt-${branch.code}`)
  const receipt = insert('receipts', { paymentId: payment.id, number: `RCP-${branch.code}-${String(seq).padStart(4, '0')}` }, userId)
  const updatedInv = update('invoices', inv.id, { paidAmount: inv.paidAmount + payment.amount }, userId)
  refreshInvoice(updatedInv, userId)
  addLedger(inv, 'payment', payment.id, -payment.amount, userId)
  notifyGuardiansOfStudent(inv.studentId, {
    title: 'Payment received',
    body: `${fmtPaise(payment.amount)} received for ${inv.number}. Receipt ${receipt.number}.`,
    type: 'fees', refType: 'receipt', refId: receipt.id,
  })
  return { payment: find('payments', payment.id), receipt, alreadySettled: false }
}

// ---------- open webhook (gateway → server, no JWT) ----------
// separate router: must be mounted BEFORE any router.use(requireAuth)
export const webhookRouter = Router()
webhookRouter.post('/payments/webhook', (req, res) => {
  const { gatewayRef, status } = req.body || {}
  if (!gatewayRef) return res.status(400).json({ error: 'gatewayRef required' })
  const payment = list('payments', { gatewayRef })[0]
  if (!payment) return res.status(404).json({ error: 'Unknown gatewayRef' })
  if (status === 'success') {
    const result = settleSuccess(payment, null)
    return res.json({ ok: true, alreadySettled: result.alreadySettled, receipt: result.receipt?.number })
  }
  if (payment.status === 'initiated') update('payments', payment.id, { status: 'failed' }, null)
  res.json({ ok: true, status: 'failed' })
})

router.use(requireAuth)

crudRoutes(router, '/fee-structures', 'feeStructures', 'fees', { filters: ['branchId', 'programId', 'academicYearId', 'classId'], auditable: true })

// ---------- invoices ----------
router.post('/invoices/generate', requirePermission('fees', 'create'), (req, res) => {
  const { studentId, feeStructureId, months = [] } = req.body
  const student = find('students', studentId)
  const structure = find('feeStructures', feeStructureId)
  if (!student || !structure) return res.status(400).json({ error: 'studentId and feeStructureId required' })
  const branch = find('branches', student.branchId)
  const enr = list('enrolments', { studentId }).find((e) => !e.leftAt)
  const created = []
  for (const month of months) {
    // month: 'YYYY-MM' — pro-rata when the student joined mid-way through it
    const [y, m] = month.split('-').map(Number)
    const daysInMonth = new Date(y, m, 0).getDate()
    let factor = 1
    if (enr?.joinedAt?.startsWith(month)) {
      const joinedDay = Number(enr.joinedAt.slice(8, 10))
      factor = (daysInMonth - joinedDay + 1) / daysInMonth
    }
    const label = new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' })
    const lines = structure.lines
      .filter((l) => l.cycle === 'monthly')
      .map((l) => ({
        feeHeadId: l.feeHeadId,
        description: `${find('feeHeads', l.feeHeadId)?.name || 'Fee'} – ${label}${factor < 1 ? ' (pro-rata)' : ''}`,
        amount: Math.round(l.amount * factor),
      }))
    if (!lines.length) continue
    const total = lines.reduce((s, l) => s + l.amount, 0)
    const seq = nextNumber(`invoice-${branch.code}`)
    const inv = insert('invoices', {
      branchId: student.branchId, studentId,
      number: `INV-${branch.code}-${String(seq).padStart(4, '0')}`,
      dueDate: `${month}-10`, lines, discountTotal: 0, total, paidAmount: 0,
      status: `${month}-10` < today() ? 'overdue' : 'pending',
    }, req.user.id)
    addLedger(inv, 'charge', inv.id, total, req.user.id)
    audit(req, 'generate', 'invoices', inv.id, null, inv)
    created.push(inv)
  }
  res.status(201).json(created)
})

router.get('/invoices', requirePermission('fees', 'view'), (req, res) => {
  let where = {}
  for (const f of ['studentId', 'status']) if (req.query[f]) where[f] = req.query[f]
  const rows = list('invoices', branchWhere(req, where.studentId ? { studentId: where.studentId } : {}))
    .map((inv) => refreshInvoice(inv, req.user.id))
    .filter((inv) => !where.status || inv.status === where.status)
    .map((inv) => ({ ...inv, studentName: studentName(inv.studentId), payments: list('payments', { invoiceId: inv.id }) }))
  res.json(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
})

router.get('/invoices/:id', requirePermission('fees', 'view'), (req, res) => {
  const inv = find('invoices', req.params.id)
  if (!inv) return res.status(404).json({ error: 'Not found' })
  const payments = list('payments', { invoiceId: inv.id }).map((p) => ({
    ...p, receipt: list('receipts', { paymentId: p.id })[0] || null,
  }))
  const discounts = list('discounts', { invoiceId: inv.id })
  res.json({ ...refreshInvoice(inv, req.user.id), studentName: studentName(inv.studentId), payments, discounts })
})

router.post('/invoices/:id/cancel', requirePermission('fees', 'edit'), (req, res) => {
  const inv = find('invoices', req.params.id)
  if (!inv) return res.status(404).json({ error: 'Not found' })
  if (inv.paidAmount > 0) return res.status(400).json({ error: 'Cannot cancel an invoice with payments' })
  const before = { ...inv }
  const row = update('invoices', inv.id, { status: 'cancelled' }, req.user.id)
  addLedger(inv, 'adjustment', inv.id, -inv.total, req.user.id)
  audit(req, 'cancel', 'invoices', inv.id, before, row)
  res.json(row)
})

// ---------- discounts ----------
crudRoutes(router, '/discounts', 'discounts', 'fees', {
  filters: ['studentId', 'status', 'invoiceId'],
  auditable: true,
  prepare: (body) => ({ status: 'pending', approvedBy: null, invoiceId: null, ...body }),
})

router.post('/discounts/:id/decide', requirePermission('fees', 'edit'), (req, res) => {
  const disc = find('discounts', req.params.id)
  if (!disc) return res.status(404).json({ error: 'Not found' })
  if (disc.status !== 'pending') return res.status(409).json({ error: 'Already decided' })
  const { status } = req.body
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved|rejected' })
  const before = { ...disc }
  const row = update('discounts', disc.id, { status, approvedBy: req.user.id }, req.user.id)
  if (status === 'approved' && disc.invoiceId) {
    const inv = find('invoices', disc.invoiceId)
    if (inv && inv.status !== 'paid' && inv.status !== 'cancelled') {
      const discountTotal = inv.discountTotal + disc.amount
      const gross = inv.lines.reduce((s, l) => s + l.amount, 0)
      const updated = update('invoices', inv.id, { discountTotal, total: Math.max(0, gross - discountTotal) }, req.user.id)
      refreshInvoice(updated, req.user.id)
      addLedger(inv, 'adjustment', disc.id, -disc.amount, req.user.id)
    }
  }
  audit(req, `discount_${status}`, 'discounts', disc.id, before, row)
  res.json(row)
})

// ---------- payments ----------
router.post('/payments/offline', requirePermission('fees', 'create'), (req, res) => {
  const { invoiceId, amount, mode = 'cash' } = req.body
  const inv = find('invoices', invoiceId)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount must be positive' })
  const payment = insert('payments', {
    branchId: inv.branchId, invoiceId, studentId: inv.studentId, amount,
    mode: ['cash', 'cheque', 'pos'].includes(mode) ? mode : 'cash', gatewayRef: null, status: 'initiated',
  }, req.user.id)
  const result = settleSuccess(payment, req.user.id)
  audit(req, 'collect_offline', 'payments', payment.id, null, result.payment)
  res.status(201).json(result)
})

// student-level ledger entry (not tied to a single invoice, e.g. advance/credit)
function addLedgerFor(studentId, branchId, type, refId, amount, userId, note) {
  const bal = ledgerBalance(studentId)
  return insert('ledgerEntries', { branchId, studentId, type, refId, amount, balanceAfter: bal + amount, note: note || undefined }, userId)
}

// apply a completed/cleared payment across its allocations; issue a receipt; overpay -> advance
function applyCollected(payment, userId) {
  for (const a of payment.allocations || []) {
    const inv = find('invoices', a.invoiceId)
    if (!inv) continue
    const updated = update('invoices', inv.id, { paidAmount: inv.paidAmount + a.amount }, userId)
    refreshInvoice(updated, userId)
    addLedgerFor(payment.studentId, payment.branchId, 'payment', payment.id, -a.amount, userId)
  }
  const allocated = (payment.allocations || []).reduce((s, a) => s + a.amount, 0)
  const advance = payment.amount - allocated
  if (advance > 0) addLedgerFor(payment.studentId, payment.branchId, 'advance', payment.id, -advance, userId, 'Advance / credit')
  const branch = find('branches', payment.branchId)
  const seq = nextNumber(`receipt-${branch?.code || 'XX'}`)
  const receipt = insert('receipts', { paymentId: payment.id, number: `RCP-${branch?.code || 'XX'}-${String(seq).padStart(4, '0')}` }, userId)
  update('payments', payment.id, { status: 'success' }, userId)
  notifyGuardiansOfStudent(payment.studentId, {
    title: 'Payment received',
    body: `${fmtPaise(payment.amount)} received. Receipt ${receipt.number}.`,
    type: 'fees', refType: 'receipt', refId: receipt.id,
  })
  return receipt
}

const COLLECT_MODES = ['cash', 'cheque', 'neft', 'gateway', 'pos']

// Collect a payment across one or more of a student's open invoices. Cheques start
// pending_clearance (no balance/collections effect until cleared).
router.post('/payments/collect', requirePermission('fees', 'create'), (req, res) => {
  const { studentId, mode = 'cash', amount, date, reference = {}, allocations = [] } = req.body || {}
  const student = find('students', studentId)
  if (!student) return res.status(404).json({ error: 'Student not found' })
  if (req.scope.branchId && student.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  if (!COLLECT_MODES.includes(mode)) return res.status(422).json({ error: 'Invalid mode' })
  if (!(amount > 0)) return res.status(422).json({ error: 'amount must be positive' })
  let allocated = 0
  for (const a of allocations) {
    const inv = find('invoices', a.invoiceId)
    if (!inv || inv.studentId !== studentId) return res.status(422).json({ error: 'Invoice not found for student' })
    if (inv.status === 'cancelled') return res.status(422).json({ error: 'Cannot pay a cancelled invoice' })
    const bal = inv.total - inv.paidAmount
    if (!(a.amount > 0) || a.amount > bal) return res.status(422).json({ error: `Allocation for ${inv.number} exceeds its balance` })
    allocated += a.amount
  }
  if (allocated > amount) return res.status(422).json({ error: 'Allocations exceed the amount tendered' })

  const payment = insert('payments', {
    branchId: student.branchId, studentId, invoiceId: allocations.length === 1 ? allocations[0].invoiceId : null,
    amount, mode, date: date || today(), reference, allocations,
    gatewayRef: null, status: mode === 'cheque' ? 'pending_clearance' : 'success_pending',
  }, req.user.id)

  let receipt = null
  if (mode !== 'cheque') receipt = applyCollected(find('payments', payment.id), req.user.id)
  audit(req, 'collect', 'payments', payment.id, null, { mode, amount, allocations, status: mode === 'cheque' ? 'pending_clearance' : 'success' })
  res.status(201).json({ payment: find('payments', payment.id), receipt, advance: amount - allocated })
})

router.get('/payments/pending-cheques', requirePermission('fees', 'view'), (req, res) => {
  const rows = list('payments', branchWhere(req, { status: 'pending_clearance' }))
    .map((p) => ({ ...p, studentName: studentName(p.studentId) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  res.json(rows)
})

router.post('/payments/:id/clear', requirePermission('fees', 'edit'), (req, res) => {
  const payment = find('payments', req.params.id)
  if (!payment) return res.status(404).json({ error: 'Not found' })
  if (payment.status !== 'pending_clearance') return res.status(409).json({ error: `Payment is ${payment.status}, not a pending cheque` })
  const receipt = applyCollected(payment, req.user.id)
  audit(req, 'cheque_clear', 'payments', payment.id, { status: 'pending_clearance' }, { status: 'success', receipt: receipt.number })
  res.json({ payment: find('payments', payment.id), receipt })
})

router.post('/payments/:id/bounce', requirePermission('fees', 'edit'), (req, res) => {
  const payment = find('payments', req.params.id)
  if (!payment) return res.status(404).json({ error: 'Not found' })
  if (payment.status !== 'pending_clearance') return res.status(409).json({ error: 'Only pending cheques can bounce' })
  const row = update('payments', payment.id, { status: 'bounced', bounceReason: req.body.reason || '' }, req.user.id)
  audit(req, 'cheque_bounce', 'payments', payment.id, { status: 'pending_clearance' }, { status: 'bounced', reason: req.body.reason || '' })
  res.json(row)
})

function canPayInvoice(req, inv) {
  if (req.user.role === 'parent') return req.scope.studentIds.includes(inv.studentId)
  const rp = list('rolePermissions', { role: req.user.role })[0]
  return req.user.role === 'super_admin' || rp?.permissions?.fees?.create
}

router.post('/payments/initiate', (req, res) => {
  const inv = find('invoices', req.body.invoiceId)
  if (!inv) return res.status(404).json({ error: 'Invoice not found' })
  if (!canPayInvoice(req, inv)) return res.status(403).json({ error: 'Forbidden' })
  const balance = inv.total - inv.paidAmount
  const amount = Math.min(req.body.amount || balance, balance)
  if (amount <= 0) return res.status(400).json({ error: 'Invoice already settled' })
  const payment = insert('payments', {
    branchId: inv.branchId, invoiceId: inv.id, studentId: inv.studentId, amount,
    mode: 'gateway', gatewayRef: `MOCKPAY-${uid().slice(0, 8)}`, status: 'initiated',
  }, req.user.id)
  // a real gateway would return a checkout URL here; the mock UI completes it in-app
  res.status(201).json({ paymentId: payment.id, gatewayRef: payment.gatewayRef, amount, gateway: 'mockpay' })
})

// simulates the user finishing checkout on the gateway page
router.post('/payments/mock-gateway/complete', (req, res) => {
  const { gatewayRef, outcome = 'success' } = req.body
  const payment = list('payments', { gatewayRef })[0]
  if (!payment) return res.status(404).json({ error: 'Unknown gatewayRef' })
  const inv = find('invoices', payment.invoiceId)
  if (!canPayInvoice(req, inv)) return res.status(403).json({ error: 'Forbidden' })
  if (outcome === 'success') {
    const result = settleSuccess(payment, req.user.id)
    return res.json({ ok: true, receipt: result.receipt, payment: result.payment })
  }
  update('payments', payment.id, { status: 'failed' }, req.user.id)
  res.json({ ok: true, payment: find('payments', payment.id) })
})

// ---------- refunds ----------
crudRoutes(router, '/refunds', 'refunds', 'fees', {
  filters: ['studentId', 'status'],
  auditable: true,
  prepare: (body) => ({ status: 'pending', approvedBy: null, ...body }),
})

router.post('/refunds/:id/decide', requirePermission('fees', 'edit'), (req, res) => {
  const refund = find('refunds', req.params.id)
  if (!refund) return res.status(404).json({ error: 'Not found' })
  if (refund.status !== 'pending') return res.status(409).json({ error: 'Already decided' })
  const { status } = req.body
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved|rejected' })
  const before = { ...refund }
  const row = update('refunds', refund.id, { status, approvedBy: req.user.id }, req.user.id)
  if (status === 'approved') {
    const payment = find('payments', refund.paymentId)
    const inv = payment ? find('invoices', payment.invoiceId) : null
    if (inv) {
      const updated = update('invoices', inv.id, { paidAmount: Math.max(0, inv.paidAmount - refund.amount) }, req.user.id)
      refreshInvoice(updated, req.user.id)
      addLedger(inv, 'refund', refund.id, refund.amount, req.user.id)
      notifyGuardiansOfStudent(inv.studentId, {
        title: 'Refund processed',
        body: `${fmtPaise(refund.amount)} refunded against ${inv.number}. Reason: ${refund.reason || '—'}`,
        type: 'fees', refType: 'refund', refId: refund.id,
      })
    }
  }
  audit(req, `refund_${status}`, 'refunds', refund.id, before, row)
  res.json(row)
})

// ---------- ledger + reports ----------
router.get('/students/:id/ledger', requirePermission('fees', 'view'), (req, res) => {
  res.json(list('ledgerEntries', { studentId: req.params.id }))
})

router.get('/fees/reports/daybook', requirePermission('fees', 'view'), (req, res) => {
  const date = req.query.date || today()
  const rows = list('payments', branchWhere(req, { status: 'success' }))
    .filter((p) => p.updatedAt.startsWith(date))
    .map((p) => ({
      ...p,
      studentName: studentName(p.studentId),
      invoiceNumber: find('invoices', p.invoiceId)?.number,
      receiptNumber: list('receipts', { paymentId: p.id })[0]?.number || null,
    }))
  res.json({ date, total: rows.reduce((s, p) => s + p.amount, 0), byMode: rows.reduce((acc, p) => ({ ...acc, [p.mode]: (acc[p.mode] || 0) + p.amount }), {}), rows })
})

router.get('/fees/reports/outstanding', requirePermission('fees', 'view'), (req, res) => {
  const invoices = list('invoices', branchWhere(req)).map((i) => refreshInvoice(i, req.user.id))
  const open = invoices.filter((i) => ['pending', 'partial', 'overdue'].includes(i.status))
  const byStudent = {}
  for (const inv of open) {
    const b = (byStudent[inv.studentId] ||= { studentId: inv.studentId, studentName: studentName(inv.studentId), due: 0, overdue: 0, invoices: 0 })
    const bal = inv.total - inv.paidAmount
    b.due += bal
    if (inv.status === 'overdue') b.overdue += bal
    b.invoices += 1
  }
  const rows = Object.values(byStudent).sort((a, b) => b.due - a.due)
  res.json({ totalDue: rows.reduce((s, r) => s + r.due, 0), totalOverdue: rows.reduce((s, r) => s + r.overdue, 0), rows })
})

router.get('/fees/reports/collections', requirePermission('fees', 'view'), (req, res) => {
  const { from = '0000', to = '9999' } = req.query
  const payments = list('payments', branchWhere(req, { status: 'success' }))
    .filter((p) => p.updatedAt.slice(0, 10) >= from && p.updatedAt.slice(0, 10) <= to)
  const byMode = {}
  const byHead = {}
  for (const p of payments) {
    byMode[p.mode] = (byMode[p.mode] || 0) + p.amount
    const inv = find('invoices', p.invoiceId)
    if (inv?.total > 0) {
      for (const line of inv.lines) {
        const head = find('feeHeads', line.feeHeadId)?.name || 'Other'
        byHead[head] = (byHead[head] || 0) + Math.round(p.amount * (line.amount / inv.total))
      }
    }
  }
  res.json({ total: payments.reduce((s, p) => s + p.amount, 0), count: payments.length, byMode, byHead })
})

router.post('/fees/send-reminders', requirePermission('fees', 'edit'), (req, res) => {
  const invoices = list('invoices', branchWhere(req)).map((i) => refreshInvoice(i, req.user.id))
    .filter((i) => ['pending', 'partial', 'overdue'].includes(i.status))
  let sent = 0
  for (const inv of invoices) {
    notifyGuardiansOfStudent(inv.studentId, {
      title: inv.status === 'overdue' ? 'Fee overdue' : 'Fee reminder',
      body: `${inv.number}: ${fmtPaise(inv.total - inv.paidAmount)} due by ${inv.dueDate}. Pay in the app.`,
      type: 'fees', refType: 'invoice', refId: inv.id,
    })
    sent += 1
  }
  audit(req, 'send_reminders', 'invoices', null, null, { count: sent })
  res.json({ sent })
})

// alias so report handlers can look up a name even when they destructure a
// `studentName` query filter (which would otherwise shadow the helper above)
function studentName2(id) { return studentName(id) }

// ---------- reports: student ledger / transactions / detailed / series ----------
const TXN_STATUS_LABEL = { success: 'Completed', pending_clearance: 'Pending clearance', failed: 'Failed', bounced: 'Bounced', initiated: 'Pending', success_pending: 'Processing' }

router.get('/fees/reports/student-ledger', requirePermission('fees', 'view'), (req, res) => {
  const student = find('students', req.query.studentId)
  if (!student) return res.status(404).json({ error: 'Student not found' })
  if (req.scope.branchId && student.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const rows = list('ledgerEntries', { studentId: student.id }).map((e) => {
    let ref = null, description = e.note || ''
    if (e.type === 'charge') { const inv = find('invoices', e.refId); ref = inv?.number; description = description || `Charge — ${ref || ''}` }
    else if (e.type === 'payment') { const p = find('payments', e.refId); const rc = p ? list('receipts', { paymentId: p.id })[0] : null; ref = rc?.number; description = description || `Payment (${p?.mode || ''})` }
    else if (e.type === 'advance') description = description || 'Advance / credit'
    else if (e.type === 'refund') description = description || 'Refund'
    else if (e.type === 'adjustment') description = description || 'Adjustment'
    else description = description || e.type
    return { date: e.createdAt, type: e.type, description, ref: ref || null, amount: e.amount, balanceAfter: e.balanceAfter }
  })
  res.json({ student: { id: student.id, name: `${student.firstName} ${student.lastName}` }, rows, closingBalance: rows.at(-1)?.balanceAfter || 0 })
})

router.get('/fees/reports/transactions', requirePermission('fees', 'view'), (req, res) => {
  const { studentName = '', mode = '', from = '0000-00-00', to = '9999-99-99', status = '', dateType = 'collection', sessionId = '' } = req.query
  const rows = list('payments', branchWhere(req)).map((p) => {
    const receipt = list('receipts', { paymentId: p.id })[0] || null
    const inv = p.invoiceId ? find('invoices', p.invoiceId) : null
    const collectionDate = (p.date || p.createdAt).slice(0, 10)
    const clearanceDate = p.status === 'success' ? p.updatedAt.slice(0, 10) : null
    return {
      id: p.id, studentName: studentName2(p.studentId), mode: p.mode, amount: p.amount, status: p.status,
      statusLabel: TXN_STATUS_LABEL[p.status] || p.status,
      collectionDate, clearanceDate, date: dateType === 'clearance' ? (clearanceDate || collectionDate) : collectionDate,
      receiptNumber: receipt?.number || null, chequeNo: p.reference?.chequeNo || null, academicYearId: inv?.academicYearId || null,
    }
  }).filter((r) => {
    if (studentName && !r.studentName.toLowerCase().includes(studentName.toLowerCase())) return false
    if (mode && r.mode !== mode) return false
    if (status && r.status !== status) return false
    if (sessionId && r.academicYearId !== sessionId) return false
    return r.date >= from && r.date <= to
  }).sort((a, b) => b.date.localeCompare(a.date))
  res.json({ rows, total: rows.reduce((s, r) => s + (r.status === 'success' ? r.amount : 0), 0), count: rows.length })
})

router.get('/fees/reports/detailed', requirePermission('fees', 'view'), (req, res) => {
  const { sessionId = '', studentName = '', classIds = '', cycle = '', status = '', showCancelled = 'false' } = req.query
  const classSet = classIds ? new Set(classIds.split(',').filter(Boolean)) : null
  const rows = []
  const nameOk = (sid) => !studentName || studentName2(sid).toLowerCase().includes(studentName.toLowerCase())
  const classOk = (sid) => { if (!classSet) return true; const c = classOfStudent(sid); return c && classSet.has(c.id) }

  // estimated cycles (not yet invoiced)
  for (const c of list('feeCycles', branchWhere(req))) {
    if (sessionId && c.academicYearId !== sessionId) continue
    if (c.status === 'approved') continue // its invoice is counted below
    if (c.status === 'cancelled' && showCancelled !== 'true') continue
    if (cycle && c.cycleKey !== cycle) continue
    if (!nameOk(c.studentId) || !classOk(c.studentId)) continue
    const st = c.status === 'cancelled' ? 'cancelled' : 'estimated'
    rows.push({ key: `c-${c.id}`, studentId: c.studentId, studentName: studentName2(c.studentId), cycle: c.cycleLabel, totalFees: c.total, paid: 0, lateFees: 0, payable: c.status === 'cancelled' ? 0 : c.total, status: st, invoiceId: null })
  }
  // invoices (approved / paid / cancelled)
  for (const inv of list('invoices', branchWhere(req)).map((i) => refreshInvoice(i, req.user.id))) {
    if (sessionId && inv.academicYearId && inv.academicYearId !== sessionId) continue
    if (inv.status === 'cancelled' && showCancelled !== 'true') continue
    const ck = inv.cycleKey || null
    if (cycle && ck !== cycle) continue
    if (!nameOk(inv.studentId) || !classOk(inv.studentId)) continue
    const lateFees = list('ledgerEntries', (e) => e.type === 'late_fee' && e.refId === inv.id).reduce((s, e) => s + e.amount, 0)
    const st = inv.status === 'cancelled' ? 'cancelled' : inv.paidAmount >= inv.total ? 'paid' : 'approved'
    rows.push({ key: `i-${inv.id}`, studentId: inv.studentId, studentName: studentName2(inv.studentId), cycle: cycleLabelOf(inv), totalFees: inv.total, paid: inv.paidAmount, lateFees, payable: inv.status === 'cancelled' ? 0 : inv.total - inv.paidAmount, status: st, invoiceId: inv.id })
  }
  const filtered = status ? rows.filter((r) => r.status === status) : rows
  filtered.sort((a, b) => a.studentName.localeCompare(b.studentName) || (a.cycle || '').localeCompare(b.cycle || ''))
  const summary = {
    recordCount: filtered.length,
    totalFees: filtered.reduce((s, r) => s + r.totalFees, 0),
    totalPaid: filtered.reduce((s, r) => s + r.paid, 0),
    totalPayable: filtered.reduce((s, r) => s + r.payable, 0),
    totalLateFees: filtered.reduce((s, r) => s + r.lateFees, 0),
  }
  res.json({ rows: filtered, summary })
})

router.get('/fees/reports/collections-series', requirePermission('fees', 'view'), (req, res) => {
  const { from = '0000-00-00', to = '9999-99-99' } = req.query
  const byDay = {}
  for (const p of list('payments', branchWhere(req, { status: 'success' }))) {
    const d = p.updatedAt.slice(0, 10)
    if (d < from || d > to) continue
    byDay[d] = (byDay[d] || 0) + p.amount
  }
  res.json({ series: Object.keys(byDay).sort().map((date) => ({ date, amount: byDay[date] })) })
})

// ---------- pending dues + reminders ----------
function cycleLabelOf(inv) {
  const key = inv.cycleKey || (inv.dueDate || '').slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(key)) return 'One-time'
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' })
}
function classOfStudent(studentId) {
  const enr = list('enrolments', (e) => e.studentId === studentId && !e.leftAt)[0]
  return enr ? find('classes', enr.classId) : null
}
const daysOverdueOf = (dueDate) => Math.max(0, Math.floor((new Date(today()) - new Date(dueDate)) / 86400000))

// cycle-wise pending list. Branch-scoped (matches Invoices & Dues Overdue / Families cards).
router.get('/fees/pending-dues', requirePermission('fees', 'view'), (req, res) => {
  const classIds = req.query.classIds ? req.query.classIds.split(',').filter(Boolean) : null
  const overdueOnly = req.query.overdueOnly === 'true'
  const minAmount = Number(req.query.minAmount) || 0
  const notRemindedDays = req.query.notRemindedDays ? Number(req.query.notRemindedDays) : null
  const nowMs = Date.now()

  const open = list('invoices', branchWhere(req)).map((i) => refreshInvoice(i, req.user.id))
    .filter((i) => ['pending', 'partial', 'overdue'].includes(i.status))

  const rows = []
  for (const inv of open) {
    const cls = classOfStudent(inv.studentId)
    if (classIds && !(cls && classIds.includes(cls.id))) continue
    if (overdueOnly && inv.status !== 'overdue') continue
    const balance = inv.total - inv.paidAmount
    if (balance < minAmount) continue
    if (notRemindedDays != null) {
      const okStale = !inv.lastReminderAt || (nowMs - new Date(inv.lastReminderAt).getTime()) / 86400000 >= notRemindedDays
      if (!okStale) continue
    }
    rows.push({
      invoiceId: inv.id, number: inv.number, studentId: inv.studentId, studentName: studentName(inv.studentId),
      classId: cls?.id || null, className: cls?.name || '—', cycleLabel: cycleLabelOf(inv), cycleKey: inv.cycleKey || null,
      dueDate: inv.dueDate, status: inv.status, balance, daysOverdue: daysOverdueOf(inv.dueDate),
      lastReminderAt: inv.lastReminderAt || null, reminderCount: inv.reminderCount || 0,
    })
  }
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance)
  const families = new Set(rows.map((r) => r.studentId))
  res.json({
    rows,
    summary: {
      invoices: rows.length, families: families.size,
      totalDue: rows.reduce((s, r) => s + r.balance, 0),
      totalOverdue: rows.filter((r) => r.status === 'overdue').reduce((s, r) => s + r.balance, 0),
    },
  })
})

// send reminders for chosen invoices via the channels configured in Settings (mocked + logged)
router.post('/fees/reminders/send', requirePermission('fees', 'edit'), (req, res) => {
  const { invoiceIds = [] } = req.body || {}
  const now = new Date().toISOString()
  let sent = 0
  const perInvoice = []
  for (const id of invoiceIds) {
    const inv = find('invoices', id)
    if (!inv) continue
    if (req.scope.branchId && inv.branchId !== req.scope.branchId) continue
    const settings = list('feeSettings', (s) => s.branchId === inv.branchId && s.academicYearId === inv.academicYearId)[0]
      || list('feeSettings', (s) => s.branchId === inv.branchId)[0]
    const channels = settings?.autoReminders?.channels || ['in_app', 'email']
    const balance = inv.total - inv.paidAmount
    notifyGuardiansOfStudent(inv.studentId, {
      title: inv.status === 'overdue' ? 'Fee overdue' : 'Fee reminder',
      body: `${inv.number}: ${fmtPaise(balance)} due by ${inv.dueDate}. Pay in the app.`,
      type: 'fees', refType: 'invoice', refId: inv.id,
    })
    update('invoices', inv.id, { lastReminderAt: now, reminderCount: (inv.reminderCount || 0) + 1 }, req.user.id)
    perInvoice.push({ invoiceId: inv.id, channels })
    sent += 1
  }
  audit(req, 'send_reminders', 'invoices', null, null, { count: sent, invoiceIds })
  res.json({ sent, perInvoice })
})

// ---------- parent ----------
router.get('/parent/invoices', parentOnly, (req, res) => {
  const rows = list('invoices', (i) => req.scope.studentIds.includes(i.studentId))
    .map((inv) => refreshInvoice(inv, req.user.id))
    .map((inv) => ({
      ...inv,
      studentName: studentName(inv.studentId),
      payments: list('payments', { invoiceId: inv.id }).map((p) => ({ ...p, receipt: list('receipts', { paymentId: p.id })[0] || null })),
    }))
  res.json(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
})

export default router
