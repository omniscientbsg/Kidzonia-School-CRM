import { Router } from 'express'
import { list, find, insert, update, nextNumber, uid } from '../db.js'
import { requireAuth, requirePermission, branchWhere, parentOnly } from '../auth.js'
import { audit } from '../audit.js'
import { notifyGuardiansOfStudent } from '../notify.js'
import { crudRoutes } from './util.js'

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
    body: `₹${payment.amount.toLocaleString('en-IN')} received for ${inv.number}. Receipt ${receipt.number}.`,
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

crudRoutes(router, '/fee-structures', 'feeStructures', 'fees', { filters: ['branchId', 'programId', 'academicYearId'], auditable: true })

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
        body: `₹${refund.amount.toLocaleString('en-IN')} refunded against ${inv.number}. Reason: ${refund.reason || '—'}`,
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
      body: `${inv.number}: ₹${(inv.total - inv.paidAmount).toLocaleString('en-IN')} due by ${inv.dueDate}. Pay in the app.`,
      type: 'fees', refType: 'invoice', refId: inv.id,
    })
    sent += 1
  }
  audit(req, 'send_reminders', 'invoices', null, null, { count: sent })
  res.json({ sent })
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
