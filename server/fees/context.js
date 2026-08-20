// Shared fee-resolution helpers: a student's effective structure lines + the
// discount context (concession/corporate/groups) for a session. Used by the
// generation engine and preview endpoints.
import { list, find } from '../db.js'

export function classStructureFor(sessionId, classId) {
  let s = list('feeStructures', (x) => x.academicYearId === sessionId && x.classId === classId)[0]
  if (!s) { const cls = find('classes', classId); if (cls) s = list('feeStructures', (x) => x.academicYearId === sessionId && x.programId === cls.programId)[0] }
  return s || null
}

export function effectiveLines(classLines, override) {
  const removed = new Set(override?.removedHeadIds || [])
  const ov = new Map((override?.lines || []).map((l) => [l.feeHeadId, l]))
  const out = []
  const seen = new Set()
  for (const l of classLines) {
    seen.add(l.feeHeadId)
    if (removed.has(l.feeHeadId)) continue
    const o = ov.get(l.feeHeadId)
    out.push(o ? { feeHeadId: l.feeHeadId, amount: o.amount, cycle: o.cycle || l.cycle } : { ...l })
  }
  for (const o of override?.lines || []) if (!seen.has(o.feeHeadId)) out.push({ ...o })
  return out
}

export function resolveConcession(student, sessionId) {
  const explicit = list('studentConcessions', (o) => o.studentId === student.id && o.academicYearId === sessionId)[0]
  if (explicit) return { rule: find('concessions', explicit.concessionId), source: 'assigned' }
  const cat = student.ews ? 'EWS' : (['OBC', 'SC', 'ST'].includes(student.category) ? student.category : null)
  if (!cat) return { rule: null, source: null }
  const rule = list('concessions', (c) => c.branchId === student.branchId && c.academicYearId === sessionId && c.category === cat && c.active !== false)[0] || null
  return { rule, source: rule ? 'auto' : null }
}

export function resolveGroupsFor(student, sessionId) {
  const enr = list('enrolments', (e) => e.studentId === student.id && e.academicYearId === sessionId && !e.leftAt)[0]
  const classId = enr?.classId
  return list('groups', (g) => g.branchId === student.branchId && (g.charges || []).length > 0 && ((g.memberIds || []).includes(student.id) || (classId && (g.classIds || []).includes(classId))))
}

// everything the generator needs for one student
export function resolveStudentContext(student, sessionId) {
  const enr = list('enrolments', (e) => e.studentId === student.id && e.academicYearId === sessionId && !e.leftAt)[0]
  const classId = enr?.classId || null
  const structure = classId ? classStructureFor(sessionId, classId) : null
  const override = list('studentFeeStructures', (o) => o.studentId === student.id && o.academicYearId === sessionId)[0] || null
  const baseLines = effectiveLines(structure?.lines || [], override)
  const concession = resolveConcession(student, sessionId).rule
  const corporate = student.corporateId ? find('corporates', student.corporateId) : null
  const groups = resolveGroupsFor(student, sessionId)
  return { classId, joinedAt: enr?.joinedAt || null, baseLines, ctx: { concession, corporate, groups } }
}
