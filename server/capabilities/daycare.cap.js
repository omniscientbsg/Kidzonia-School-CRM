// Capability descriptor for Day Care.
//
// Ships the first ACTION: a side effect the task engine fires when a task
// completes. Like the attendance signal, it is allowed to know day-care
// internals; the engine only ever sees what is declared here.
//
// The action goes out through the app's existing notification layer
// (`server/notify.js` → notifications + notificationLog), so parents get it in
// the same inbox as every other message and the per-channel send log records it
// exactly as it records everything else. No parallel messaging path.
import { list, find } from '../db.js'
import { notifyGuardiansOfStudent, guardianUserIdsOfStudent } from '../notify.js'

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])

export default {
  key: 'daycare',
  label: 'Day Care',
  route: '/daycare',
  requires: { module: 'daycare', action: 'view' },
  cta: { label: 'Open Day Care', route: '/daycare' },

  signals: {},

  actions: {
    notifyParents: {
      label: 'Tell parents their child was fed',
      // What the parent receives. Deliberately declared here and not in the
      // task, so the wording of a day-care message stays with day care.
      params: [
        { name: 'sectionId', type: 'section', label: 'Day-care group', bind: 'assignee.section', required: true },
        { name: 'date', type: 'date', label: 'Date', bind: 'instance.serviceDate', required: true },
      ],

      run(params, ctx) {
        const sectionIds = asArray(params.sectionId)
        const date = params.date
        if (!sectionIds.length) return { ok: false, reason: 'no_group', recipients: [], studentIds: [], summary: 'No day-care group is linked to this person' }

        const studentIds = []
        for (const sectionId of sectionIds) {
          for (const e of list('enrolments', (x) => x.sectionId === sectionId && !x.leftAt)) studentIds.push(e.studentId)
        }
        if (!studentIds.length) return { ok: false, reason: 'empty_group', recipients: [], studentIds: [], summary: 'No children are enrolled in that group' }

        const recipients = new Set()
        let sent = 0
        for (const studentId of studentIds) {
          const student = find('students', studentId)
          const first = student?.firstName || 'Your child'
          const rows = notifyGuardiansOfStudent(studentId, {
            title: `${first} has had lunch`,
            body: `${first} was given lunch at day care on ${date}.${ctx.note ? ` ${ctx.note}` : ''}`,
            type: 'daycare',
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
