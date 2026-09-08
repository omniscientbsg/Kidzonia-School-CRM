// Priorities as master data.
//
// They used to be four hardcoded strings. Making them a table means a school can
// rename "Urgent" to "Drop everything", recolour it, or add a fifth rung — but
// the ORDER has to survive that, so sorting keys off `rank` and never off the
// name or the id. Low rank = more urgent, matching how the org tree already
// treats rank.
//
// THE ID SUFFIX IS THE OLD STRING ON PURPOSE. `prio-urgent` rather than a uuid,
// so the migration is a prefix rewrite, an audit row written before the change
// still reads sensibly next to one written after, and anyone debugging a stored
// task can see what it means without a join.
import { list, find } from '../db.js'

export const SEEDED_PRIORITIES = [
  { id: 'prio-urgent', name: 'Urgent', rank: 10, color: '#e5484d', isDefault: false, active: true },
  { id: 'prio-high', name: 'High', rank: 20, color: '#f4772e', isDefault: false, active: true },
  { id: 'prio-normal', name: 'Normal', rank: 30, color: null, isDefault: true, active: true },
  { id: 'prio-low', name: 'Low', rank: 40, color: '#8b84a3', isDefault: false, active: true },
]

// The four strings tasks were stored with before the master existed.
export const LEGACY_PRIORITY_IDS = {
  urgent: 'prio-urgent',
  high: 'prio-high',
  normal: 'prio-normal',
  low: 'prio-low',
}

export const DEFAULT_PRIORITY_ID = 'prio-normal'

// Sorted by rank, most urgent first. This is the order every picker shows and
// every "worst first" list uses.
export function priorityList() {
  return list('taskPriorities', (p) => p.active !== false)
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || String(a.name).localeCompare(String(b.name)))
}

// Accepts an id, or one of the four legacy strings, and answers with a row.
// Tolerating the old strings is what lets the migration, the seed and an
// un-updated client all agree without a second lookup table.
export function resolvePriority(value) {
  if (!value) return find('taskPriorities', DEFAULT_PRIORITY_ID) || null
  return find('taskPriorities', value)
    || find('taskPriorities', LEGACY_PRIORITY_IDS[value] || '')
    || null
}

// The id to store. Falls back to the row marked default, then to the seeded one,
// so a database whose master has been edited still normalizes to something real.
export function priorityIdOf(value) {
  const row = resolvePriority(value)
  if (row) return row.id
  return priorityList().find((p) => p.isDefault)?.id || DEFAULT_PRIORITY_ID
}

// What a list row needs to render and sort without fetching the master itself.
export function describePriority(value) {
  const row = resolvePriority(value)
  if (!row) return { priorityId: value || null, priorityName: null, priorityColor: null, priorityRank: 999 }
  return { priorityId: row.id, priorityName: row.name, priorityColor: row.color || null, priorityRank: row.rank ?? 999 }
}
