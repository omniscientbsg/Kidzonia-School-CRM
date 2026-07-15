import { list, find, insert, update, softDelete } from '../db.js'
import { requirePermission, branchWhere, staffOnly } from '../auth.js'
import { audit } from '../audit.js'

export function sanitizeUser(u) {
  if (!u) return u
  const { passwordHash: _ph, ...rest } = u
  return rest
}

// Registers standard CRUD endpoints. Query params listed in `filters` map
// straight onto row fields; branch scoping is applied unless disabled.
export function crudRoutes(router, base, coll, module, opts = {}) {
  const { filters = [], branchScoped = true, auditable = false, prepare = (b) => b } = opts
  // readAnyStaff: structural data (classes, programs…) readable by all staff roles
  const viewMw = opts.readAnyStaff ? staffOnly : requirePermission(module, 'view')

  router.get(base, viewMw, (req, res) => {
    let where = {}
    for (const f of filters) if (req.query[f] !== undefined) where[f] = req.query[f]
    if (branchScoped) where = branchWhere(req, where)
    res.json(list(coll, where))
  })

  router.get(`${base}/:id`, viewMw, (req, res) => {
    const row = find(coll, req.params.id)
    if (!row) return res.status(404).json({ error: 'Not found' })
    if (branchScoped && req.scope.branchId && row.branchId !== req.scope.branchId) {
      return res.status(404).json({ error: 'Not found' })
    }
    res.json(row)
  })

  router.post(base, requirePermission(module, 'create'), (req, res) => {
    const body = prepare({ ...req.body }, req)
    if (branchScoped && !body.branchId) body.branchId = req.scope.branchId || req.query.branchId || null
    const row = insert(coll, body, req.user.id)
    if (auditable) audit(req, 'create', coll, row.id, null, row)
    res.status(201).json(row)
  })

  router.put(`${base}/:id`, requirePermission(module, 'edit'), (req, res) => {
    const before = find(coll, req.params.id)
    if (!before) return res.status(404).json({ error: 'Not found' })
    if (branchScoped && req.scope.branchId && before.branchId !== req.scope.branchId) {
      return res.status(404).json({ error: 'Not found' })
    }
    const snapshot = { ...before }
    const patch = prepare({ ...req.body }, req)
    delete patch.id
    const row = update(coll, req.params.id, patch, req.user.id)
    if (auditable) audit(req, 'update', coll, row.id, snapshot, row)
    res.json(row)
  })

  router.delete(`${base}/:id`, requirePermission(module, 'delete'), (req, res) => {
    const before = find(coll, req.params.id)
    if (!before) return res.status(404).json({ error: 'Not found' })
    if (branchScoped && req.scope.branchId && before.branchId !== req.scope.branchId) {
      return res.status(404).json({ error: 'Not found' })
    }
    softDelete(coll, req.params.id, req.user.id)
    if (auditable) audit(req, 'delete', coll, req.params.id, before, null)
    res.json({ ok: true })
  })
}
