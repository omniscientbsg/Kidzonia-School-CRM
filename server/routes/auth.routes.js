import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { list, find, update } from '../db.js'
import { signToken, requireAuth } from '../auth.js'
import { sanitizeUser } from './util.js'

const router = Router()

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {}
  const user = list('users', { email: (email || '').toLowerCase().trim() })[0]
  if (!user || !user.active || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }
  res.json({ token: signToken(user), user: sanitizeUser(user) })
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
