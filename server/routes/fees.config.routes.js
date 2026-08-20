import { Router } from 'express'
import { list, find, insert, update, softDelete } from '../db.js'
import { requireAuth, requirePermission, branchWhere, staffOnly } from '../auth.js'
import { audit } from '../audit.js'
import { toPaise, pctOfPaise } from '../fees/money.js'
import { annualise, CYCLE_INSTALLMENTS } from '../fees/estimate.js'
import { applyDiscounts, totalsOf, CONCESSION_CATEGORIES } from '../fees/discounts.js'

const router = Router()
router.use(requireAuth)

// ============================================================================
// Fee Heads (fee components) — first-class masters with periodicity + tax/refund
// flags. Branch-scoped (reused across sessions). Config gated by the `fees` module.
// ============================================================================
export const PERIODICITIES = ['one_time', 'monthly', 'quarterly', 'half_yearly', 'annual']

// How many structures / invoices reference this head (drives delete-guard + UI).
function headUsage(headId) {
  const structures = list('feeStructures', (s) => (s.lines || []).some((l) => l.feeHeadId === headId)).length
  const invoices = list('invoices', (i) => (i.lines || []).some((l) => l.feeHeadId === headId)).length
  return { structures, invoices, total: structures + invoices }
}

const codeFrom = (name) => name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')

function validateHead(body) {
  if (!body.name || !body.name.trim()) return 'Name is required'
  if (!PERIODICITIES.includes(body.periodicity)) return 'Valid periodicity is required'
  if (body.taxable && (Number(body.gstPct) < 0 || Number(body.gstPct) > 100)) return 'GST % must be 0–100'
  return null
}

// list — any staff may read (structures/invoices/dues render head names); includes usage
router.get('/fee-heads', staffOnly, (req, res) => {
  let rows = list('feeHeads', branchWhere(req))
  if (req.query.includeInactive !== 'true') rows = rows.filter((h) => h.active !== false)
  rows = rows.sort((a, b) => a.name.localeCompare(b.name)).map((h) => ({ ...h, usage: headUsage(h.id) }))
  res.json(rows)
})

router.post('/fee-heads', requirePermission('fees', 'create'), (req, res) => {
  const err = validateHead(req.body)
  if (err) return res.status(422).json({ error: err })
  const b = req.body
  const branchId = b.branchId ?? req.scope.branchId ?? null
  const row = insert('feeHeads', {
    branchId, name: b.name.trim(), code: (b.code || codeFrom(b.name)),
    periodicity: b.periodicity, taxable: !!b.taxable, gstPct: b.taxable ? (Number(b.gstPct) || 0) : 0,
    refundable: !!b.refundable, active: true,
  }, req.user.id)
  audit(req, 'create', 'feeHeads', row.id, null, row)
  res.status(201).json(row)
})

router.put('/fee-heads/:id', requirePermission('fees', 'edit'), (req, res) => {
  const before = find('feeHeads', req.params.id)
  if (!before) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && before.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const merged = { ...before, ...req.body }
  const err = validateHead(merged)
  if (err) return res.status(422).json({ error: err })
  const patch = {}
  for (const k of ['name', 'periodicity', 'taxable', 'gstPct', 'refundable', 'active']) if (req.body[k] !== undefined) patch[k] = req.body[k]
  if (patch.name !== undefined) patch.name = String(patch.name).trim()
  if (patch.taxable === false) patch.gstPct = 0
  const row = update('feeHeads', before.id, patch, req.user.id)
  audit(req, 'update', 'feeHeads', row.id, before, row)
  res.json(row)
})

// Delete is blocked when the head is referenced anywhere — deactivate instead.
router.delete('/fee-heads/:id', requirePermission('fees', 'delete'), (req, res) => {
  const head = find('feeHeads', req.params.id)
  if (!head) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && head.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const usage = headUsage(head.id)
  if (usage.total > 0) return res.status(409).json({ error: 'in_use', usage })
  softDelete('feeHeads', head.id, req.user.id)
  audit(req, 'delete', 'feeHeads', head.id, head, null)
  res.json({ ok: true })
})

