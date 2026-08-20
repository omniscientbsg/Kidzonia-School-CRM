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

// Org/Tasks write the same append-only rows but also record WHICH hat the actor
// wore and why — the org tree makes "who could do this" position-specific.
export function auditOrg(req, action, collection, recordId, { before = null, after = null, positionId = null, reason = null } = {}) {
  return insert('auditLog', {
    branchId: req.user?.branchId || null,
    userId: req.user?.id || null,
    action,
    collection,
    recordId,
    before,
    after,
    positionId,
    reason,
  })
}
