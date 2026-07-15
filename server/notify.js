import { insert, list, find } from './db.js'

// in-app is delivered for real; push/sms/whatsapp/email are stubbed senders
// recorded in notificationLog so the integration surface is already in place.
const CHANNELS = ['inApp', 'push', 'sms', 'whatsapp', 'email']
const DEFAULT_PREFS = { inApp: true, push: true, sms: false, whatsapp: true, email: true }

export function notifyUsers(userIds, { title, body, type = 'general', refType = null, refId = null }) {
  const out = []
  for (const userId of [...new Set(userIds)].filter(Boolean)) {
    const user = find('users', userId)
    if (!user || !user.active) continue
    const n = insert('notifications', { userId, title, body, type, refType, refId, readAt: null })
    const guardian = user.guardianId ? find('guardians', user.guardianId) : null
    const prefs = guardian?.notificationPrefs || DEFAULT_PREFS
    for (const ch of CHANNELS) {
      if (!prefs[ch]) continue
      insert('notificationLog', {
        notificationId: n.id,
        channel: ch,
        status: ch === 'inApp' ? 'sent' : 'stubbed',
      })
    }
    out.push(n)
  }
  return out
}

export function guardianUserIdsOfStudent(studentId) {
  return list('guardianStudentLinks', { studentId })
    .map((l) => find('guardians', l.guardianId)?.userId)
    .filter(Boolean)
}

export function notifyGuardiansOfStudent(studentId, payload) {
  return notifyUsers(guardianUserIdsOfStudent(studentId), payload)
}
