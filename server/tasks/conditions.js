// How we know a task is done.
//
// TWO ORTHOGONAL AXES, and nothing in here reads the other one:
//   origin  — where the task came from: 'manual' (one-off) or 'automated'
//             (generated from a recurrence). Lives on the task, set in model.js.
//   nature  — how completion is verified: 'mcq' | 'module_linked' | 'custom'.
//             That is this file.
// Any origin may carry any nature. A daily recurring task can be module_linked;
// a one-off can be an MCQ.
//
//   mcq           self-attested answer from an option set, optionally with media
//   module_linked completion gated on a real system signal from another module.
//                 The answer is DERIVED and read-only — doing the work in the
//                 module is what flips it.
//   custom        a condition we define at creation: a statement, a checklist
//                 the assignee must tick, and optionally a written note.
//
// Media stays on task.requiresMedia / minAttachments where it already lives and
// is already enforced. `mcq.requireMedia` sets those fields — one media rule,
// one enforcement point, no second implementation to disagree with the first.
import { getSignal, getAction, getGuard, getModule, describeSignal, BIND_SOURCES } from '../capabilities/index.js'

export const NATURES = ['mcq', 'module_linked', 'custom']
export const ORIGINS = ['manual', 'automated']

const text = (v) => String(v ?? '').trim()
const slugify = (s, i) => (text(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `item-${i + 1}`).slice(0, 40)

// Default option set, used when a form sends only requiredAnswer.
const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]

// ---------------------------------------------------------------- normalize --
function normalizeMcq(src = {}, errors) {
  const question = text(src.question)
  if (!question) errors.push('the MCQ needs a question')

  let options = Array.isArray(src.options) && src.options.length ? src.options : YES_NO
  const seen = new Set()
  options = options.map((o, i) => {
    const value = text(o.value) || slugify(o.label, i)
    return { value, label: text(o.label) || value, accepts: !!o.accepts }
  }).filter((o) => {
    if (seen.has(o.value)) return false
    seen.add(o.value)
    return true
  })
  if (options.length < 2) errors.push('an MCQ needs at least two options')

  // requiredAnswer is the primary accepting option; extra options may also
  // accept, which is how "Yes / Not applicable" works
  let requiredAnswer = text(src.requiredAnswer)
  if (requiredAnswer && !options.some((o) => o.value === requiredAnswer)) {
    errors.push(`requiredAnswer "${requiredAnswer}" is not one of the options`)
    requiredAnswer = ''
  }
  if (requiredAnswer) options = options.map((o) => (o.value === requiredAnswer ? { ...o, accepts: true } : o))
  if (!requiredAnswer) requiredAnswer = options.find((o) => o.accepts)?.value || ''
  if (!options.some((o) => o.accepts)) errors.push('mark at least one option as completing the task')

  return { question, options, requiredAnswer, requireMedia: !!src.requireMedia }
}

function normalizeBinding(params = [], src = {}, errors, label) {
  const binding = {}
  const known = new Set(params.map((p) => p.name))
  for (const name of Object.keys(src)) {
    if (!known.has(name)) errors.push(`${label}: "${name}" is not a parameter of that signal`)
  }
  for (const p of params) {
    const bound = src[p.name] || (p.bind ? { source: p.bind } : null)
    if (!bound) {
      if (p.required !== false) errors.push(`${label}: "${p.name}" has nothing bound to it`)
      continue
    }
    const source = text(bound.source)
    if (!BIND_SOURCES[source]) { errors.push(`${label}: unknown binding "${source}" for ${p.name}`); continue }
    if (source === 'literal' && !text(bound.value)) { errors.push(`${label}: give ${p.name} a fixed value`); continue }
    binding[p.name] = source === 'literal' ? { source, value: text(bound.value) } : { source }
  }
  return binding
}

