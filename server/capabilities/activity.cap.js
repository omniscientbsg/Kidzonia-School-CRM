// The generic verifier: "did this person do that thing, in that module, today".
//
// This is the answer to "why can only Attendance be checked?" — it can check
// ANY module, because it reads the central activity trail rather than knowing
// anything about the module in question. Picking a module, a thing and an action
// in the form is the whole configuration.
//
// WHAT IT PROVES, precisely: that the work was DONE AT ALL. It cannot know what
// finished looks like — one attendance row is not a marked register. Where that
// distinction matters, a module ships a hand-written signal (attendance.isMarked)
// and the form offers it as the stronger option. Both are honest; they answer
// different questions, and the UI says which is which.
import { list } from '../db.js'
import { ACTIVITIES, describeActivity } from './activities.js'

export default {
  key: 'activity',
  label: 'Any module',
  route: null,
  cta: null,

  signals: {
    performed: {
      label: 'They did something in a module',
      // filled in from the chosen binding — the form shows the real sentence
      phrase: 'they have done it in the app on {date}',
      precision: 'performed',
      params: [
        { name: 'collection', type: 'text', label: 'What', bind: 'literal', required: true },
        { name: 'op', type: 'text', label: 'Action', bind: 'literal', required: false },
        { name: 'scope', type: 'text', label: 'For their class', bind: 'literal', required: false },
        { name: 'by', type: 'user', label: 'Who', bind: 'assignee.user', required: true },
        { name: 'date', type: 'date', label: 'When', bind: 'instance.serviceDate', required: true },
      ],

      read(params, ctx) {
        const { collection, by, date } = params
        const op = params.op && params.op !== 'any' ? params.op : null
        const meta = ACTIVITIES[collection]
        if (!meta) return { satisfied: false, message: 'That activity is no longer available', evidence: null }

        // "for their class" narrows to the sections this person actually keeps
        const scoped = String(params.scope) === 'true' && !!meta.scopeKey
        const sections = scoped ? (ctx.assigneeSectionIds || []) : null
        if (scoped && !sections.length) {
          return { satisfied: false, message: 'No class is linked to this person, so this cannot be checked', evidence: null }
        }

        const rows = list('activityLog', (a) =>
          a.collection === collection &&
          a.userId === by &&
          a.date === date &&
          (!op || a.op === op) &&
          (!scoped || sections.includes(a.scopeId)))

        const what = describeActivity({ collection, op: params.op, scoped })
        if (!rows.length) {
          return {
            satisfied: false,
            message: `Not done yet — this finishes once ${what}. Open ${meta.label.toLowerCase()} and do it.`,
            evidence: null,
          }
        }

        const last = rows[rows.length - 1]
        return {
          satisfied: true,
          message: `Done — ${rows.length} ${meta.label.toLowerCase()}${rows.length === 1 ? '' : 's'} on ${date}`,
          evidence: {
            collection: 'activityLog',
            recordIds: rows.map((r) => r.id),
            count: rows.length,
            // the ids of the ACTUAL records touched, so the evidence points at
            // the work rather than at our own log
            subjectIds: rows.map((r) => r.recordId).filter(Boolean),
            checksum: `act:${collection}:${rows.length}:${last.at}`,
            markedByUserId: by,
            markedAt: last.at,
            summary: `${rows.length} × ${meta.label} on ${date}`,
          },
        }
      },
    },
  },

  actions: {},
  guards: {},
}
