// Turns one occurrence into the context a bound signal is read against.
//
// This is the adapter between "the assignee's class" — which is org language —
// and the rows a feature module keeps. It lives beside the registry rather than
// inside it so the registry stays a pure vocabulary, and beside the task engine
// rather than inside it so the engine never learns what a section is.
import { list, find } from '../db.js'

// Which register(s) this person actually keeps.
//
// Precedence matters: sections.teacherId is the direct "this person marks this
// register" link, so it wins outright. Falling back to classTeacherId covers
// schools that assign a teacher to the class and never fill in the section, but
// it must not ADD to a direct assignment — a teacher who keeps Nursery A should
// not silently become answerable for Nursery B because she also carries the
// class-teacher title.
// Sections belonging to a year that is actually running. Without this, a
// teacher who is already listed against next year's rollover sections carries
// registers that hold no children and cannot be marked — which would make every
// attendance task permanently unsatisfiable the day a rollover is prepared.
function inLiveYear(section) {
  const cls = find('classes', section.classId)
  if (!cls) return false
  if (cls.active === false) return false
  const year = find('academicYears', cls.academicYearId)
  return !!year && year.active !== false && !year.archived
}

export function sectionsOfUser(userId) {
  if (!userId) return []
  const direct = list('sections', (s) => s.teacherId === userId).filter(inLiveYear)
  if (direct.length) return direct.map((s) => s.id)

  // Class-level links, from either direction: the class naming its teacher, or
  // the staff record naming the classes. Setup writes the second one, so day
  // care staff are only reachable through it.
  const user = find('users', userId)
  const ids = new Set([
    ...list('classes', (c) => c.classTeacherId === userId && c.active !== false).map((c) => c.id),
    ...(user?.classTeacherOf || []),
  ])
  if (!ids.size) return []
  return list('sections', (s) => ids.has(s.classId)).filter(inLiveYear).map((s) => s.id)
}

export function buildContext(inst) {
  const sectionIds = sectionsOfUser(inst?.assigneeUserId)
  return {
    instance: inst,
    instanceId: inst?.id || null,
    assigneeUserId: inst?.assigneeUserId || null,
    assigneeNodeId: inst?.assigneeNodeId || null,
    // a single section stays a string so a signal can be written naively; more
    // than one is passed as a list and the signal decides what "all of them"
    // means for it
    assigneeSectionId: sectionIds.length === 1 ? sectionIds[0] : sectionIds.length ? sectionIds : null,
    assigneeSectionIds: sectionIds,
    branchId: inst?.branchId || find('users', inst?.assigneeUserId)?.branchId || null,
  }
}
