// In-process event bus for module signals.
//
// A feature module calls emit() from its own write path; anything that cares
// subscribes by topic. Deliberately tiny, and deliberately NOT the authority:
// every push is re-checked by a pull before it is believed (see
// server/tasks/verify.js), so a dropped, duplicated or out-of-order event can
// delay a verification but can never fake one.
//
// LIMITS — this is an in-process emitter, not a queue:
//   * synchronous: a slow subscriber slows the request that emitted
//   * dies with the process; nothing replays what was missed
//   * multi-instance deploys each see only their own writes
// The catch-up sweep in syncTasks() and the pull guard on submit are what make
// those limits survivable. For production, swap this for a real broker behind
// the same emit()/on() shape.

const handlers = new Map()

export function on(topic, handler) {
  if (!handlers.has(topic)) handlers.set(topic, new Set())
  handlers.get(topic).add(handler)
  return () => handlers.get(topic)?.delete(handler)
}

export function emit(topic, payload = {}) {
  const subs = handlers.get(topic)
  if (!subs?.size) return { topic, delivered: 0 }
  let delivered = 0
  for (const handler of subs) {
    try {
      handler(payload, topic)
      delivered++
    } catch (err) {
      // A subscriber must never break the write that emitted. Attendance being
      // marked is the important thing; a task not auto-ticking is recoverable
      // by the sweep and by the pull check on submit.
      console.error(`[capabilities] subscriber for "${topic}" failed:`, err.message)
    }
  }
  return { topic, delivered }
}

export const topics = () => [...handlers.keys()]
export const clearSubscribers = () => handlers.clear()