function normalizeModuleLinked(src = {}, errors) {
  const moduleKey = text(src.moduleKey)
  const signalKey = text(src.signalKey)
  if (!moduleKey || !signalKey) {
    errors.push('pick a module and a signal')
    return { moduleKey: moduleKey || null, signalKey: signalKey || null, paramBinding: {}, derivedMcq: null, autoSubmit: true }
  }
  const sig = getSignal(moduleKey, signalKey)
  if (!sig) {
    errors.push(`no such signal: ${moduleKey}.${signalKey}`)
    return { moduleKey, signalKey, paramBinding: {}, derivedMcq: null, autoSubmit: true }
  }
  const paramBinding = normalizeBinding(sig.params || [], src.paramBinding || {}, errors, `${moduleKey}.${signalKey}`)
  // The derived MCQ is display-only: the tick is READ from the signal, never
  // typed by the assignee. Hence readOnly is not configurable.
  const derivedMcq = src.derivedMcq
    ? { question: text(src.derivedMcq.question) || sig.label, readOnly: true }
    : null
  return {
    moduleKey,
    signalKey,
    paramBinding,
    derivedMcq,
    autoSubmit: src.autoSubmit !== false,
  }
}

function normalizeCustom(src = {}) {
  // An empty statement is legal and means exactly what it did before natures
  // existed: the assignee's word, nothing extra. Forcing every "bring the
  // register to the office" task to carry a written definition would be noise.
  const statement = text(src.statement) || 'Marked done by the assignee'
  const ids = new Set()
  const checklist = (Array.isArray(src.checklist) ? src.checklist : []).map((c, i) => {
    let id = text(c.id) || slugify(c.text, i)
    while (ids.has(id)) id = `${id}-${i}`
    ids.add(id)
    return { id, text: text(c.text), required: c.required !== false }
  }).filter((c) => c.text)
  const requireNote = !!src.requireNote
  return { statement, checklist, requireNote, noteLabel: text(src.noteLabel) || 'What did you do?' }
}

function normalizeHooks(src, errors, kind, condition = null) {
  const rows = Array.isArray(src) ? src : []
  return rows.map((r) => {
    const moduleKey = text(r.moduleKey)
    const key = text(kind === 'action' ? r.actionKey : r.guardKey)
    const found = kind === 'action' ? getAction(moduleKey, key) : getGuard(moduleKey, key)
    if (!found) {
      errors.push(`no such ${kind}: ${moduleKey || '?'}.${key || '?'}`)
      return null
    }
    const paramBinding = normalizeBinding(found.params || [], r.paramBinding || {}, errors, `${moduleKey}.${key}`)
    if (kind !== 'action') return { moduleKey, guardKey: key, paramBinding, unlockBy: text(r.unlockBy) || 'ancestor_approval' }

    // WHICH completions fire it. A yes/no task where BOTH answers finish the
    // task — "did you feed them?" — must only tell the parents on Yes. When the
    // condition is an MCQ and nothing is specified, the accepting answer the
    // author nominated is the safe default; firing on every completion would
    // send "your child was fed" after an explicit No.
    let when = null
    if (r.when?.answer !== undefined && r.when.answer !== null) when = { answer: text(r.when.answer) }
    else if (condition?.nature === 'mcq' && condition.mcq?.requiredAnswer) when = { answer: condition.mcq.requiredAnswer }
    if (when && condition?.nature === 'mcq' && !(condition.mcq?.options || []).some((o) => o.value === when.answer)) {
      errors.push(`${moduleKey}.${key}: "${when.answer}" is not one of the answers`)
    }

    // Per-task settings the action needs — the message parents receive, for
    // instance. Required fields are checked here so a half-configured action
    // cannot be saved and then quietly do nothing at completion time.
    const config = {}
    for (const f of found.configFields || []) {
      const value = r.config?.[f.name]
      const text_ = typeof value === 'string' ? value.trim() : value
      if (f.required && !text_) {
        errors.push(`${moduleKey}.${key}: ${f.label || f.name} is required`)
        continue
      }
      if (text_ !== undefined && text_ !== null && text_ !== '') config[f.name] = text_
    }

    return { moduleKey, actionKey: key, paramBinding, config, onFailure: r.onFailure === 'block' ? 'block' : 'warn', when }
  }).filter(Boolean)
}

