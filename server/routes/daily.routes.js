import { Router } from 'express'
import { list, find, insert, update, softDelete } from '../db.js'
import { requireAuth, requirePermission, parentOnly, branchWhere } from '../auth.js'
import { notifyGuardiansOfStudent, guardianUserIdsOfStudent, notifyUsers } from '../notify.js'
import { crudRoutes } from './util.js'

const router = Router()
router.use(requireAuth)

const todayStr = () => new Date().toISOString().slice(0, 10)

function sectionStudentIds(sectionId) {
  return list('enrolments', { sectionId }).filter((e) => !e.leftAt).map((e) => e.studentId)
}

function childSections(studentIds) {
  const map = {}
  for (const sid of studentIds) {
    const enr = list('enrolments', { studentId: sid }).find((e) => !e.leftAt)
    if (enr) map[sid] = enr.sectionId
  }
  return map
}

function postAudienceStudentIds(post) {
  return post.studentIds?.length ? post.studentIds : sectionStudentIds(post.sectionId)
}

function decoratePost(post, userId) {
  const comments = list('diaryComments', { postId: post.id }).map((c) => ({
    ...c, byName: find('users', c.byId)?.name || 'Unknown',
  }))
  return {
    ...post,
    authorName: find('users', post.authorId)?.name || 'Staff',
    likeCount: (post.likes || []).length,
    likedByMe: (post.likes || []).includes(userId),
    comments,
  }
}

