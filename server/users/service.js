// THE user master.
//
// `users` is the single identity table for everyone who can log in: staff and
// parents. No module keeps its own copy of a person — Setup/Staff, Org
// positions, Groups, Comms and Tasks all reference a user id.
//
// Both staff-creation endpoints (Settings' POST /users and Setup's POST /staff)
// funnel through here, so a person created from either screen is identical:
// same validation, same username rules, same employee number. Before this
// existed the two paths disagreed and a user made in Settings had no username,
// which silently broke username login for them.
import bcrypt from 'bcryptjs'
import { list, find, insert, update, nextNumber } from '../db.js'

export const STAFF_ROLES = [
  'super_admin', 'branch_admin', 'hq_coordinator', 'school_owner',
  'front_desk', 'accountant', 'teacher', 'daycare_staff',
]

const clean = (s) => String(s || '').trim()
const digits = (s) => clean(s).replace(/\D/g, '')

// Shared validation. Returns an error string, or null when the payload is fine.
export function validateStaffPayload(body, { existingId = null } = {}) {
  const name = clean(body.name)
  const username = clean(body.username).toLowerCase()
  if (!name) return 'Name is required'
  if (!username) return 'Username is required'
  if (!/^[a-z0-9._-]{3,}$/.test(username)) return 'Username must be at least 3 characters (letters, numbers, . _ -)'
  if (!STAFF_ROLES.includes(body.role)) return `Role must be one of ${STAFF_ROLES.join(', ')}`
  if (body.phone && digits(body.phone).length < 10) return 'Mobile number must have at least 10 digits'

  const clash = list('users', (u) => u.id !== existingId && (
    clean(u.username).toLowerCase() === username ||
    clean(u.email).toLowerCase() === clean(body.email || `${username}@kidzonia.com`).toLowerCase()
  ))
  if (clash.length) return 'That username or email is already in the user master'
  return null
}

// The one place a staff user is born.
export function createStaffUser(body, actorUserId, { branchFallback = null } = {}) {
  const username = clean(body.username).toLowerCase()
  return insert('users', {
    name: clean(body.name),
    username,
    email: clean(body.email).toLowerCase() || `${username}@kidzonia.com`,
    phone: body.phone || null,
    passwordHash: bcrypt.hashSync(body.password || 'password', 10),
    role: body.role,
    branchId: body.branchId ?? branchFallback ?? null,
    guardianId: null,
    active: body.active !== false,
    employeeId: body.employeeId || `EMP/${nextNumber('employeeId')}`,
    designation: body.designation || '',
    subjects: body.subjects || [],
    classTeacherOf: body.classTeacherOf || [],
    subjectTeacher: !!body.subjectTeacher,
    groupAdmin: !!body.groupAdmin,
    photoId: body.photoId || null,
  }, actorUserId)
}

export function updateStaffUser(id, patch, actorUserId) {
  const next = { ...patch }
  if (next.username) next.username = clean(next.username).toLowerCase()
  if (next.password) {
    next.passwordHash = bcrypt.hashSync(next.password, 10)
    delete next.password
  }
  delete next.id
  delete next.guardianId          // parent linkage is never edited through a staff screen
  return update('users', id, next, actorUserId)
}

export const isStaff = (u) => !!u && u.role !== 'parent'
export const staffMaster = () => list('users', isStaff)
export const findByLogin = (identifier) => {
  const id = clean(identifier).toLowerCase()
  return list('users', (u) => clean(u.email).toLowerCase() === id || clean(u.username).toLowerCase() === id)[0] || null
}
export const staffById = (id) => {
  const u = find('users', id)
  return isStaff(u) ? u : null
}
