// Telling parents something, when a task finishes.
//
// This replaces a day-care action whose message was hardcoded to "your child was
// fed" — which meant a task verified against ATTENDANCE could be set to tell
// parents about lunch. The action asserted a fact it had no way to know.
//
// Now it asserts nothing. The person assigning the task writes the message, so
// it can never contradict what the task actually checks, and it works on any
// task in any module.
import { list, find } from '../db.js'
import { notifyGuardiansOfStudent, guardianUserIdsOfStudent } from '../notify.js'

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])

// What an author may drop into their message. Kept small and obvious — anything
// unknown is left alone rather than blanked, so a stray brace is visible instead
// of silently eating text.
export const PLACEHOLDERS = {
  '{child}': 'the child’s first name',
  '{class}': 'their class',
  '{date}': 'the date',
  '{staff}': 'who did it',
}

export function fillMessage(template, { childName, className, date, staffName }) {
  return String(template || '')
    .replaceAll('{child}', childName || 'Your child')
    .replaceAll('{class}', className || 'their class')
    .replaceAll('{date}', date || '')
    .replaceAll('{staff}', staffName || 'the staff')
}

export default {
  key: 'parents',
  label: 'Parents',
  route: null,
  cta: null,

  signals: {},

  actions: {
    notify: {
      label: 'Tell parents when this is done',
      // the message is per-task, not per-action: it lives in the task's config
      configFields: [
        { name: 'message', type: 'textarea', label: 'What should parents be told?', required: true, placeholders: PLACEHOLDERS },
      ],
      params: [
        { name: 'sectionId', type: 'section', label: 'Whose parents', bind: 'assignee.section', required: true },
        { name: 'date', type: 'date', label: 'Date', bind: 'instance.serviceDate', required: true },
      ],

      run(params, ctx) {
        const message = String(ctx.config?.message || '').trim()
        if (!message) return { ok: false, reason: 'no_message', recipients: [], studentIds: [], summary: 'No message was written' }

        const sectionIds = asArray(params.sectionId)
        if (!sectionIds.length) return { ok: false, reason: 'no_class', recipients: [], studentIds: [], summary: 'No class is linked to this person' }

        const studentIds = []
        for (const sectionId of sectionIds) {
          for (const e of list('enrolments', (x) => x.sectionId === sectionId && !x.leftAt)) studentIds.push(e.studentId)
        }
        if (!studentIds.length) return { ok: false, reason: 'empty_class', recipients: [], studentIds: [], summary: 'No children are enrolled' }

        const staffName = find('users', ctx.assigneeUserId)?.name || null
        const recipients = new Set()
        let sent = 0
        for (const studentId of studentIds) {
          const student = find('students', studentId)
          const enr = list('enrolments', (x) => x.studentId === studentId && !x.leftAt)[0]
          const cls = enr ? find('classes', enr.classId) : null

          const body = fillMessage(message, {
            childName: student?.firstName,
            className: cls?.name,
            date: params.date,
            staffName,
          })
          const rows = notifyGuardiansOfStudent(studentId, {
            title: `Update about ${student?.firstName || 'your child'}`,
            body,
            type: 'task_update',
            refType: 'taskInstance',
            refId: ctx.instanceId || null,
          })
          sent += rows.length
          for (const uid of guardianUserIdsOfStudent(studentId)) recipients.add(uid)
        }

        return {
          ok: true,
          recipients: [...recipients],
          studentIds,
          notifications: sent,
          summary: `Told the parents of ${studentIds.length} child${studentIds.length === 1 ? '' : 'ren'} (${recipients.size} guardian account${recipients.size === 1 ? '' : 's'})`,
        }
      },
    },
  },

  guards: {},
}