// ---------- diary posts (staff) ----------
router.get('/diary-posts', requirePermission('daily', 'view'), (req, res) => {
  let rows = list('diaryPosts', branchWhere(req))
  if (req.query.sectionId) rows = rows.filter((p) => p.sectionId === req.query.sectionId)
  res.json(rows.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')).map((p) => decoratePost(p, req.user.id)))
})

router.post('/diary-posts', requirePermission('daily', 'create'), (req, res) => {
  const { sectionId, studentIds = null, text, mediaIds = [], scheduledAt = null } = req.body
  if (!sectionId || !text) return res.status(400).json({ error: 'sectionId and text required' })
  const section = find('sections', sectionId)
  const cls = section ? find('classes', section.classId) : null
  if (!cls) return res.status(400).json({ error: 'Unknown section' })
  const post = insert('diaryPosts', {
    branchId: cls.branchId, sectionId, studentIds: studentIds?.length ? studentIds : null,
    text, mediaIds, authorId: req.user.id,
    publishedAt: scheduledAt || new Date().toISOString(), likes: [],
  }, req.user.id)
  const audience = postAudienceStudentIds(post)
  const userIds = audience.flatMap((sid) => guardianUserIdsOfStudent(sid))
  notifyUsers(userIds, {
    title: 'New diary update',
    body: text.slice(0, 120),
    type: 'daily', refType: 'diaryPost', refId: post.id,
  })
  res.status(201).json(decoratePost(post, req.user.id))
})

router.delete('/diary-posts/:id', requirePermission('daily', 'delete'), (req, res) => {
  softDelete('diaryPosts', req.params.id, req.user.id)
  res.json({ ok: true })
})

// like + comments — parents and staff both
router.post('/diary-posts/:id/like', (req, res) => {
  const post = find('diaryPosts', req.params.id)
  if (!post) return res.status(404).json({ error: 'Not found' })
  const likes = post.likes || []
  const updated = update('diaryPosts', post.id, {
    likes: likes.includes(req.user.id) ? likes.filter((id) => id !== req.user.id) : [...likes, req.user.id],
  }, req.user.id)
  res.json({ likeCount: updated.likes.length, likedByMe: updated.likes.includes(req.user.id) })
})

router.post('/diary-posts/:id/comments', (req, res) => {
  const post = find('diaryPosts', req.params.id)
  if (!post) return res.status(404).json({ error: 'Not found' })
  if (!req.body.text) return res.status(400).json({ error: 'text required' })
  if (req.user.role === 'parent') {
    const audience = postAudienceStudentIds(post)
    if (!audience.some((sid) => req.scope.studentIds.includes(sid))) {
      return res.status(403).json({ error: 'Not your child\'s post' })
    }
  }
  const c = insert('diaryComments', { postId: post.id, byId: req.user.id, text: req.body.text }, req.user.id)
  // let the author know someone replied
  if (post.authorId !== req.user.id) {
    notifyUsers([post.authorId], {
      title: 'New comment on your post',
      body: `${req.user.name}: ${req.body.text.slice(0, 100)}`,
      type: 'daily', refType: 'diaryPost', refId: post.id,
    })
  }
  res.status(201).json({ ...c, byName: req.user.name })
})

// ---------- daily logs ----------
const LOG_TYPES = ['meal', 'nap', 'diaper', 'mood', 'health']

router.get('/daily-logs', requirePermission('daily', 'view'), (req, res) => {
  const { sectionId, studentId, date = todayStr() } = req.query
  let rows = list('dailyLogs', branchWhere(req, { date }))
  if (studentId) rows = rows.filter((r) => r.studentId === studentId)
  else if (sectionId) {
    const ids = new Set(sectionStudentIds(sectionId))
    rows = rows.filter((r) => ids.has(r.studentId))
  }
  res.json(rows)
})

router.post('/daily-logs', requirePermission('daily', 'create'), (req, res) => {
  const { studentId, date = todayStr(), type, data = {} } = req.body
  if (!LOG_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of ${LOG_TYPES.join(', ')}` })
  const student = find('students', studentId)
  if (!student) return res.status(400).json({ error: 'Unknown student' })
  const row = insert('dailyLogs', { branchId: student.branchId, studentId, date, type, data, byId: req.user.id }, req.user.id)
  res.status(201).json(row)
})

router.delete('/daily-logs/:id', requirePermission('daily', 'delete'), (req, res) => {
  softDelete('dailyLogs', req.params.id, req.user.id)
  res.json({ ok: true })
})

// ---------- check-in / check-out ----------
router.get('/check-in-out', requirePermission('daily', 'view'), (req, res) => {
  const { sectionId, date = todayStr() } = req.query
  if (!sectionId) return res.status(400).json({ error: 'sectionId required' })
  const roster = sectionStudentIds(sectionId).map((sid) => {
    const s = find('students', sid)
    const rec = list('checkInOuts', { studentId: sid, date })[0] || null
    return { studentId: sid, name: `${s.firstName} ${s.lastName}`.trim(), rollNo: s.rollNo, record: rec }
  })
  res.json(roster.sort((a, b) => (a.rollNo || 0) - (b.rollNo || 0)))
})

router.post('/check-in-out', requirePermission('daily', 'create'), (req, res) => {
  const { studentId, date = todayStr(), action, pickupPerson = null } = req.body
  if (!['in', 'out'].includes(action)) return res.status(400).json({ error: 'action must be in|out' })
  const student = find('students', studentId)
  if (!student) return res.status(400).json({ error: 'Unknown student' })
  const time = new Date().toTimeString().slice(0, 5)
  const existing = list('checkInOuts', { studentId, date })[0]
  let row
  if (existing) {
    row = update('checkInOuts', existing.id, action === 'in' ? { inAt: time } : { outAt: time, pickupPerson }, req.user.id)
  } else {
    row = insert('checkInOuts', {
      branchId: student.branchId, studentId, date,
      inAt: action === 'in' ? time : null, outAt: action === 'out' ? time : null, pickupPerson,
    }, req.user.id)
  }
  notifyGuardiansOfStudent(studentId, {
    title: action === 'in' ? `${student.firstName} checked in` : `${student.firstName} checked out`,
    body: action === 'in' ? `Arrived at school at ${time}.` : `Left school at ${time}${pickupPerson ? ` with ${pickupPerson}` : ''}.`,
    type: 'daily', refType: 'checkInOut', refId: row.id,
  })
  res.json(row)
})

// ---------- albums & homework ----------
crudRoutes(router, '/albums', 'albums', 'daily', { filters: ['sectionId'] })

router.post('/albums/:id/media', requirePermission('daily', 'edit'), (req, res) => {
  const album = find('albums', req.params.id)
  if (!album) return res.status(404).json({ error: 'Not found' })
  const mediaIds = [...new Set([...(album.mediaIds || []), ...(req.body.mediaIds || [])])]
  res.json(update('albums', album.id, { mediaIds }, req.user.id))
})

router.get('/homework', requirePermission('daily', 'view'), (req, res) => {
  let rows = list('homework', branchWhere(req))
  if (req.query.sectionId) rows = rows.filter((h) => h.sectionId === req.query.sectionId)
  res.json(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
})

router.post('/homework', requirePermission('daily', 'create'), (req, res) => {
  const { sectionId, title, description = '', dueDate = null, mediaIds = [] } = req.body
  const section = find('sections', sectionId)
  const cls = section ? find('classes', section.classId) : null
  if (!cls || !title) return res.status(400).json({ error: 'sectionId and title required' })
  const row = insert('homework', { branchId: cls.branchId, sectionId, title, description, dueDate, mediaIds }, req.user.id)
  const userIds = sectionStudentIds(sectionId).flatMap((sid) => guardianUserIdsOfStudent(sid))
  notifyUsers(userIds, { title: 'New homework', body: title, type: 'daily', refType: 'homework', refId: row.id })
  res.status(201).json(row)
})

router.delete('/homework/:id', requirePermission('daily', 'delete'), (req, res) => {
  softDelete('homework', req.params.id, req.user.id)
  res.json({ ok: true })
})

// staff view of a student's consents
router.get('/students/:id/consents', requirePermission('students', 'view'), (req, res) => {
  res.json(list('consents', { studentId: req.params.id }).map((c) => ({
    ...c, guardianName: find('guardians', c.guardianId)?.name || 'Unknown',
  })))
})

// ---------- parent ----------
router.get('/parent/feed', parentOnly, (req, res) => {
  const sections = childSections(req.scope.studentIds)
  const mySections = new Set(Object.values(sections))
  const posts = list('diaryPosts', (p) =>
    p.studentIds?.length
      ? p.studentIds.some((sid) => req.scope.studentIds.includes(sid))
      : mySections.has(p.sectionId)
  )
  res.json(posts
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
    .slice(0, 50)
    .map((p) => decoratePost(p, req.user.id)))
})

router.get('/parent/children/:id/today', parentOnly, (req, res) => {
  if (!req.scope.studentIds.includes(req.params.id)) return res.status(403).json({ error: 'Not your child' })
  const date = req.query.date || todayStr()
  const enr = list('enrolments', { studentId: req.params.id }).find((e) => !e.leftAt)
  res.json({
    date,
    logs: list('dailyLogs', { studentId: req.params.id, date }),
    checkInOut: list('checkInOuts', { studentId: req.params.id, date })[0] || null,
    attendance: list('attendanceRecords', { studentId: req.params.id, date })[0] || null,
    homework: enr ? list('homework', { sectionId: enr.sectionId }).slice(0, 10) : [],
  })
})

router.get('/parent/albums', parentOnly, (req, res) => {
  const sections = new Set(Object.values(childSections(req.scope.studentIds)))
  res.json(list('albums', (a) => !a.sectionId || sections.has(a.sectionId)))
})

router.get('/parent/consents', parentOnly, (req, res) => {
  const rows = list('consents', { guardianId: req.user.guardianId }).map((c) => {
    const s = find('students', c.studentId)
    return { ...c, studentName: s ? `${s.firstName} ${s.lastName}`.trim() : 'Unknown' }
  })
  res.json(rows)
})

router.put('/parent/consents/:id', parentOnly, (req, res) => {
  const c = find('consents', req.params.id)
  if (!c || c.guardianId !== req.user.guardianId) return res.status(404).json({ error: 'Not found' })
  const row = update('consents', c.id, { granted: !!req.body.granted }, req.user.id)
  res.json(row)
})

export default router
