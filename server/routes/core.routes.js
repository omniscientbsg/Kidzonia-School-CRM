import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { list, find, insert, update, softDelete } from '../db.js'
import { requireAuth, requirePermission, branchWhere, staffOnly } from '../auth.js'
import { audit } from '../audit.js'
import { crudRoutes, sanitizeUser } from './util.js'

const router = Router()
router.use(requireAuth, staffOnly)

// branches are global (not branch-scoped rows themselves)
router.get('/branches', (req, res) => {
  const rows = list('branches')
  res.json(req.scope.branchId ? rows.filter((b) => b.id === req.scope.branchId) : rows)
})
router.post('/branches', requirePermission('settings', 'create'), (req, res) => {
  const row = insert('branches', req.body, req.user.id)
  audit(req, 'create', 'branches', row.id, null, row)
  res.status(201).json(row)
})
router.put('/branches/:id', requirePermission('settings', 'edit'), (req, res) => {
  const before = find('branches', req.params.id)
  if (!before) return res.status(404).json({ error: 'Not found' })
  const row = update('branches', req.params.id, req.body, req.user.id)
  res.json(row)
})

crudRoutes(router, '/academic-years', 'academicYears', 'settings', { filters: ['branchId', 'active'] })
crudRoutes(router, '/programs', 'programs', 'settings', { filters: ['branchId'] })
crudRoutes(router, '/classes', 'classes', 'settings', { filters: ['branchId', 'academicYearId', 'programId'] })
crudRoutes(router, '/fee-heads', 'feeHeads', 'settings', { filters: ['branchId'] })

// sections have no branchId of their own — scope via their class
router.get('/sections', (req, res) => {
  const classes = list('classes', branchWhere(req))
  const classIds = new Set(classes.map((c) => c.id))
  let rows = list('sections', (s) => classIds.has(s.classId))
  if (req.query.classId) rows = rows.filter((s) => s.classId === req.query.classId)
  res.json(rows)
})
router.post('/sections', requirePermission('settings', 'create'), (req, res) => {
  res.status(201).json(insert('sections', req.body, req.user.id))
})
router.put('/sections/:id', requirePermission('settings', 'edit'), (req, res) => {
  const row = update('sections', req.params.id, req.body, req.user.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})
router.delete('/sections/:id', requirePermission('settings', 'delete'), (req, res) => {
  softDelete('sections', req.params.id, req.user.id)
  res.json({ ok: true })
})

// users
router.get('/users', requirePermission('settings', 'view'), (req, res) => {
  let where = {}
  if (req.query.role) where.role = req.query.role
  where = branchWhere(req, where)
  // staff of a branch + global (branchId null) super admins are visible to HQ only
  let rows = list('users', (u) => u.role !== 'parent')
  if (where.branchId) rows = rows.filter((u) => u.branchId === where.branchId)
  if (where.role) rows = rows.filter((u) => u.role === where.role)
  res.json(rows.map(sanitizeUser))
})
router.post('/users', requirePermission('settings', 'create'), (req, res) => {
  const { password, ...body } = req.body
  if (!body.email || !password) return res.status(400).json({ error: 'email and password required' })
  if (list('users', { email: body.email.toLowerCase().trim() }).length) {
    return res.status(409).json({ error: 'Email already in use' })
  }
  const row = insert('users', {
    ...body,
    email: body.email.toLowerCase().trim(),
    passwordHash: bcrypt.hashSync(password, 10),
    active: body.active !== false,
    guardianId: body.guardianId || null,
    branchId: body.branchId ?? req.scope.branchId ?? null,
  }, req.user.id)
  audit(req, 'create', 'users', row.id, null, sanitizeUser(row))
  res.status(201).json(sanitizeUser(row))
})
router.put('/users/:id', requirePermission('settings', 'edit'), (req, res) => {
  const before = find('users', req.params.id)
  if (!before) return res.status(404).json({ error: 'Not found' })
  const { password, ...patch } = req.body
  if (password) patch.passwordHash = bcrypt.hashSync(password, 10)
  const row = update('users', req.params.id, patch, req.user.id)
  audit(req, 'update', 'users', row.id, sanitizeUser(before), sanitizeUser(row))
  res.json(sanitizeUser(row))
})

// role permission matrix — super admin only edits
router.get('/role-permissions', requirePermission('settings', 'view'), (_req, res) => {
  res.json(list('rolePermissions'))
})
router.put('/role-permissions/:role', (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Super admin only' })
  const row = list('rolePermissions', { role: req.params.role })[0]
  if (!row) return res.status(404).json({ error: 'Unknown role' })
  const before = { ...row }
  const updated = update('rolePermissions', row.id, { permissions: req.body.permissions }, req.user.id)
  audit(req, 'update', 'rolePermissions', row.id, before, updated)
  res.json(updated)
})

router.get('/audit-log', requirePermission('settings', 'view'), (req, res) => {
  let rows = list('auditLog', branchWhere(req))
  if (req.query.collection) rows = rows.filter((r) => r.collection === req.query.collection)
  rows = rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500)
  res.json(rows)
})

export default router
