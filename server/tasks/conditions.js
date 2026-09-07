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

// ---------------------------------------------------------------- one shape --
// `nature` was three MUTUALLY EXCLUSIVE natures, so a task could never both ask
// a question and check the system — which is exactly what the day-end report
// has been faking with `custom.submitPayload`. The shape underneath is:
//
//   { mode: 'answers' | 'system' | 'both',
//     questions: [{ id, type, prompt, required, options?, items? }],
//     system: { moduleKey, signalKey, paramBinding, derivedMcq, autoSubmit } | null,
//     statement, derivedFrom }
//
// Today's `mcq` IS one choose_one question; today's `custom` IS one checklist
// question plus an optional text one. Several questions is then free, and
// `mode: 'both'` is the thing that was previously inexpressible.
//
// STABLE QUESTION IDS. This shim and the `_tasksV9` migration must derive the
// SAME id for the same legacy clause — slug them independently and a row the
// migration converted disagrees with a row the shim converted, orphaning a live
// `completion.answers` key. Hence one exported constant, used by both.
export const QID = { answer: 'answer', checklist: 'checklist', note: 'note' }
export const MODES = ['answers', 'system', 'both']
export const QUESTION_TYPES = ['yes_no', 'choose_one', 'checklist', 'text', 'number']

// READ-TIME SHIM, one release. Pure, never writes — the same pattern as
// targetLevelIds() in resolve.js — so a row the migration has not reached still
// reads correctly, and converts the next time it is saved.
export function readCondition(condition) {
  if (!condition) return null
  if (condition.mode) {
    return {
      mode: MODES.includes(condition.mode) ? condition.mode : 'answers',
      questions: Array.isArray(condition.questions) ? condition.questions : [],
      system: condition.system || null,
      statement: condition.statement || null,
      derivedFrom: condition.derivedFrom || null,
    }
  }

  const base = { statement: null, derivedFrom: condition.derivedFrom || null }

  if (condition.nature === 'module_linked') {
    return { ...base, mode: 'system', questions: [], system: condition.moduleLinked || null }
  }

  if (condition.nature === 'mcq') {
    const mcq = condition.mcq || {}
    const options = mcq.options || []
    return {
      ...base,
      mode: 'answers',
      system: null,
      questions: [{
        id: QID.answer,
        // exactly two options is the yes/no widget; more is a list to choose from
        type: options.length === 2 ? 'yes_no' : 'choose_one',
        prompt: mcq.question,
        required: true,
        options,
        requiredAnswer: mcq.requiredAnswer || '',
      }],
    }
  }

  // custom, and anything unrecognised — the same fallback the old evaluator had
  const custom = condition.custom || {}
  const questions = []
  if ((custom.checklist || []).length) {
    questions.push({
      id: QID.checklist,
      type: 'checklist',
      prompt: custom.statement || 'Confirm each of these',
      required: true,
      items: custom.checklist,
    })
  }
  // A note question exists only when one was actually asked for. An optional
  // note that nobody requested is a question the condition never asked, and
  // answers to those are dropped, not stored.
  if (custom.requireNote) {
    questions.push({ id: QID.note, type: 'text', prompt: custom.noteLabel || '', required: true })
  }
  return { ...base, mode: 'answers', system: null, questions, statement: custom.statement || null }
}

// The three predicates every caller outside this file uses, so nothing else
// ever touches the shape again. They take an occurrence (or a task), not a
// condition, because that is what every call site has in hand.
export const systemSpec = (inst) => readCondition(inst?.completionCondition)?.system || null
export const hasQuestions = (inst) => ((readCondition(inst?.completionCondition)?.questions) || []).length > 0
export const conditionMode = (inst) => readCondition(inst?.completionCondition)?.mode || 'answers'

// "May the assignee type an answer at all?" — a DIFFERENT question from "does
// the pull guard run", which is `systemSpec(inst) !== null`. They were the same
// string in four places in service.js and they come apart under `mode: 'both'`:
// conflate them and either a `both` task refuses the answers it asks for, or it
// skips the live re-read. Only a pure system check has nothing to type.
export const answersAreTyped = (inst) => conditionMode(inst) !== 'system'

// `nature` on the wire, derived for one release: TaskDetail.jsx and
// CompletionEditor.jsx still read it.
export function legacyNature(condition) {
  if (!condition) return 'custom'
  if (condition.nature) return condition.nature
  const spec = readCondition(condition)
  if (spec.mode === 'system') return 'module_linked'
  const only = spec.questions.length === 1 ? spec.questions[0] : null
  if (only && (only.type === 'yes_no' || only.type === 'choose_one')) return 'mcq'
  return 'custom'
}

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
// One sentence covering all three modes.
export function describeCondition(condition) {
  const spec = readCondition(condition)
  if (!spec) return 'Marked done by the assignee'

  const systemPhrase = () => {
    const sys = spec.system || {}
    const phrase = describeSignal(sys.moduleKey, sys.signalKey, sys.paramBinding)
    return phrase ? `Completes when ${phrase}` : 'Completes on a module signal (not configured)'
  }
  if (spec.mode === 'system') return systemPhrase()

  // one question, and it is a choice: the sentence names the answers that finish it
  const only = spec.questions.length === 1 ? spec.questions[0] : null
  if (!spec.system && only && (only.type === 'yes_no' || only.type === 'choose_one')) {
    const accepting = (only.options || []).filter((o) => o.accepts).map((o) => o.label)
    return `Completes when the assignee answers “${accepting.join('” or “')}” to: ${only.prompt}`
  }

  const parts = []
  if (spec.system) parts.push(systemPhrase())
  parts.push(spec.statement || 'Marked done by the assignee')
  const checklist = spec.questions.find((q) => q.type === 'checklist')
  if (checklist) parts.push(`${(checklist.items || []).filter((x) => x.required).length} checklist item(s) to confirm`)
  if (spec.questions.some((q) => q.id === QID.note)) parts.push('a written note')
  return parts.join(' · ')
}

