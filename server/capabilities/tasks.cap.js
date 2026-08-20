// The task engine as a capability module.
//
// This exists so escalation can hang a mandatory task on a slow approver that
// CLEARS ITSELF the moment they decide — no human has to remember to close it.
// It is also the proof that the registry is not attendance-shaped: the engine
// consumes its own descriptor through exactly the same path a feature module
// would.
import { list, find } from '../db.js'

export default {
  key: 'tasks',
  label: 'Tasks',
  route: '/tasks',
  cta: { label: 'Open Approvals', route: '/tasks/approvals' },

  signals: {
    approvalCleared: {
      label: 'The approval has been decided',
      phrase: 'the approval it is chasing has been decided',
      // Not offered in the create-task form: it binds to a specific occurrence
      // id, which is something the engine knows and a person never would.
      internal: true,
      params: [
        { name: 'instanceId', type: 'text', label: 'Occurrence', bind: 'literal', required: true },
      ],
      read(params) {
        const inst = find('taskInstances', params.instanceId)
        if (!inst) {
          // the thing it was chasing is gone; nothing left to hold anyone to
          return { satisfied: true, message: 'That task no longer exists', evidence: null }
        }
        if (inst.status === 'submitted') {
          return {
            satisfied: false,
            message: `“${inst.title}” from ${inst.assigneeName} is still waiting on your decision. Open Approvals and approve or send it back.`,
            evidence: null,
          }
        }
        const decision = list('taskApprovals', { instanceId: inst.id })
          .sort((a, b) => (a.decidedAt || '').localeCompare(b.decidedAt || ''))
          .pop()
        return {
          satisfied: true,
          message: `Decided: ${inst.status}`,
          evidence: {
            collection: 'taskInstances',
            recordIds: [inst.id],
            count: 1,
            checksum: `dec:${inst.status}:${decision?.id || 'none'}`,
            markedByUserId: decision?.approverUserId || null,
            markedAt: decision?.decidedAt || inst.decidedAt || null,
            summary: `${inst.title} → ${inst.status}`,
          },
        }
      },
    },
  },

  actions: {},
  guards: {},
}
