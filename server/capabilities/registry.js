// Capability registry — the seam between the task engine and feature modules.
//
// The task engine reads THIS file. It never imports attendance, daycare or any
// other feature module. A module opts in by shipping a descriptor
// (`<mod>.cap.js`) and adding one line to `index.js`; everything downstream —
// the create-task form, the binding preview, verification — is driven off what
// the descriptor declares, so adding a module is config, not a refactor.
//
// A descriptor declares three things:
//   signals — verifiable state queries        ("attendance is marked for 3A today")
//   actions — side effects to fire on completion ("notify the parents")
//   guards  — cross-module rules              ("editing this needs approval")
//
// Signals may declare `implemented: false`. That means: bindable and saveable
// today, but not yet readable — the engine answers `not_yet_verifiable` instead
// of pretending. Verification lands in the next slice.

export class CapabilityError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

// Where a bound parameter gets its value at verification time. This vocabulary
// is shared with the UI: the form renders these labels, so the assigner reads
// "the assignee's class" rather than a variable name.
export const BIND_SOURCES = {
  'instance.serviceDate': { label: 'the task’s date', types: ['date'] },
  'instance.dueDate': { label: 'the task’s deadline', types: ['date'] },
  'assignee.section': { label: 'the assignee’s class', types: ['section'] },
  'assignee.node': { label: 'the assignee’s school', types: ['node'] },
  'assignee.user': { label: 'the assignee', types: ['user'] },
  literal: { label: 'a fixed value', types: ['date', 'section', 'node', 'user', 'text', 'number'] },
}

const modules = new Map()

function fail(msg) {
  throw new Error(`[capabilities] ${msg}`)
}

// Boot-time validation. A malformed descriptor must break the server start, not
// surface as a confusing 500 the first time somebody builds a task on it.
function validateParam(modKey, sigKey, p) {
  if (!p?.name) fail(`${modKey}.${sigKey}: every param needs a name`)
  if (!p.type) fail(`${modKey}.${sigKey}.${p.name}: every param needs a type`)
  if (p.bind && !BIND_SOURCES[p.bind]) fail(`${modKey}.${sigKey}.${p.name}: unknown bind source "${p.bind}"`)
}

export function registerModule(descriptor) {
  const key = descriptor?.key
  if (!key) fail('a descriptor needs a key')
  if (modules.has(key)) fail(`duplicate module key "${key}"`)

  for (const [sigKey, sig] of Object.entries(descriptor.signals || {})) {
    if (!sig.label) fail(`${key}.${sigKey}: signals need a label`)
    if (!sig.phrase) fail(`${key}.${sigKey}: signals need a phrase for the plain-language preview`)
    if (sig.implemented !== false && typeof sig.read !== 'function') {
      fail(`${key}.${sigKey}: an implemented signal needs read()`)
    }
    for (const p of sig.params || []) validateParam(key, sigKey, p)
  }
  for (const [actKey, act] of Object.entries(descriptor.actions || {})) {
    if (act.implemented !== false && typeof act.run !== 'function') fail(`${key}.${actKey}: an implemented action needs run()`)
  }
  for (const [gKey, g] of Object.entries(descriptor.guards || {})) {
    if (!g.appliesTo?.collection) fail(`${key}.${gKey}: a guard needs appliesTo.collection`)
  }

  modules.set(key, { signals: {}, actions: {}, guards: {}, ...descriptor })
  return descriptor
}

export const listModules = () => [...modules.values()]
export const getModule = (key) => modules.get(key) || null
export const getSignal = (moduleKey, signalKey) => modules.get(moduleKey)?.signals?.[signalKey] || null
export const getAction = (moduleKey, actionKey) => modules.get(moduleKey)?.actions?.[actionKey] || null
export const getGuard = (moduleKey, guardKey) => modules.get(moduleKey)?.guards?.[guardKey] || null

// Test seam only — production registers once at import time.
export function resetRegistry() {
  modules.clear()
}

