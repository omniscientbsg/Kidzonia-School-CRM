import { Router } from 'express'
import { list, find, insert, update, softDelete } from '../db.js'
import { requireAuth, requirePermission, parentOnly } from '../auth.js'
import { guardianUserIdsOfStudent, notifyUsers } from '../notify.js'
import { crudRoutes } from './util.js'

const router = Router()
router.use(requireAuth)

function studentsInBranch(branchId) {
  return list('students', { branchId, status: 'active' }).map((s) => s.id)
}

function sectionStudentIds(sectionId) {
  return list('enrolments', { sectionId }).filter((e) => !e.leftAt).map((e) => e.studentId)
}

function audienceUserIds(ann) {
  const a = ann.audience || { type: 'all', ids: [] }
  if (a.type === 'users') return a.ids
  let studentIds
  if (a.type === 'class') studentIds = a.ids.flatMap((sectionId) => sectionStudentIds(sectionId))
  else if (a.type === 'branch') studentIds = a.ids.flatMap((b) => studentsInBranch(b))
  else if (ann.branchId) studentIds = studentsInBranch(ann.branchId) // 'all' within a branch
  else return list('users', { role: 'parent', active: true }).map((u) => u.id) // global 'all'
  return [...new Set(studentIds.flatMap((sid) => guardianUserIdsOfStudent(sid)))]
}

// ---------- announcements ----------
router.get('/announcements', requirePermission('comms', 'view'), (req, res) => {
  const rows = list('announcements', (ann) =>
    !req.scope.branchId || !ann.branchId || ann.branchId === req.scope.branchId
  )
  res.json(rows.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')))
})

router.post('/announcements', requirePermission('comms', 'create'), (req, res) => {
  const { title, body, audience = { type: 'all', ids: [] }, mediaIds = [], requiresAck = false, scheduledAt = null } = req.body
  if (!title || !body) return res.status(400).json({ error: 'title and body required' })
  const ann = insert('announcements', {
    branchId: req.scope.branchId || req.body.branchId || null,
    audience, title, body, mediaIds, requiresAck,
    publishedAt: scheduledAt || new Date().toISOString(),
  }, req.user.id)
  const userIds = audienceUserIds(ann)
  notifyUsers(userIds, { title: `Notice: ${title}`, body: body.slice(0, 140), type: 'announcement', refType: 'announcement', refId: ann.id })
  res.status(201).json({ ...ann, recipients: userIds.length })
})

router.delete('/announcements/:id', requirePermission('comms', 'delete'), (req, res) => {
  softDelete('announcements', req.params.id, req.user.id)
  res.json({ ok: true })
})

router.get('/announcements/:id/stats', requirePermission('comms', 'view'), (req, res) => {
  const ann = find('announcements', req.params.id)
  if (!ann) return res.status(404).json({ error: 'Not found' })
  const reads = list('announcementReads', { announcementId: ann.id })
  const audience = audienceUserIds(ann)
  res.json({
    recipients: audience.length,
    read: reads.filter((r) => r.readAt).length,
    acknowledged: reads.filter((r) => r.ackAt).length,
    readers: reads.map((r) => ({ ...r, userName: find('users', r.userId)?.name || 'Unknown' })),
  })
})

function upsertRead(annId, userId, patch) {
  const existing = list('announcementReads', { announcementId: annId, userId })[0]
  if (existing) return update('announcementReads', existing.id, patch, userId)
  return insert('announcementReads', { announcementId: annId, userId, readAt: null, ackAt: null, ...patch }, userId)
}

router.post('/announcements/:id/read', (req, res) => {
  res.json(upsertRead(req.params.id, req.user.id, { readAt: new Date().toISOString() }))
})
router.post('/announcements/:id/ack', (req, res) => {
  const now = new Date().toISOString()
  res.json(upsertRead(req.params.id, req.user.id, { readAt: now, ackAt: now }))
})

router.get('/parent/announcements', parentOnly, (req, res) => {
  const rows = list('announcements', (ann) => audienceUserIds(ann).includes(req.user.id))
  res.json(rows
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
    .map((ann) => {
      const read = list('announcementReads', { announcementId: ann.id, userId: req.user.id })[0]
      return { ...ann, readAt: read?.readAt || null, ackAt: read?.ackAt || null }
    }))
})

// ---------- chat ----------
function threadSummary(thread, userId) {
  const msgs = list('messages', { threadId: thread.id }).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const last = msgs.at(-1) || null
  const student = thread.studentId ? find('students', thread.studentId) : null
  const others = thread.participantIds.filter((id) => id !== userId)
  return {
    ...thread,
    participants: thread.participantIds.map((id) => ({ id, name: find('users', id)?.name || 'Unknown' })),
    otherName: others.map((id) => find('users', id)?.name || 'Unknown').join(', '),
    studentName: student ? `${student.firstName} ${student.lastName}`.trim() : null,
    lastMessage: last ? { text: last.text, at: last.createdAt, byId: last.byId } : null,
    unreadCount: msgs.filter((m) => m.byId !== userId && !(m.readBy || []).includes(userId)).length,
  }
}

router.get('/chat/threads', (req, res) => {
  const rows = list('chatThreads', (th) => th.participantIds.includes(req.user.id))
  res.json(rows.map((th) => threadSummary(th, req.user.id))
    .sort((a, b) => (b.lastMessage?.at || b.createdAt).localeCompare(a.lastMessage?.at || a.createdAt)))
})

router.post('/chat/threads', (req, res) => {
  const { studentId, type = 'parent_teacher' } = req.body
  const student = find('students', studentId)
  if (!student) return res.status(400).json({ error: 'studentId required' })
  if (req.user.role === 'parent' && !req.scope.studentIds.includes(studentId)) {
    return res.status(403).json({ error: 'Not your child' })
  }
  // resolve the other side
  let otherId = req.body.otherUserId || null
  if (!otherId) {
    if (type === 'parent_office') {
      otherId = list('users', { role: 'branch_admin', branchId: student.branchId, active: true })[0]?.id
    } else {
      const enr = list('enrolments', { studentId }).find((e) => !e.leftAt)
      otherId = enr ? find('sections', enr.sectionId)?.teacherId : null
    }
  }
  if (!otherId) return res.status(400).json({ error: 'No staff member available for this thread' })
  const me = req.user.id
  const existing = list('chatThreads', (th) =>
    th.type === type && th.studentId === studentId &&
    th.participantIds.includes(me) && th.participantIds.includes(otherId)
  )[0]
  if (existing) return res.json(threadSummary(existing, me))
  const thread = insert('chatThreads', { branchId: student.branchId, type, studentId, participantIds: [me, otherId] }, me)
  res.status(201).json(threadSummary(thread, me))
})

router.get('/chat/threads/:id/messages', (req, res) => {
  const thread = find('chatThreads', req.params.id)
  if (!thread || !thread.participantIds.includes(req.user.id)) return res.status(404).json({ error: 'Not found' })
  const msgs = list('messages', { threadId: thread.id }).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const m of msgs) {
    if (m.byId !== req.user.id && !(m.readBy || []).includes(req.user.id)) {
      update('messages', m.id, { readBy: [...(m.readBy || []), req.user.id] }, req.user.id)
    }
  }
  res.json(msgs.map((m) => ({ ...m, byName: find('users', m.byId)?.name || 'Unknown' })))
})

