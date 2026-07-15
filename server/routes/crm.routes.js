import { Router } from 'express'
import { list, find, insert, update } from '../db.js'
import { requireAuth, requirePermission, branchWhere, staffOnly } from '../auth.js'
import { audit } from '../audit.js'
import { crudRoutes } from './util.js'

export const LEAD_STAGES = ['new', 'contacted', 'visit_scheduled', 'visited', 'demo', 'negotiation', 'converted', 'lost']

const router = Router()
router.use(requireAuth, staffOnly)

// duplicate check must come before /leads/:id
router.get('/leads/check-duplicate', requirePermission('crm', 'view'), (req, res) => {
  const { phone, email, childName } = req.query
  const rows = list('leads', branchWhere(req)).filter((l) =>
    (phone && l.phone === phone) ||
    (email && email.length > 3 && l.email?.toLowerCase() === email.toLowerCase()) ||
    (childName && childName.length > 2 && l.childName?.toLowerCase() === childName.toLowerCase())
  )
  res.json({ duplicates: rows })
})

router.get('/crm/analytics', requirePermission('crm', 'view'), (req, res) => {
  const leads = list('leads', branchWhere(req))
  const byStage = {}
  const bySource = {}
  const byCounsellor = {}
  for (const l of leads) {
    byStage[l.stage] = (byStage[l.stage] || 0) + 1
    bySource[l.source] = (bySource[l.source] || 0) + 1
    if (l.counsellorId) {
      const c = (byCounsellor[l.counsellorId] ||= { total: 0, converted: 0, daysToConvertSum: 0 })
      c.total += 1
      if (l.stage === 'converted') {
        c.converted += 1
        if (l.convertedAt) {
          c.daysToConvertSum += (new Date(l.convertedAt) - new Date(l.createdAt)) / 86400000
        }
      }
    }
  }
  const counsellors = Object.entries(byCounsellor).map(([id, c]) => ({
    counsellorId: id,
    counsellorName: find('users', id)?.name || 'Unknown',
    total: c.total,
    converted: c.converted,
    conversionPct: c.total ? Math.round((c.converted / c.total) * 100) : 0,
    avgDaysToConvert: c.converted ? Math.round(c.daysToConvertSum / c.converted) : null,
  }))
  const total = leads.length
  const converted = byStage.converted || 0
  res.json({ total, converted, conversionPct: total ? Math.round((converted / total) * 100) : 0, byStage, bySource, counsellors })
})

crudRoutes(router, '/leads', 'leads', 'crm', {
  filters: ['stage', 'counsellorId', 'source', 'programId'],
  auditable: true,
  prepare: (body) => ({ stage: 'new', counsellorId: null, lostReason: null, convertedApplicationId: null, ...body }),
})

router.post('/leads/:id/stage', requirePermission('crm', 'edit'), (req, res) => {
  const lead = find('leads', req.params.id)
  if (!lead) return res.status(404).json({ error: 'Not found' })
  const { stage, lostReason } = req.body
  if (!LEAD_STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage' })
  if (stage === 'lost' && !lostReason) return res.status(400).json({ error: 'lostReason required when marking a lead lost' })
  if (stage === 'converted') return res.status(400).json({ error: 'Use /leads/:id/convert to convert a lead' })
  const before = { ...lead }
  const row = update('leads', lead.id, { stage, lostReason: stage === 'lost' ? lostReason : null }, req.user.id)
  insert('leadActivities', { leadId: lead.id, type: 'stage_change', note: `${before.stage} → ${stage}${lostReason ? ` (${lostReason})` : ''}`, byId: req.user.id }, req.user.id)
  audit(req, 'stage_change', 'leads', lead.id, before, row)
  res.json(row)
})

router.get('/leads/:id/activities', requirePermission('crm', 'view'), (req, res) => {
  res.json(list('leadActivities', { leadId: req.params.id }).sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
})

router.post('/leads/:id/activities', requirePermission('crm', 'create'), (req, res) => {
  const lead = find('leads', req.params.id)
  if (!lead) return res.status(404).json({ error: 'Not found' })
  const row = insert('leadActivities', { leadId: lead.id, type: req.body.type || 'note', note: req.body.note || '', byId: req.user.id }, req.user.id)
  res.status(201).json(row)
})

router.post('/leads/:id/assign', requirePermission('crm', 'edit'), (req, res) => {
  const lead = find('leads', req.params.id)
  if (!lead) return res.status(404).json({ error: 'Not found' })
  let counsellorId = req.body.counsellorId
  if (!counsellorId) {
    // round-robin across the branch's counsellors by current open-lead load
    const counsellors = list('users', { role: 'front_desk', branchId: lead.branchId, active: true })
    if (!counsellors.length) return res.status(400).json({ error: 'No counsellors in branch' })
    const openLoad = (uid) => list('leads', { counsellorId: uid }).filter((l) => !['converted', 'lost'].includes(l.stage)).length
    counsellorId = counsellors.sort((a, b) => openLoad(a.id) - openLoad(b.id))[0].id
  }
  const row = update('leads', lead.id, { counsellorId }, req.user.id)
  insert('leadActivities', { leadId: lead.id, type: 'note', note: `Assigned to ${find('users', counsellorId)?.name}`, byId: req.user.id }, req.user.id)
  res.json(row)
})

// one-click convert: everything captured on the lead carries into an application
router.post('/leads/:id/convert', requirePermission('crm', 'edit'), (req, res) => {
  const lead = find('leads', req.params.id)
  if (!lead) return res.status(404).json({ error: 'Not found' })
  if (lead.convertedApplicationId) return res.status(409).json({ error: 'Lead already converted', applicationId: lead.convertedApplicationId })
  const app = insert('applications', {
    branchId: lead.branchId,
    leadId: lead.id,
    programId: lead.programId,
    childName: lead.childName,
    childDob: lead.childDob,
    gender: req.body.gender || null,
    guardiansDraft: [{ name: lead.parentName, relationship: req.body.relationship || 'guardian', phone: lead.phone, email: lead.email }],
    siblingStudentIds: [],
    status: 'submitted',
    decisions: [{ status: 'submitted', byId: req.user.id, at: new Date().toISOString(), note: 'Converted from lead' }],
  }, req.user.id)
  const before = { ...lead }
  const row = update('leads', lead.id, { stage: 'converted', convertedApplicationId: app.id, convertedAt: new Date().toISOString() }, req.user.id)
  insert('leadActivities', { leadId: lead.id, type: 'stage_change', note: `Converted to application ${app.id}`, byId: req.user.id }, req.user.id)
  audit(req, 'convert', 'leads', lead.id, before, row)
  res.status(201).json({ lead: row, application: app })
})

crudRoutes(router, '/follow-ups', 'followUpTasks', 'crm', {
  filters: ['leadId', 'assigneeId', 'status'],
  branchScoped: false,
  prepare: (body, req) => ({ status: 'open', assigneeId: req.user.id, channel: 'call', ...body }),
})

export default router
