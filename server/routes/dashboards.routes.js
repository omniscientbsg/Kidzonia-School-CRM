import { Router } from 'express'
import { list, find } from '../db.js'
import { requireAuth } from '../auth.js'

const router = Router()
router.use(requireAuth)

const today = () => new Date().toISOString().slice(0, 10)
const thisMonth = () => new Date().toISOString().slice(0, 7)

function branchStats(branchId) {
  const students = list('students', { branchId, status: 'active' })
  const att = list('attendanceRecords', { branchId, date: today() })
  const invoices = list('invoices', { branchId }).filter((i) => i.status !== 'cancelled')
  const open = invoices.filter((i) => ['pending', 'partial', 'overdue'].includes(i.status))
  const payments = list('payments', { branchId, status: 'success' })
  const leads = list('leads', { branchId })
  const openLeads = leads.filter((l) => !['converted', 'lost'].includes(l.stage))
  const classes = list('classes', { branchId })
  const occupancy = classes.map((c) => {
    const sections = list('sections', { classId: c.id })
    const enrolled = sections.reduce((s, sec) => s + list('enrolments', { sectionId: sec.id }).filter((e) => !e.leftAt).length, 0)
    const capacity = sections.reduce((s, sec) => s + (sec.capacity || 0), 0)
    return { classId: c.id, className: c.name, enrolled, capacity }
  })
  return {
    branchId,
    branchName: find('branches', branchId)?.name || branchId,
    activeStudents: students.length,
    attendanceToday: {
      marked: att.length,
      present: att.filter((a) => ['present', 'late', 'half_day'].includes(a.status)).length,
      absent: att.filter((a) => a.status === 'absent').length,
      leave: att.filter((a) => a.status === 'leave').length,
    },
    fees: {
      due: open.reduce((s, i) => s + (i.total - i.paidAmount), 0),
      overdueInvoices: invoices.filter((i) => i.status === 'overdue').length,
      collectedToday: payments.filter((p) => p.updatedAt.startsWith(today())).reduce((s, p) => s + p.amount, 0),
      collectedThisMonth: payments.filter((p) => p.updatedAt.startsWith(thisMonth())).reduce((s, p) => s + p.amount, 0),
    },
    crm: {
      openLeads: openLeads.length,
      byStage: leads.reduce((acc, l) => ({ ...acc, [l.stage]: (acc[l.stage] || 0) + 1 }), {}),
    },
    pendingLeaves: list('leaveRequests', { status: 'pending' })
      .filter((lr) => find('students', lr.studentId)?.branchId === branchId).length,
    occupancy,
  }
}

router.get('/dashboards/summary', (req, res) => {
  const { user } = req
  if (user.role === 'super_admin') {
    const branches = list('branches').map((b) => branchStats(b.id))
    return res.json({ role: user.role, branches })
  }
  if (user.role === 'parent') {
    return res.json({ role: user.role, children: req.scope.studentIds })
  }
  const stats = branchStats(user.branchId)
  if (user.role === 'front_desk') {
    const myTasks = list('followUpTasks', { assigneeId: user.id, status: 'open' })
    return res.json({
      role: user.role,
      ...stats,
      myTasks: myTasks.map((t) => ({ ...t, leadName: find('leads', t.leadId)?.childName || '?', overdue: t.dueDate < today() })),
      overdueTasks: myTasks.filter((t) => t.dueDate < today()).length,
    })
  }
  if (user.role === 'teacher') {
    const mySections = list('sections', { teacherId: user.id })
    const sections = mySections.map((sec) => {
      const cls = find('classes', sec.classId)
      const studentIds = list('enrolments', { sectionId: sec.id }).filter((e) => !e.leftAt).map((e) => e.studentId)
      const marked = list('attendanceRecords', { sectionId: sec.id, date: today() }).length
      return { sectionId: sec.id, name: `${cls?.name || ''}-${sec.name}`, students: studentIds.length, attendanceMarked: marked }
    })
    return res.json({ role: user.role, branchName: stats.branchName, sections, pendingLeaves: stats.pendingLeaves })
  }
  res.json({ role: user.role, ...stats })
})

export default router