// The whole completion block for a task. Returns the stored shape plus any
// media requirement the nature implies, so model.js can fold it into the
// existing requiresMedia fields rather than growing a second one.
export function normalizeCompletion(src = {}, { defaults = null } = {}) {
  const errors = []
  // No nature at all — an older client, the seed, or a caller that simply does
  // not care. That is the same thing the module meant before natures existed,
  // so it maps to the legacy condition rather than being rejected.
  if (!src.nature) {
    return {
      condition: legacyCondition(defaults || {}, 'default'),
      onComplete: { actions: normalizeHooks(src.onComplete?.actions, errors, 'action') },
      lockOnComplete: normalizeHooks(src.lockOnComplete, errors, 'guard'),
      impliesMedia: false,
      errors,
    }
  }

  const nature = NATURES.includes(src.nature) ? src.nature : 'custom'
  if (!NATURES.includes(src.nature)) errors.push(`nature must be one of ${NATURES.join(', ')}`)
  const condition = {
    nature,
    mcq: null,
    moduleLinked: null,
    custom: null,
    // survives an edit that does not touch the condition, so a migrated task
    // stays identifiable as migrated
    derivedFrom: src.derivedFrom || null,
  }
  if (nature === 'mcq') condition.mcq = normalizeMcq(src.mcq || src, errors)
  if (nature === 'module_linked') condition.moduleLinked = normalizeModuleLinked(src.moduleLinked || src, errors)
  if (nature === 'custom') condition.custom = normalizeCustom(src.custom || src)

  return {
    condition,
    onComplete: { actions: normalizeHooks(src.onComplete?.actions, errors, 'action', condition) },
    lockOnComplete: normalizeHooks(src.lockOnComplete, errors, 'guard', condition),
    impliesMedia: nature === 'mcq' && !!condition.mcq?.requireMedia,
    errors,
  }
}

// ------------------------------------------------------------------- legacy --
// Migration mapping for tasks written before natures existed. Those tasks had
// no verification beyond the assignee's word, so the faithful translation is a
// custom condition with no extra clauses — submit behaves exactly as it did.
//
// requiresMedia / requiresApproval are NOT consumed here: they stay on the task
// where they are already enforced. The statement mirrors them so the condition
// reads truthfully on its own, and `derivedFrom` marks the row as migrated
// rather than authored, which an empty custom condition otherwise looks like.
export function legacyCondition(task = {}, derivedFrom = 'legacy_boolean') {
  const bits = ['Marked done by the assignee']
  if (task.requiresMedia) {
    const n = task.minAttachments || 1
    bits.push(`with ${n} ${(task.mediaTypes || ['photo']).join(' / ')} file${n > 1 ? 's' : ''} attached`)
  }
  if (task.requiresApproval) bits.push('and signed off by the approver')
  return {
    nature: 'custom',
    mcq: null,
    moduleLinked: null,
    custom: { statement: bits.join(' '), checklist: [], requireNote: false, noteLabel: 'What did you do?' },
    derivedFrom,
  }
}

// ----------------------------------------------------------------- describe --
export function describeCondition(condition) {
  if (!condition) return 'Marked done by the assignee'
  if (condition.nature === 'mcq') {
    const accepting = (condition.mcq?.options || []).filter((o) => o.accepts).map((o) => o.label)
    return `Completes when the assignee answers “${accepting.join('” or “')}” to: ${condition.mcq?.question}`
  }
  if (condition.nature === 'module_linked') {
    const ml = condition.moduleLinked || {}
    const phrase = describeSignal(ml.moduleKey, ml.signalKey, ml.paramBinding)
    return phrase ? `Completes when ${phrase}` : 'Completes on a module signal (not configured)'
  }
  const c = condition.custom || {}
  const parts = [c.statement || 'Marked done by the assignee']
  if (c.checklist?.length) parts.push(`${c.checklist.filter((x) => x.required).length} checklist item(s) to confirm`)
  if (c.requireNote) parts.push('a written note')
  return parts.join(' · ')
}

