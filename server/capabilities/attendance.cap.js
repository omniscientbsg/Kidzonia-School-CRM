// Capability descriptor for Class Attendance — the first real integration.
//
// This file is allowed to know how attendance is stored; that is its whole job.
// The task engine only ever sees the shape declared here, and reaches it
// through the registry.
//
// GRANULARITY NOTE: the signal is keyed on sectionId, not classId. Attendance
// in this schema is recorded per section (`POST /attendance` takes a sectionId),
// and a class can hold two sections — Nursery A and Nursery B — with different
// teachers. A class-level signal would have to guess which register it meant,
// and would report "marked" while half a class was unmarked. The binding
// "the assignee's class" resolves to the section(s) that person actually keeps
// the register for, so the assigner still picks it in class language.
import { list } from '../db.js'

// Statuses that count as a decision having been recorded for a child.
const MARKED = new Set(['present', 'absent', 'late', 'half_day', 'leave'])

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])

// Stable fingerprint of the records that satisfied the signal. If somebody
// later edits or deletes attendance, this stops matching, which is how a
// completed task can be spotted as no longer true.
function checksum(rows) {
  const material = rows
    .map((r) => `${r.id}:${r.studentId}:${r.status}`)
    .sort()
    .join('|')
  let h = 0
  for (let i = 0; i < material.length; i++) h = (Math.imul(31, h) + material.charCodeAt(i)) | 0
  return `att${(h >>> 0).toString(16)}`
}

export default {
  key: 'attendance',
  label: 'Class Attendance',
  route: '/attendance',
  requires: { module: 'attendance', action: 'view' },
  // shown on a task the assignee cannot yet complete, so the message is a way
  // forward rather than a dead end
  cta: { label: 'Open Attendance', route: '/attendance' },
  // API paths that DO the work this module verifies. The logout gate lets these
  // through for anyone who owes a task bound to this module — otherwise a
  // mandatory "mark attendance" task left over from yesterday would freeze the
  // very endpoint needed to clear it.
  writePaths: [/^\/attendance(\/|$)/],

  signals: {
    isMarked: {
      // Reads as an option under Attendance -> Class attendance, so this label
      // is the sentence that finishes "how do we know it is done?"
      label: 'every child on the register is marked',
      // The activity this is the STRICT version of. The picker shows it inside
      // that module's own list rather than as a rival top-level choice —
      // attendance is a module like any other, and offering it twice was the
      // confusion. Same question, two strengths of answer.
      verifies: { collection: 'attendanceRecords' },
      strictNote: 'Checks the whole register — not just that somebody opened it.',
      // {param} placeholders are filled with the bound source's label, so the
      // assigner reads a sentence rather than a binding table
      phrase: 'attendance is marked for {sectionId} on {date}',
      event: 'attendance.marked',
      params: [
        { name: 'sectionId', type: 'section', label: 'Class / section', bind: 'assignee.section', required: true },
        { name: 'date', type: 'date', label: 'Date', bind: 'instance.serviceDate', required: true },
      ],

      // THE pull. Returns evidence, never a bare boolean: what satisfied it,
      // how many children, and a fingerprint of the state it saw.
      read(params) {
        const sectionIds = asArray(params.sectionId)
        const date = params.date
        if (!sectionIds.length || !date) {
          return { satisfied: false, message: 'No register is linked to this person', evidence: null }
        }

        const per = []
        for (const sectionId of sectionIds) {
          // the roster is who is actually on the books for that section today
          const roster = list('enrolments', (e) => e.sectionId === sectionId && !e.leftAt)
          const rows = list('attendanceRecords', (r) => r.sectionId === sectionId && r.date === date && MARKED.has(r.status))
          const marked = new Set(rows.map((r) => r.studentId))
          const pending = roster.filter((e) => !marked.has(e.studentId))
          per.push({ sectionId, roster: roster.length, rows, pending: pending.length })
        }

        // A teacher who keeps two registers, one of which is empty, has done the
        // job when the one with children in it is marked. An empty register is
        // only a problem when EVERY register is empty — then there is nothing
        // to verify, and saying so beats silently passing the task.
        const withChildren = per.filter((p) => p.roster > 0)
        const considered = withChildren.length ? withChildren : per
        const incomplete = considered.filter((p) => p.roster === 0 || p.pending > 0)
        const rows = considered.flatMap((p) => p.rows)

        if (incomplete.length) {
          const p = incomplete[0]
          const message = p.roster === 0
            ? 'No children are enrolled in your register, so there is nothing to mark. Ask the office if that looks wrong.'
            : `${p.pending} of ${p.roster} children are still unmarked. Open Attendance and mark it first.`
          return {
            satisfied: false,
            message,
            evidence: rows.length
              ? { collection: 'attendanceRecords', recordIds: rows.map((r) => r.id), count: rows.length, partial: true }
              : null,
          }
        }

        const last = rows.reduce((a, b) => ((a?.updatedAt || a?.createdAt || '') > (b.updatedAt || b.createdAt || '') ? a : b), rows[0])
        return {
          satisfied: true,
          message: `Attendance marked for ${rows.length} child${rows.length === 1 ? '' : 'ren'} on ${date}`,
          evidence: {
            collection: 'attendanceRecords',
            recordIds: rows.map((r) => r.id),
            count: rows.length,
            checksum: checksum(rows),
            markedByUserId: last?.markedBy || null,
            markedAt: last?.updatedAt || last?.createdAt || null,
            summary: considered.map((p) => `${p.rows.length}/${p.roster} in ${p.sectionId}`).join(', '),
          },
        }
      },
    },
  },

  actions: {},

  guards: {
    editRequiresApproval: {
      label: 'The register for that day',
      // WHAT gets locked, resolved with the same binding machinery the signal
      // uses. The lock covers the whole register for that date, not one child's
      // row — changing any one of them changes what the task was verified on.
      appliesTo: { collection: 'attendanceRecords', ops: ['create', 'update', 'delete'] },
      params: [
        { name: 'sectionId', type: 'section', label: 'Class / section', bind: 'assignee.section', required: true },
        { name: 'date', type: 'date', label: 'Date', bind: 'instance.serviceDate', required: true },
      ],
    },
  },
}