// ============================================================================
// Fee Structures (per session + class) + per-student overrides + Excel round-trip.
// Custom paths under /class-fees & /student-fees to avoid the /fee-structures/:id
// crudRoutes in fees.routes.js.
// ============================================================================
const headMap = (branchId) => Object.fromEntries(list('feeHeads', branchId ? { branchId } : null).map((h) => [h.id, h]))

function validateLines(lines, heads) {
  if (!Array.isArray(lines)) return 'lines must be an array'
  for (const l of lines) {
    if (!heads[l.feeHeadId]) return `Unknown fee head: ${l.feeHeadId}`
    if (!(Number.isInteger(l.amount) && l.amount >= 0)) return `Amount for ${heads[l.feeHeadId].name} must be a whole paise value ≥ 0`
    if (l.cycle && !(l.cycle in CYCLE_INSTALLMENTS)) return `Bad cycle: ${l.cycle}`
  }
  return null
}

// class structure for a student in a session (classId match, else legacy program match)
function classStructureFor(sessionId, classId) {
  let s = list('feeStructures', (x) => x.academicYearId === sessionId && x.classId === classId)[0]
  if (!s) { const cls = find('classes', classId); if (cls) s = list('feeStructures', (x) => x.academicYearId === sessionId && x.programId === cls.programId)[0] }
  return s || null
}

// merge class lines with a per-student override delta -> effective lines (tagged)
function effectiveLines(classLines, override) {
  const removed = new Set(override?.removedHeadIds || [])
  const ov = new Map((override?.lines || []).map((l) => [l.feeHeadId, l]))
  const out = []
  const seen = new Set()
  for (const l of classLines) {
    seen.add(l.feeHeadId)
    if (removed.has(l.feeHeadId)) { out.push({ ...l, source: 'removed' }); continue }
    const o = ov.get(l.feeHeadId)
    if (o) out.push({ feeHeadId: l.feeHeadId, amount: o.amount, cycle: o.cycle || l.cycle, source: 'overridden', baseAmount: l.amount, baseCycle: l.cycle })
    else out.push({ ...l, source: 'default' })
  }
  for (const o of override?.lines || []) if (!seen.has(o.feeHeadId)) out.push({ ...o, source: 'added' })
  return out
}
const decorate = (lines, heads) => lines.map((l) => ({ ...l, name: heads[l.feeHeadId]?.name || 'Fee', periodicity: heads[l.feeHeadId]?.periodicity }))
const billable = (eff) => eff.filter((l) => l.source !== 'removed')

