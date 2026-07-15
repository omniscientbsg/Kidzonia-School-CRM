import jwt from 'jsonwebtoken'
import { find, list } from './db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: '12h' })
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  // ?jwt= fallback lets <img>/<a download> tags load protected media
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query?.jwt || null
  if (!token) return res.status(401).json({ error: 'Missing token' })
  let payload
  try {
    payload = jwt.verify(token, JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
  const user = find('users', payload.sub)
  if (!user || !user.active) return res.status(401).json({ error: 'User inactive' })
  req.user = user
  if (user.role === 'parent') {
    const links = list('guardianStudentLinks', { guardianId: user.guardianId })
    req.scope = { studentIds: links.map((l) => l.studentId) }
  } else if (user.role === 'super_admin') {
    req.scope = {}
  } else {
    req.scope = { branchId: user.branchId }
  }
  next()
}

export function requirePermission(module, action) {
  return (req, res, next) => {
    const { user } = req
    if (!user) return res.status(401).json({ error: 'Unauthenticated' })
    if (user.role === 'super_admin') return next()
    const rp = list('rolePermissions', { role: user.role })[0]
    if (!rp?.permissions?.[module]?.[action]) {
      return res.status(403).json({ error: `Forbidden: ${module}.${action}` })
    }
    next()
  }
}

export function staffOnly(req, res, next) {
  if (req.user.role === 'parent') return res.status(403).json({ error: 'Staff only' })
  next()
}

export function parentOnly(req, res, next) {
  if (req.user.role !== 'parent') return res.status(403).json({ error: 'Parents only' })
  next()
}

// Merge the caller's branch scope into a where-object. Super admins may pass
// ?branchId= to focus one branch; other staff are pinned to their own.
export function branchWhere(req, where = {}) {
  if (req.scope.branchId) return { ...where, branchId: req.scope.branchId }
  if (req.query?.branchId) return { ...where, branchId: req.query.branchId }
  return where
}
