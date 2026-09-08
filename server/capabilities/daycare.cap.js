// Capability descriptor for Day Care.
//
// It used to ship a `notifyParents` action labelled "Tell parents their child
// was fed". That is gone: `parents.notify` says "Tell parents when this is
// done" and carries a message the assigner writes, which covers the lunch case
// and every other case, and can never assert a fact the task did not check.
// One way to tell parents something, not one per module.
//
// The file stays because Day Care still has a route and a CTA the engine shows
// on a task somebody cannot yet complete, and because this is where a real
// day-care SIGNAL will go when there is one worth writing.

export default {
  key: 'daycare',
  label: 'Day Care',
  route: '/daycare',
  requires: { module: 'daycare', action: 'view' },
  cta: { label: 'Open Day Care', route: '/daycare' },

  signals: {},
  actions: {},
  guards: {},
}