// ----------------------------------------------------------------- evaluate --
// What the assignee has recorded for one question. `completion.answers`, keyed
// by question id, is where this lives; the three named fields are what
// completions written before _tasksV9 carry, and they are read through the same
// ids — which is why the ids are a shared constant and not slugged twice.
function answerOf(done, q) {
  const answers = done.answers && typeof done.answers === 'object' ? done.answers : null
  if (answers && answers[q.id] !== undefined) return answers[q.id]
  if (q.id === QID.answer) return done.answer
  if (q.type === 'checklist') return done.checked
  if (q.id === QID.note) return done.note
  return undefined
}

// The system half. Unchanged semantics, lifted out of the old `module_linked`
// branch so `mode: 'both'` can run it and then still ask its questions.
function evaluateSystem(inst, sys) {
  const phrase = describeSignal(sys.moduleKey, sys.signalKey, sys.paramBinding) || 'the linked module signal'
  const signal = getSignal(sys.moduleKey, sys.signalKey)
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
  if (inst.conditionMet) {
    return { satisfied: true, verifiable: true, code: null, missing: [], message: inst.conditionMessage || `Verified: ${phrase}` }
  }
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
    cta: getModule(sys.moduleKey)?.cta || null,
  }
}

// One question — null when it is answered acceptably.
function evaluateQuestion(q, value) {
  if (q.type === 'checklist') {
    const checked = new Set(Array.isArray(value) ? value : [])
    const missing = (q.items || []).filter((c) => c.required && !checked.has(c.id))
    if (!missing.length) return null
    return {
      satisfied: false,
      verifiable: true,
      code: 'checklist_incomplete',
      message: `Still to confirm: ${missing.map((m) => m.text).join(', ')}`,
      missing: missing.map((m) => m.id),
    }
  }

  if (q.type === 'yes_no' || q.type === 'choose_one') {
    const answer = text(value)
    if (!answer) {
      if (q.required === false) return null
      return { satisfied: false, verifiable: true, code: 'answer_required', message: q.prompt || 'Answer the question before submitting', missing: [q.id] }
    }
    const option = (q.options || []).find((o) => o.value === answer)
    if (!option) {
      return { satisfied: false, verifiable: true, code: 'invalid_answer', message: 'That is not one of the options', missing: [q.id] }
    }
    if (!option.accepts) {
      const accepting = (q.options || []).filter((o) => o.accepts).map((o) => `“${o.label}”`).join(' or ')
      return {
        satisfied: false,
        verifiable: true,
        code: 'answer_not_accepted',
        message: `“${option.label}” does not complete this task — it needs ${accepting}. If that is not possible, ask your manager to defer or cancel it.`,
        missing: [q.id],
      }
    }
    return null
  }

  // text / number
  if (q.required !== false && !text(value)) {
    const isNote = q.id === QID.note
    return {
      satisfied: false,
      verifiable: true,
      code: isNote ? 'note_required' : 'answer_required',
      message: q.prompt || (isNote ? 'Write a short note before submitting' : 'Answer the question before submitting'),
      missing: [q.id],
    }
  }
  return null
}

// Answers "may this occurrence be submitted?" — the readiness check, not the
// permission check. Returns the same shape for every mode, so callers never
// branch on the shape themselves.
//
//   satisfied  — the condition holds
//   verifiable — we are ABLE to judge. false means the answer is "don't know
//                yet", which is not the same as "no", and the message says so.
export function evaluateCondition(inst, completion = null) {
  const spec = readCondition(inst?.completionCondition)
  const done = completion || inst?.completion || {}
  const ok = { satisfied: true, verifiable: true, code: null, message: null, missing: [] }
  if (!spec) return ok

  // The system check runs FIRST when there is one. Under `mode: 'both'` an
  // unjudgeable signal must not be masked by a missing answer that the person
  // can still go and give.
  let message = null
  if (spec.system) {
    const verdict = evaluateSystem(inst, spec.system)
    if (!verdict.satisfied) return verdict
    message = verdict.message
  }

  for (const q of spec.questions) {
    const verdict = evaluateQuestion(q, answerOf(done, q))
    if (verdict) return verdict
  }
  return { ...ok, message }
}

// Sanitize what an assignee sends: unknown checklist ids, and answers to
// questions the snapshotted condition never asked, are dropped rather than
// stored — so the completion record always matches the condition the
// occurrence was assigned under.
export function normalizeCompletionInput(inst, body = {}) {
  const spec = readCondition(inst?.completionCondition)
  const out = { answer: null, checked: [], note: null }
  if (!spec) return out
  for (const q of spec.questions) {
    if (q.type === 'checklist') {
      const valid = new Set((q.items || []).map((c) => c.id))
      out.checked = [...new Set((Array.isArray(body.checked) ? body.checked : []).map(text))].filter((id) => valid.has(id))
    } else if (q.id === QID.note) {
      out.note = text(body.note) || null
    } else if (q.id === QID.answer) {
      out.answer = text(body.answer) || null
    }
  }
  return out
}
