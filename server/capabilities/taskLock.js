// THE opt-in interface for record locks — the entire cross-module surface.
//
// A feature module that wants its records protected calls exactly one function
// from its own write path:
//
//     const gate = taskLock.check('attendance', { collection: 'attendanceRecords', sectionId, date }, { user })
//     if (gate.locked) return res.status(423).json(gate.response)
//
// That is the whole coupling. Attendance does not import the task engine, does
// not know what a task instance is, and does not know how a lock is lifted. The
// engine registers itself as the provider at boot; with no provider registered
// nothing is ever locked, so a module can be wired before the engine is.
//
// check() is deliberately ONE call, not check-then-consume: a granted re-edit is
// spent by the same call that authorises it. That fails closed — a write that
// errors after being authorised still burns the grant, which is the safe way
// round for something that exists to stop silent edits.

const NO_LOCK = Object.freeze({ locked: false, grant: null })

let provider = null

export function registerLockProvider(fn) {
  provider = fn
  return () => { provider = null }
}

export const hasLockProvider = () => !!provider

// moduleKey  — who owns the record
// ref        — { collection, ...keys } identifying WHAT is being edited. Keys
//              are matched as a subset, so a lock on
//              { collection, sectionId, date } catches an edit to any record in
//              that section on that date.
// ctx.user   — who is editing (a grant is personal)
// ctx.peek   — true to ask without spending a grant (for read-only UI)
export function check(moduleKey, ref, ctx = {}) {
  if (!provider) return NO_LOCK
  try {
    return provider(moduleKey, ref, ctx) || NO_LOCK
  } catch (err) {
    // A broken lock provider must not take the owning module down with it. Fail
    // OPEN: the record stays editable and the failure is loud in the log.
    console.error(`[taskLock] provider failed for ${moduleKey}:`, err.message)
    return NO_LOCK
  }
}

// Canonical string form of a ref, used as the lock's match key.
export function refKey(ref = {}) {
  const { collection, ...keys } = ref
  const parts = Object.entries(keys)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
  return [collection, ...parts].join('|')
}

// Does a lock's scope cover this edit? Subset match: every key the LOCK names
// must match the ref. A lock on the whole section+date covers every child in it.
export function refMatches(scope = {}, ref = {}) {
  if (scope.collection !== ref.collection) return false
  for (const [k, v] of Object.entries(scope)) {
    if (k === 'collection') continue
    if (String(ref[k]) !== String(v)) return false
  }
  return true
}

export default { check, refKey, refMatches, registerLockProvider, hasLockProvider }