// ---------------------------------------------------------------- catalogue --
// The JSON-safe half of the registry: keys, labels, params, bind sources. No
// functions. This is what the create-task form renders itself from.
export function catalogue() {
  return {
    bindSources: Object.entries(BIND_SOURCES).map(([key, v]) => ({ key, ...v })),
    // ONE flat list of things the system can check for itself, already written
    // as a sentence. A person picking "what proves this is done" should not have
    // to choose a module and then a signal — especially when a module has one.
    verifiable: listModules().flatMap((m) =>
      Object.entries(m.signals)
        .filter(([, s]) => s.internal !== true)
        .map(([key, s]) => ({
          moduleKey: m.key,
          signalKey: key,
          moduleLabel: m.label,
          label: s.label,
          sentence: `Completes when ${describeSignal(m.key, key, {})}`,
          implemented: s.implemented !== false,
          // 'complete' knows what finished looks like; 'performed' only knows the
          // work was touched. The form must not present them as the same promise.
          precision: s.precision === 'performed' ? 'performed' : 'complete',
          // which activity this is the strict check for, so the form can show
          // it under that module instead of as a separate kind of check
          verifies: s.verifies || null,
          strictNote: s.strictNote || null,
          route: m.route || null,
          params: (s.params || []).map((p) => ({
            name: p.name, type: p.type, bind: p.bind || null, required: p.required !== false, label: p.label || p.name,
          })),
        }))),
    modules: listModules().map((m) => ({
      key: m.key,
      label: m.label,
      route: m.route || null,
      signals: Object.entries(m.signals).map(([key, s]) => ({
        key,
        label: s.label,
        phrase: s.phrase,
        event: s.event || null,
        implemented: s.implemented !== false,
        internal: s.internal === true,
        params: (s.params || []).map((p) => ({
          name: p.name, type: p.type, bind: p.bind || null, required: p.required !== false, label: p.label || p.name,
        })),
      })),
      actions: Object.entries(m.actions).map(([key, a]) => ({
        key, label: a.label, implemented: a.implemented !== false,
        params: (a.params || []).map((p) => ({ name: p.name, type: p.type, bind: p.bind || null, required: p.required !== false })),
      })),
      guards: Object.entries(m.guards).map(([key, g]) => ({
        key, label: g.label, collection: g.appliesTo.collection, ops: g.appliesTo.ops || [],
        implemented: g.implemented !== false,
      })),
    })),
  }
}

// ------------------------------------------------------------ plain language --
// "completes when attendance is marked for the assignee's class on the task's
// date" — built from the signal's own phrase plus the bound source labels, so
// the sentence updates itself when a module changes its bindings.
export function describeSignal(moduleKey, signalKey, paramBinding = {}) {
  const sig = getSignal(moduleKey, signalKey)
  if (!sig) return null
  let phrase = sig.phrase
  for (const p of sig.params || []) {
    const bound = paramBinding[p.name] || { source: p.bind }
    const label = bound.source === 'literal'
      ? `“${bound.value ?? '—'}”`
      : BIND_SOURCES[bound.source]?.label || p.name
    phrase = phrase.replaceAll(`{${p.name}}`, label)
  }
  return phrase
}

// ------------------------------------------------------------------ runtime --
// Resolve a declared binding against one occurrence. Kept here (not in tasks/)
// because the vocabulary belongs to the registry.
export function resolveBinding(signal, paramBinding = {}, ctx = {}) {
  const params = {}
  const missing = []
  for (const p of signal.params || []) {
    const bound = paramBinding[p.name] || (p.bind ? { source: p.bind } : null)
    let value = null
    if (!bound) value = null
    else if (bound.source === 'literal') value = bound.value ?? null
    else if (bound.source === 'instance.serviceDate') value = ctx.instance?.serviceDate ?? null
    else if (bound.source === 'instance.dueDate') value = ctx.instance?.dueAt ?? null
    else if (bound.source === 'assignee.user') value = ctx.instance?.assigneeUserId ?? null
    else if (bound.source === 'assignee.node') value = ctx.instance?.assigneeNodeId ?? null
    else if (bound.source === 'assignee.section') value = ctx.assigneeSectionId ?? null
    if ((value === null || value === undefined || value === '') && p.required !== false) missing.push(p.name)
    params[p.name] = value
  }
  return { params, missing }
}

export function readSignal(moduleKey, signalKey, paramBinding, ctx = {}) {
  const sig = getSignal(moduleKey, signalKey)
  if (!sig) throw new CapabilityError(422, 'unknown_signal', `No such signal: ${moduleKey}.${signalKey}`)
  if (sig.implemented === false) {
    throw new CapabilityError(422, 'not_yet_verifiable', `${describeSignal(moduleKey, signalKey, paramBinding)} — automatic verification is not wired up yet`)
  }
  const { params, missing } = resolveBinding(sig, paramBinding, ctx)
  if (missing.length) throw new CapabilityError(422, 'unbound_params', `Cannot verify: ${missing.join(', ')} could not be resolved for this assignee`)
  return sig.read(params, ctx)
}

export function runAction(moduleKey, actionKey, paramBinding, ctx = {}) {
  const act = getAction(moduleKey, actionKey)
  if (!act) throw new CapabilityError(422, 'unknown_action', `No such action: ${moduleKey}.${actionKey}`)
  if (act.implemented === false) throw new CapabilityError(422, 'action_not_implemented', `${moduleKey}.${actionKey} is declared but not wired up yet`)
  const { params } = resolveBinding(act, paramBinding, ctx)
  return act.run(params, ctx)
}

// Feature modules call this from their own write path — the engine cannot stop
// a write it never sees. One line next to the emit() they already need.
export function checkGuards(collection, op, record, ctx = {}) {
  const hits = []
  for (const m of listModules()) {
    for (const [key, g] of Object.entries(m.guards)) {
      if (g.appliesTo.collection !== collection) continue
      if (g.appliesTo.ops && !g.appliesTo.ops.includes(op)) continue
      if (g.implemented === false || typeof g.check !== 'function') continue
      const result = g.check(record, ctx)
      if (result?.locked) hits.push({ moduleKey: m.key, guardKey: key, ...result })
    }
  }
  return hits
}
