import crypto from 'node:crypto'

// A task occurrence is identified by (template, assignee position, local date).
// Deriving the id from that triple is what makes generation idempotent on a
// store with no unique indexes: running it twice converges instead of doubling.
// Kept dependency-free so the seed can use it without importing the db layer.
export const instanceId = (taskId, positionId, occurrenceKey) =>
  `ti_${crypto.createHash('sha1').update(`${taskId}|${positionId}|${occurrenceKey}`).digest('hex').slice(0, 16)}`
