import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { list, find, update } from '../db.js'
import { signToken, requireAuth } from '../auth.js'
import { sanitizeUser } from './util.js'
import { auditOrg } from '../audit.js'
import { evaluate } from '../tasks/gate.js'
import { syncTasks } from '../tasks/generate.js'

const router = Router()

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {}
  const id = (email || '').toLowerCase().trim()
  // accept either the email or the staff username as the login identifier
  const user = list('users', (u) => u.email?.toLowerCase() === id || u.username?.toLowerCase() === id)[0]
  if (!user || !user.active || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }
  // Hand the client its outstanding mandatory work up front, so the blocking
  // modal can appear the moment someone signs back in. Materialize first:
  // yesterday's occurrence may not exist yet for someone who never opened the
  // Tasks screen, and the gate must not under-report.
  if (user.role !== 'parent') syncTasks()
  const gate = user.role === 'parent' ? { blocked: false, armed: false, instances: [] } : evaluate(user)
  res.json({ token: signToken(user), user: sanitizeUser(user), blockingTasks: gate.instances, taskGateArmed: gate.armed })
})

// Logout is server-authoritative: while mandatory same-day work is open the
// answer is 409 and the client must not drop its token. Walking out anyway is
// handled by taskGate(), which then refuses writes until the work is cleared.
router.post('/auth/logout', requireAuth, (req, res) => {
  if (req.user.role === 'parent') return res.json({ ok: true })
  syncTasks()
  const gate = evaluate(req.user)
  if (gate.blocked) {
    auditOrg(req, 'gate.block', 'users', req.user.id, { after: { instances: gate.instances.map((i) => i.id) } })
    return res.status(409).json({
      error: 'blocking_tasks',
      message: `Finish ${gate.instances.length} mandatory task${gate.instances.length > 1 ? 's' : ''} before logging out`,
      instances: gate.instances,
    })
  }
  update('users', req.user.id, { lastLogoutAt: new Date().toISOString() }, req.user.id)
  auditOrg(req, 'gate.clear', 'users', req.user.id)
  res.json({ ok: true })
})

// What is standing between me and the door?
router.get('/tasks/logout-check', requireAuth, (req, res) => {
  if (req.user.role === 'parent') return res.json({ blocked: false, armed: false, instances: [] })
  syncTasks()
  res.json(evaluate(req.user))
})

router.get('/me', requireAuth, (req, res) => {
  res.json(sanitizeUser(req.user))
})

router.get('/me/notification-prefs', requireAuth, (req, res) => {
  const guardian = req.user.guardianId ? find('guardians', req.user.guardianId) : null
  res.json(guardian?.notificationPrefs || { inApp: true, push: true, sms: false, whatsapp: true, email: true })
})

router.put('/me/notification-prefs', requireAuth, (req, res) => {
  if (!req.user.guardianId) return res.status(400).json({ error: 'No guardian profile' })
  const guardian = find('guardians', req.user.guardianId)
  const prefs = { ...guardian.notificationPrefs, ...req.body }
  update('guardians', guardian.id, { notificationPrefs: prefs }, req.user.id)
  res.json(prefs)
})

router.get('/notifications', requireAuth, (req, res) => {
  const rows = list('notifications', { userId: req.user.id })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100)
  res.json(rows)
})

router.post('/notifications/:id/read', requireAuth, (req, res) => {
  const n = find('notifications', req.params.id)
  if (!n || n.userId !== req.user.id) return res.status(404).json({ error: 'Not found' })
  update('notifications', n.id, { readAt: new Date().toISOString() }, req.user.id)
  res.json({ ok: true })
})

router.post('/notifications/read-all', requireAuth, (req, res) => {
  const at = new Date().toISOString()
  for (const n of list('notifications', { userId: req.user.id })) {
    if (!n.readAt) update('notifications', n.id, { readAt: at }, req.user.id)
  }
  res.json({ ok: true })
})

export default router