// ----------------------------------------------------------------- evaluate --
// Answers "may this occurrence be submitted?" — the readiness check, not the
// permission check. Returns the same shape for every nature so callers never
// branch on nature themselves.
//
//   satisfied  — the condition holds
//   verifiable — we are ABLE to judge. false means the answer is "don't know
//                yet", which is not the same as "no", and the message says so.
export function evaluateCondition(inst, completion = null) {
  const condition = inst?.completionCondition
  const done = completion || inst?.completion || {}
  const ok = { satisfied: true, verifiable: true, code: null, message: null, missing: [] }
  if (!condition) return ok

  if (condition.nature === 'mcq') {
    const mcq = condition.mcq || {}
    const answer = text(done.answer)
    if (!answer) {
      return { satisfied: false, verifiable: true, code: 'answer_required', message: mcq.question || 'Answer the question before submitting', missing: ['answer'] }
    }
    const option = (mcq.options || []).find((o) => o.value === answer)
    if (!option) {
      return { satisfied: false, verifiable: true, code: 'invalid_answer', message: 'That is not one of the options', missing: ['answer'] }
    }
    if (!option.accepts) {
      const accepting = (mcq.options || []).filter((o) => o.accepts).map((o) => `“${o.label}”`).join(' or ')
      return {
        satisfied: false,
        verifiable: true,
        code: 'answer_not_accepted',
        message: `“${option.label}” does not complete this task — it needs ${accepting}. If that is not possible, ask your manager to defer or cancel it.`,
        missing: ['answer'],
      }
    }
    return ok
  }

  if (condition.nature === 'module_linked') {
    const ml = condition.moduleLinked || {}
    const phrase = describeSignal(ml.moduleKey, ml.signalKey, ml.paramBinding) || 'the linked module signal'
    const signal = getSignal(ml.moduleKey, ml.signalKey)
    // A module that has declared the signal but not wired the read cannot be
    // judged at all. "Don't know" is not "no", and the message says which.
    if (!signal || signal.implemented === false) {
      return {
        satisfied: false,
        verifiable: false,
        code: 'not_yet_verifiable',
        message: `This task completes when ${phrase}. Automatic verification is not wired up yet, so it cannot be submitted here.`,
        missing: [],
      }
    }
    // The stored flag is what push and the sweep maintain. It is NOT trusted on
    // submit — service.js re-reads the signal live first (see verify.js).
    if (inst.conditionMet) return { ...ok, message: inst.conditionMessage || `Verified: ${phrase}` }
    // A binding that resolves to nothing is unjudgeable, not failed: nobody can
    // clear it by working harder, so it must not be dressed up as "not done".
    if (inst.conditionCode === 'unbound_params' || inst.conditionCode === 'unknown_signal') {
      return { satisfied: false, verifiable: false, code: inst.conditionCode, message: inst.conditionMessage, missing: [] }
    }
    return {
      satisfied: false,
      verifiable: true,
      code: 'module_not_done',
      message: inst.conditionMessage || `Not done yet — this completes when ${phrase}.`,
      missing: [],
      cta: getModule(ml.moduleKey)?.cta || null,
    }
  }

  const custom = condition.custom || {}
  const checked = new Set(Array.isArray(done.checked) ? done.checked : [])
  const missing = (custom.checklist || []).filter((c) => c.required && !checked.has(c.id))
  if (missing.length) {
    return {
      satisfied: false,
      verifiable: true,
      code: 'checklist_incomplete',
      message: `Still to confirm: ${missing.map((m) => m.text).join(', ')}`,
      missing: missing.map((m) => m.id),
    }
  }
  if (custom.requireNote && !text(done.note)) {
    return { satisfied: false, verifiable: true, code: 'note_required', message: custom.noteLabel || 'Write a short note before submitting', missing: ['note'] }
  }
  return ok
}

// Sanitize what an assignee sends: unknown checklist ids and stray fields are
// dropped rather than stored, so the completion record always matches the
// condition that was snapshotted onto the occurrence.
export function normalizeCompletionInput(inst, body = {}) {
  const condition = inst?.completionCondition
  const out = { answer: null, checked: [], note: null }
  if (!condition) return out
  if (condition.nature === 'mcq') out.answer = text(body.answer) || null
  if (condition.nature === 'custom') {
    const valid = new Set((condition.custom?.checklist || []).map((c) => c.id))
    out.checked = [...new Set((Array.isArray(body.checked) ? body.checked : []).map(text))].filter((id) => valid.has(id))
    out.note = text(body.note) || null
  }
  return out
}
