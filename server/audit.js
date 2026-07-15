import { insert } from './db.js'

export function audit(req, action, collection, recordId, before = null, after = null) {
  insert('auditLog', {
    branchId: req.user?.branchId || null,
    userId: req.user?.id || null,
    action,
    collection,
    recordId,
    before,
    after,
  })
}