router.post('/chat/threads/:id/messages', (req, res) => {
  const thread = find('chatThreads', req.params.id)
  if (!thread || !thread.participantIds.includes(req.user.id)) return res.status(404).json({ error: 'Not found' })
  if (!req.body.text) return res.status(400).json({ error: 'text required' })
  const msg = insert('messages', { threadId: thread.id, byId: req.user.id, text: req.body.text, readBy: [] }, req.user.id)
  notifyUsers(thread.participantIds.filter((id) => id !== req.user.id), {
    title: `Message from ${req.user.name}`,
    body: req.body.text.slice(0, 120),
    type: 'chat', refType: 'chatThread', refId: thread.id,
  })
  res.status(201).json({ ...msg, byName: req.user.name })
})

// ---------- events ----------
crudRoutes(router, '/events', 'events', 'comms', { filters: ['type'] })

router.post('/events/:id/rsvp', (req, res) => {
  const event = find('events', req.params.id)
  if (!event) return res.status(404).json({ error: 'Not found' })
  if (!event.rsvpEnabled) return res.status(400).json({ error: 'RSVP not enabled for this event' })
  const { response } = req.body
  if (!['yes', 'no', 'maybe'].includes(response)) return res.status(400).json({ error: 'response must be yes|no|maybe' })
  const existing = list('eventRsvps', { eventId: event.id, guardianUserId: req.user.id })[0]
  const row = existing
    ? update('eventRsvps', existing.id, { response }, req.user.id)
    : insert('eventRsvps', { eventId: event.id, guardianUserId: req.user.id, response }, req.user.id)
  res.json(row)
})

router.get('/events/:id/rsvps', requirePermission('comms', 'view'), (req, res) => {
  const rows = list('eventRsvps', { eventId: req.params.id })
  const counts = { yes: 0, no: 0, maybe: 0 }
  for (const r of rows) counts[r.response] = (counts[r.response] || 0) + 1
  res.json({ counts, rows: rows.map((r) => ({ ...r, userName: find('users', r.guardianUserId)?.name || 'Unknown' })) })
})

router.get('/parent/events', parentOnly, (req, res) => {
  const branchIds = new Set(req.scope.studentIds.map((sid) => find('students', sid)?.branchId).filter(Boolean))
  const rows = list('events', (e) => branchIds.has(e.branchId))
  res.json(rows.sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({
    ...e,
    myRsvp: list('eventRsvps', { eventId: e.id, guardianUserId: req.user.id })[0]?.response || null,
  })))
})

// ---------- published resources (worksheets) ----------
crudRoutes(router, '/published-resources', 'publishedResources', 'worksheets', {
  filters: [],
  prepare: (body, req) => ({
    audience: { type: 'branch', ids: [req.scope.branchId].filter(Boolean) },
    publishedAt: new Date().toISOString(),
    publishedBy: req.user.id,
    ...body,
  }),
})

router.get('/parent/worksheets', parentOnly, (req, res) => {
  const sections = new Set()
  const branches = new Set()
  for (const sid of req.scope.studentIds) {
    const s = find('students', sid)
    if (s) branches.add(s.branchId)
    const enr = list('enrolments', { studentId: sid }).find((e) => !e.leftAt)
    if (enr) sections.add(enr.sectionId)
  }
  const rows = list('publishedResources', (r) => {
    const a = r.audience || { type: 'all', ids: [] }
    if (a.type === 'all') return true
    if (a.type === 'branch') return a.ids.some((b) => branches.has(b))
    if (a.type === 'class') return a.ids.some((sec) => sections.has(sec))
    return false
  })
  res.json(rows.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')))
})

export default router