// ---- Upsert a class structure (one per session+class) ----
router.put('/class-fees/structure', requirePermission('fees', 'edit'), (req, res) => {
  const { sessionId, classId, name, lines } = req.body || {}
  if (!sessionId || !classId) return res.status(422).json({ error: 'sessionId and classId are required' })
  const cls = find('classes', classId)
  if (!cls) return res.status(404).json({ error: 'Class not found' })
  if (req.scope.branchId && cls.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const err = validateLines(lines, headMap(cls.branchId))
  if (err) return res.status(422).json({ error: err })
  const cleanLines = lines.map((l) => ({ feeHeadId: l.feeHeadId, amount: l.amount, cycle: l.cycle || 'monthly' }))
  const existing = list('feeStructures', (s) => s.academicYearId === sessionId && s.classId === classId)[0]
  let row
  if (existing) {
    const before = { ...existing }
    row = update('feeStructures', existing.id, { name: name || existing.name, lines: cleanLines, programId: cls.programId }, req.user.id)
    audit(req, 'update', 'feeStructures', row.id, before, row)
  } else {
    const session = find('academicYears', sessionId)
    row = insert('feeStructures', { branchId: cls.branchId, academicYearId: sessionId, classId, programId: cls.programId, name: name || `${cls.name} ${session?.name || ''}`.trim(), lines: cleanLines }, req.user.id)
    audit(req, 'create', 'feeStructures', row.id, null, row)
  }
  res.json({ ...row, estimate: annualise(row.lines) })
})

// ---- Clone a structure to another class and/or session ----
router.post('/class-fees/structure/clone', requirePermission('fees', 'create'), (req, res) => {
  const { sourceId, toClassId, toSessionId } = req.body || {}
  const src = find('feeStructures', sourceId)
  if (!src) return res.status(404).json({ error: 'Source structure not found' })
  const cls = find('classes', toClassId || src.classId)
  if (!cls) return res.status(404).json({ error: 'Target class not found' })
  if (req.scope.branchId && cls.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const sessionId = toSessionId || src.academicYearId
  if (sessionId === src.academicYearId && cls.id === src.classId) return res.status(422).json({ error: 'Choose a different class or session to clone into' })
  if (list('feeStructures', (s) => s.academicYearId === sessionId && s.classId === cls.id)[0]) return res.status(409).json({ error: 'A structure already exists for that class + session' })
  const session = find('academicYears', sessionId)
  const row = insert('feeStructures', { branchId: cls.branchId, academicYearId: sessionId, classId: cls.id, programId: cls.programId, name: `${cls.name} ${session?.name || ''}`.trim(), lines: src.lines.map((l) => ({ ...l })) }, req.user.id)
  audit(req, 'clone', 'feeStructures', row.id, { from: src.id }, row)
  res.status(201).json(row)
})

// ============================================================================
// Per-student fee structure (override)
// ============================================================================
function studentFeePayload(student, sessionId) {
  const enr = list('enrolments', (e) => e.studentId === student.id && e.academicYearId === sessionId && !e.leftAt)[0]
  const classId = enr?.classId || null
  const structure = classId ? classStructureFor(sessionId, classId) : null
  const override = list('studentFeeStructures', (o) => o.studentId === student.id && o.academicYearId === sessionId)[0] || null
  const heads = headMap(student.branchId)
  const eff = effectiveLines(structure?.lines || [], override)
  return {
    studentId: student.id, sessionId, classId, structureId: structure?.id || null,
    classLines: decorate(structure?.lines || [], heads),
    override: override ? { lines: override.lines, removedHeadIds: override.removedHeadIds || [] } : null,
    hasOverride: !!override,
    effective: decorate(eff, heads),
    estimate: annualise(billable(eff)),
  }
}

router.get('/student-fees/:studentId', staffOnly, (req, res) => {
  const student = find('students', req.params.studentId)
  if (!student) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && student.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const sessionId = req.query.sessionId || list('academicYears', branchWhere(req)).find((y) => y.active)?.id
  if (!sessionId) return res.status(422).json({ error: 'sessionId required' })
  res.json(studentFeePayload(student, sessionId))
})

router.put('/student-fees/:studentId', requirePermission('fees', 'edit'), (req, res) => {
  const student = find('students', req.params.studentId)
  if (!student) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && student.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const { sessionId, lines = [], removedHeadIds = [] } = req.body || {}
  if (!sessionId) return res.status(422).json({ error: 'sessionId required' })
  const err = validateLines(lines, headMap(student.branchId))
  if (err) return res.status(422).json({ error: err })
  const clean = lines.map((l) => ({ feeHeadId: l.feeHeadId, amount: l.amount, cycle: l.cycle || 'monthly' }))
  const existing = list('studentFeeStructures', (o) => o.studentId === student.id && o.academicYearId === sessionId)[0]
  const empty = clean.length === 0 && removedHeadIds.length === 0
  if (existing) {
    const before = { ...existing }
    if (empty) { softDelete('studentFeeStructures', existing.id, req.user.id); audit(req, 'reset', 'studentFeeStructures', existing.id, before, null) }
    else { const row = update('studentFeeStructures', existing.id, { lines: clean, removedHeadIds }, req.user.id); audit(req, 'override', 'studentFeeStructures', row.id, before, row) }
  } else if (!empty) {
    const row = insert('studentFeeStructures', { branchId: student.branchId, academicYearId: sessionId, studentId: student.id, lines: clean, removedHeadIds }, req.user.id)
    audit(req, 'override', 'studentFeeStructures', row.id, null, row)
  }
  res.json(studentFeePayload(student, sessionId))
})

// ============================================================================
// Bulk Excel round-trip (students × fee heads matrix)
// ============================================================================
router.get('/class-fees/matrix', staffOnly, (req, res) => {
  const { classId, sessionId } = req.query
  if (!classId || !sessionId) return res.status(422).json({ error: 'classId and sessionId required' })
  const cls = find('classes', classId)
  if (!cls) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && cls.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const structure = classStructureFor(sessionId, classId)
  const heads = headMap(cls.branchId)
  const colHeadIds = (structure?.lines || []).map((l) => l.feeHeadId)
  const cols = colHeadIds.map((id) => ({ id, name: heads[id]?.name || id }))
  const students = list('enrolments', (e) => e.classId === classId && e.academicYearId === sessionId && !e.leftAt)
    .map((e) => find('students', e.studentId)).filter(Boolean)
    .sort((a, b) => (a.rollNo || 0) - (b.rollNo || 0))
    .map((st) => {
      const override = list('studentFeeStructures', (o) => o.studentId === st.id && o.academicYearId === sessionId)[0] || null
      const eff = effectiveLines(structure?.lines || [], override)
      const amounts = {}
      for (const id of colHeadIds) { const l = eff.find((x) => x.feeHeadId === id && x.source !== 'removed'); amounts[id] = l ? l.amount : 0 }
      return { studentId: st.id, name: `${st.firstName} ${st.lastName}`, rollNo: st.rollNo, overridden: !!override, amounts }
    })
  res.json({ classId, sessionId, className: cls.name, cols, students })
})

// preview (commit:false) or apply (commit:true) an edited matrix
router.post('/class-fees/import', requirePermission('fees', 'edit'), (req, res) => {
  const { classId, sessionId, rows = [], commit = false } = req.body || {}
  const cls = find('classes', classId)
  if (!cls) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && cls.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const structure = classStructureFor(sessionId, classId)
  if (!structure) return res.status(422).json({ error: 'No class structure to import against' })
  const heads = headMap(cls.branchId)
  const baseByHead = Object.fromEntries(structure.lines.map((l) => [l.feeHeadId, l]))
  const classStudentIds = new Set(list('enrolments', (e) => e.classId === classId && e.academicYearId === sessionId && !e.leftAt).map((e) => e.studentId))

  const changes = []
  const errors = []
  const toApply = []
  for (const [i, row] of rows.entries()) {
    const st = find('students', row.studentId)
    if (!st || !classStudentIds.has(row.studentId)) { errors.push({ row: i + 1, studentId: row.studentId, error: 'Student not in this class/session' }); continue }
    const overrideLines = []
    const diffs = []
    let rowBad = false
    for (const [headId, rupeeVal] of Object.entries(row.amounts || {})) {
      const base = baseByHead[headId]
      if (!base) { errors.push({ row: i + 1, name: `${st.firstName} ${st.lastName}`, error: `Head not in structure: ${heads[headId]?.name || headId}` }); rowBad = true; continue }
      const num = Number(rupeeVal)
      if (!Number.isFinite(num) || num < 0) { errors.push({ row: i + 1, name: `${st.firstName} ${st.lastName}`, error: `Bad amount for ${heads[headId]?.name || headId}: "${rupeeVal}"` }); rowBad = true; continue }
      const paise = toPaise(num)
      if (paise !== base.amount) {
        overrideLines.push({ feeHeadId: headId, amount: paise, cycle: base.cycle })
        diffs.push({ headId, name: heads[headId]?.name, fromPaise: base.amount, toPaise: paise })
      }
    }
    if (rowBad) continue
    if (diffs.length) changes.push({ studentId: st.id, name: `${st.firstName} ${st.lastName}`, diffs })
    toApply.push({ studentId: st.id, overrideLines })
  }

  if (!commit || errors.length) {
    return res.json({ preview: true, applied: false, changes, errors, canApply: errors.length === 0 })
  }

  let applied = 0
  for (const a of toApply) {
    const existing = list('studentFeeStructures', (o) => o.studentId === a.studentId && o.academicYearId === sessionId)[0]
    if (a.overrideLines.length === 0) {
      if (existing) { softDelete('studentFeeStructures', existing.id, req.user.id); applied++ }
      continue
    }
    if (existing) update('studentFeeStructures', existing.id, { lines: a.overrideLines, removedHeadIds: existing.removedHeadIds || [] }, req.user.id)
    else insert('studentFeeStructures', { branchId: cls.branchId, academicYearId: sessionId, studentId: a.studentId, lines: a.overrideLines, removedHeadIds: [] }, req.user.id)
    applied++
  }
  audit(req, 'bulk_import', 'studentFeeStructures', classId, { sessionId }, { applied, changes: changes.length })
  res.json({ preview: false, applied: true, appliedCount: applied, changes, errors: [] })
})

// ============================================================================
// Discounts: Concessions + Corporate tie-ups + Group charges. Precedence is
// fixed and documented in server/fees/discounts.js: concession -> corporate -> group.
// ============================================================================
function validateRule(b, categories) {
  if (categories && !categories.includes(b.category)) return 'Invalid category'
  if (!['percentage', 'fixed'].includes(b.type)) return 'Type must be percentage or fixed'
  if (b.values && typeof b.values !== 'object') return 'values must be an object'
  for (const v of Object.values(b.values || {})) if (!(Number(v) >= 0)) return 'concession values must be ≥ 0'
  return null
}

// --- Concessions ---
router.get('/concessions', requirePermission('fees', 'view'), (req, res) => {
  let rows = list('concessions', branchWhere(req))
  if (req.query.sessionId) rows = rows.filter((c) => c.academicYearId === req.query.sessionId)
  if (req.query.includeInactive !== 'true') rows = rows.filter((c) => c.active !== false)
  res.json(rows)
})
router.post('/concessions', requirePermission('fees', 'create'), (req, res) => {
  const err = validateRule(req.body, CONCESSION_CATEGORIES)
  if (err) return res.status(422).json({ error: err })
  const b = req.body
  const row = insert('concessions', { branchId: b.branchId ?? req.scope.branchId ?? null, academicYearId: b.academicYearId, category: b.category, name: b.name || b.category, type: b.type, values: b.values || {}, active: true }, req.user.id)
  audit(req, 'create', 'concessions', row.id, null, row)
  res.status(201).json(row)
})
router.put('/concessions/:id', requirePermission('fees', 'edit'), (req, res) => {
  const before = find('concessions', req.params.id)
  if (!before) return res.status(404).json({ error: 'Not found' })
  const merged = { ...before, ...req.body }
  const err = validateRule(merged, CONCESSION_CATEGORIES)
  if (err) return res.status(422).json({ error: err })
  const patch = {}
  for (const k of ['category', 'name', 'type', 'values', 'active']) if (req.body[k] !== undefined) patch[k] = req.body[k]
  const row = update('concessions', before.id, patch, req.user.id)
  audit(req, 'update', 'concessions', row.id, before, row)
  res.json(row)
})
router.delete('/concessions/:id', requirePermission('fees', 'delete'), (req, res) => {
  const row = find('concessions', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  softDelete('concessions', row.id, req.user.id)
  audit(req, 'delete', 'concessions', row.id, row, null)
  res.json({ ok: true })
})

// --- Corporates ---
router.get('/corporates', requirePermission('fees', 'view'), (req, res) => {
  let rows = list('corporates', branchWhere(req))
  if (req.query.includeInactive !== 'true') rows = rows.filter((c) => c.active !== false)
  res.json(rows)
})
router.post('/corporates', requirePermission('fees', 'create'), (req, res) => {
  const err = validateRule(req.body, null)
  if (err) return res.status(422).json({ error: err })
  const b = req.body
  const row = insert('corporates', { branchId: b.branchId ?? req.scope.branchId ?? null, name: b.name, type: b.type, values: b.values || {}, active: true }, req.user.id)
  audit(req, 'create', 'corporates', row.id, null, row)
  res.status(201).json(row)
})
router.put('/corporates/:id', requirePermission('fees', 'edit'), (req, res) => {
  const before = find('corporates', req.params.id)
  if (!before) return res.status(404).json({ error: 'Not found' })
  const merged = { ...before, ...req.body }
  const err = validateRule(merged, null)
  if (err) return res.status(422).json({ error: err })
  const patch = {}
  for (const k of ['name', 'type', 'values', 'active']) if (req.body[k] !== undefined) patch[k] = req.body[k]
  const row = update('corporates', before.id, patch, req.user.id)
  audit(req, 'update', 'corporates', row.id, before, row)
  res.json(row)
})
router.delete('/corporates/:id', requirePermission('fees', 'delete'), (req, res) => {
  const row = find('corporates', req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  softDelete('corporates', row.id, req.user.id)
  res.json({ ok: true })
})

// --- Group charges (reuse Setup Groups) ---
router.put('/groups/:id/charges', requirePermission('fees', 'edit'), (req, res) => {
  const group = find('groups', req.params.id)
  if (!group) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && group.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const charges = req.body.charges || []
  for (const ch of charges) {
    if (!['charge', 'discount'].includes(ch.kind)) return res.status(422).json({ error: 'charge kind must be charge or discount' })
    if (!['percentage', 'fixed'].includes(ch.type)) return res.status(422).json({ error: 'charge type must be percentage or fixed' })
    if (!(Number(ch.value) >= 0)) return res.status(422).json({ error: 'charge value must be ≥ 0' })
  }
  const row = update('groups', group.id, { charges }, req.user.id)
  audit(req, 'update', 'groups', row.id, { charges: group.charges }, { charges })
  res.json(row)
})

// --- Assign concession / corporate to a student ---
router.put('/students/:id/concession', requirePermission('fees', 'edit'), (req, res) => {
  const student = find('students', req.params.id)
  if (!student) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && student.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const { sessionId, concessionId } = req.body || {}
  if (!sessionId) return res.status(422).json({ error: 'sessionId required' })
  const existing = list('studentConcessions', (o) => o.studentId === student.id && o.academicYearId === sessionId)[0]
  if (!concessionId) { if (existing) softDelete('studentConcessions', existing.id, req.user.id) }
  else if (existing) update('studentConcessions', existing.id, { concessionId }, req.user.id)
  else insert('studentConcessions', { branchId: student.branchId, academicYearId: sessionId, studentId: student.id, concessionId }, req.user.id)
  audit(req, 'assign_concession', 'students', student.id, null, { sessionId, concessionId: concessionId || null })
  res.json(feePreview(student, sessionId))
})
router.put('/students/:id/corporate', requirePermission('fees', 'edit'), (req, res) => {
  const student = find('students', req.params.id)
  if (!student) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && student.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  update('students', student.id, { corporateId: req.body.corporateId || null }, req.user.id)
  audit(req, 'assign_corporate', 'students', student.id, null, { corporateId: req.body.corporateId || null })
  res.json(feePreview(find('students', student.id), req.body.sessionId || list('academicYears', branchWhere(req)).find((y) => y.active)?.id))
})

// resolve which concession applies: explicit assignment, else auto-map from the
// student's Setup category (EWS via ews flag, else OBC/SC/ST).
function resolveConcession(student, sessionId) {
  const explicit = list('studentConcessions', (o) => o.studentId === student.id && o.academicYearId === sessionId)[0]
  if (explicit) return { rule: find('concessions', explicit.concessionId), source: 'assigned' }
  const cat = student.ews ? 'EWS' : (['OBC', 'SC', 'ST'].includes(student.category) ? student.category : null)
  if (!cat) return { rule: null, source: null }
  const rule = list('concessions', (c) => c.branchId === student.branchId && c.academicYearId === sessionId && c.category === cat && c.active !== false)[0] || null
  return { rule, source: rule ? 'auto' : null }
}
function resolveGroupsFor(student, sessionId) {
  const enr = list('enrolments', (e) => e.studentId === student.id && e.academicYearId === sessionId && !e.leftAt)[0]
  const classId = enr?.classId
  return list('groups', (g) => g.branchId === student.branchId && (g.charges || []).length > 0 && ((g.memberIds || []).includes(student.id) || (classId && (g.classIds || []).includes(classId))))
}

// full effective fee with discount breakdown (precedence applied) for a student
function feePreview(student, sessionId) {
  const enr = list('enrolments', (e) => e.studentId === student.id && e.academicYearId === sessionId && !e.leftAt)[0]
  const classId = enr?.classId || null
  const structure = classId ? classStructureFor(sessionId, classId) : null
  const override = list('studentFeeStructures', (o) => o.studentId === student.id && o.academicYearId === sessionId)[0] || null
  const baseLines = billable(effectiveLines(structure?.lines || [], override))
  const { rule: concession, source: concSource } = resolveConcession(student, sessionId)
  const corporate = student.corporateId ? find('corporates', student.corporateId) : null
  const groups = resolveGroupsFor(student, sessionId)
  const breakdown = applyDiscounts(baseLines, { concession, corporate, groups })
  const heads = headMap(student.branchId)
  const totals = totalsOf(breakdown)
  const annualGross = annualise(breakdown.map((b) => ({ amount: b.base, cycle: b.cycle }))).annualTotal
  const annualNet = annualise(breakdown.map((b) => ({ amount: b.net, cycle: b.cycle }))).annualTotal
  return {
    studentId: student.id, sessionId, classId,
    concession: concession ? { id: concession.id, category: concession.category, name: concession.name, type: concession.type, source: concSource } : null,
    corporate: corporate ? { id: corporate.id, name: corporate.name, type: corporate.type } : null,
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    lines: breakdown.map((b) => ({ ...b, name: heads[b.feeHeadId]?.name || b.feeHeadId })),
    totals: { ...totals, annualGross, annualNet, annualDiscount: annualGross - annualNet },
    precedence: ['concession', 'corporate', 'group'],
  }
}

router.get('/students/:id/fee-preview', staffOnly, (req, res) => {
  const student = find('students', req.params.id)
  if (!student) return res.status(404).json({ error: 'Not found' })
  if (req.scope.branchId && student.branchId !== req.scope.branchId) return res.status(404).json({ error: 'Not found' })
  const sessionId = req.query.sessionId || list('academicYears', branchWhere(req)).find((y) => y.active)?.id
  if (!sessionId) return res.status(422).json({ error: 'sessionId required' })
  res.json(feePreview(student, sessionId))
})

// preview a *draft* concession on a sample student before saving it
router.post('/concessions/preview', requirePermission('fees', 'view'), (req, res) => {
  const { studentId, sessionId, concession } = req.body || {}
  const student = find('students', studentId)
  if (!student) return res.status(404).json({ error: 'Sample student not found' })
  const enr = list('enrolments', (e) => e.studentId === student.id && e.academicYearId === sessionId && !e.leftAt)[0]
  const structure = enr ? classStructureFor(sessionId, enr.classId) : null
  const override = list('studentFeeStructures', (o) => o.studentId === student.id && o.academicYearId === sessionId)[0] || null
  const baseLines = billable(effectiveLines(structure?.lines || [], override))
  const breakdown = applyDiscounts(baseLines, { concession })
  const heads = headMap(student.branchId)
  const totals = totalsOf(breakdown)
  res.json({
    studentName: `${student.firstName} ${student.lastName}`,
    lines: breakdown.map((b) => ({ ...b, name: heads[b.feeHeadId]?.name || b.feeHeadId })),
    totals: { ...totals, annualGross: annualise(breakdown.map((b) => ({ amount: b.base, cycle: b.cycle }))).annualTotal, annualNet: annualise(breakdown.map((b) => ({ amount: b.net, cycle: b.cycle }))).annualTotal },
  })
})

// ============================================================================
// Fee General Settings (per session) — due dates, late fees, auto-gen, reminders,
// bank accounts, report emails. One row per session+branch.
// ============================================================================
const REMINDER_CHANNELS = ['in_app', 'email', 'sms', 'whatsapp']
function defaultSettings(sessionId, branchId) {
  return {
    academicYearId: sessionId, branchId,
    lateFee: { type: 'fixed', amount: 0, cap: 0, grace: 0 }, // amount: paise (fixed) or percent (percentage); cap: paise
    perCycleDueDay: { one_time: 15, monthly: 10, quarterly: 10, term: 10, half_yearly: 10, annual: 15 },
    autoGenerate: { enabled: false, dayOfMonth: 1 },
    autoReminders: { enabled: false, channels: ['in_app', 'email'], rules: [{ type: 'before', days: 3 }, { type: 'on_due', days: 0 }, { type: 'overdue', days: 7 }] },
    bankAccounts: [],
    reportEmails: [],
    _isDefault: true,
  }
}

const daysBetween = (a, b) => Math.floor((new Date(a) - new Date(b)) / 86400000)

// late fee for one invoice under a given lateFee rule; 0 if within grace / nothing due
function lateFeeFor(inv, lateFee, today) {
  const balance = (inv.total || 0) - (inv.paidAmount || 0)
  if (balance <= 0) return 0
  const overdueBy = daysBetween(today, inv.dueDate)
  if (overdueBy <= (lateFee.grace || 0)) return 0
  let fee = lateFee.type === 'percentage' ? pctOfPaise(balance, lateFee.amount) : (lateFee.amount || 0)
  if (lateFee.cap > 0) fee = Math.min(fee, lateFee.cap)
  return fee
}

function validateSettings(b) {
  if (b.lateFee && !['fixed', 'percentage'].includes(b.lateFee.type)) return 'Late fee type must be fixed or percentage'
  if (b.autoReminders?.channels && b.autoReminders.channels.some((c) => !REMINDER_CHANNELS.includes(c))) return 'Unknown reminder channel'
  return null
}

router.get('/fee-settings', requirePermission('fees', 'view'), (req, res) => {
  const sessionId = req.query.sessionId || list('academicYears', branchWhere(req)).find((y) => y.active)?.id
  if (!sessionId) return res.status(422).json({ error: 'sessionId required' })
  const session = find('academicYears', sessionId)
  const branchId = req.scope.branchId || req.query.branchId || session?.branchId || null
  const existing = list('feeSettings', (s) => s.academicYearId === sessionId && s.branchId === branchId)[0]
  res.json(existing || defaultSettings(sessionId, branchId))
})

router.put('/fee-settings', requirePermission('fees', 'edit'), (req, res) => {
  const { academicYearId } = req.body || {}
  if (!academicYearId) return res.status(422).json({ error: 'academicYearId required' })
  const session = find('academicYears', academicYearId)
  const branchId = req.scope.branchId || req.body.branchId || session?.branchId || null
  const err = validateSettings(req.body)
  if (err) return res.status(422).json({ error: err })
  const fields = ['lateFee', 'perCycleDueDay', 'autoGenerate', 'autoReminders', 'bankAccounts', 'reportEmails']
  const patch = {}
  for (const k of fields) if (req.body[k] !== undefined) patch[k] = req.body[k]
  const existing = list('feeSettings', (s) => s.academicYearId === academicYearId && s.branchId === branchId)[0]
  let row
  if (existing) { const before = { ...existing }; row = update('feeSettings', existing.id, patch, req.user.id); audit(req, 'update', 'feeSettings', row.id, before, row) }
  else { row = insert('feeSettings', { academicYearId, branchId, ...defaultSettings(academicYearId, branchId), ...patch, _isDefault: undefined }, req.user.id); audit(req, 'create', 'feeSettings', row.id, null, row) }
  res.json(row)
})

// "preview effect" — how many overdue invoices a late-fee rule would hit + total
router.post('/fee-settings/preview', requirePermission('fees', 'view'), (req, res) => {
  const { academicYearId, lateFee } = req.body || {}
  const session = find('academicYears', academicYearId)
  const branchId = req.scope.branchId || req.body.branchId || session?.branchId || null
  const today = new Date().toISOString().slice(0, 10)
  const invoices = list('invoices', (i) => (!branchId || i.branchId === branchId) && i.status !== 'cancelled' && (i.total - i.paidAmount) > 0 && i.dueDate < today)
  let count = 0
  let total = 0
  for (const inv of invoices) {
    const fee = lateFeeFor(inv, lateFee || { type: 'fixed', amount: 0, cap: 0, grace: 0 }, today)
    if (fee > 0) { count += 1; total += fee }
  }
  res.json({ overdueCount: invoices.length, affected: count, totalLateFee: total })
})

export default router
