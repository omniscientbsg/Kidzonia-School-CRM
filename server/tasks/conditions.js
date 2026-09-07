// How we know a task is done.
//
// TWO ORTHOGONAL AXES, and nothing in here reads the other one:
//   origin  — where the task came from: 'manual' (one-off) or 'automated'
//             (generated from a recurrence). Lives on the task, set in model.js.
//   how it completes — questions the assignee answers, a system signal from
//             another module, or BOTH. That is this file.
//
// `nature` used to be three MUTUALLY EXCLUSIVE values (mcq / module_linked /
// custom), so a task could never both ask a question and check the system —
// which is exactly what the day-end report was faking with a submitPayload
// flag nothing read. One `mode` and a list of questions replaces all three:
//
//   mode 'answers'  the assignee answers the questions
//   mode 'system'   completion is DERIVED from a module signal and read-only —
//                   doing the work in the module is what flips it
//   mode 'both'     the signal must hold AND the questions must be answered
//
// Media stays on task.requiresMedia / minAttachments where it already lives and
// is already enforced. `proof` is where it is AUTHORED — one media rule, one
// enforcement point, no second implementation to disagree with the first.
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
// Options for a yes_no / choose_one question. `requiredAnswer` is the primary
// accepting option; extra options may also accept, which is how
// "Yes / Not applicable" works.
function normalizeOptions(src = {}, errors) {
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

  let requiredAnswer = text(src.requiredAnswer)
  if (requiredAnswer && !options.some((o) => o.value === requiredAnswer)) {
    errors.push(`requiredAnswer "${requiredAnswer}" is not one of the options`)
    requiredAnswer = ''
  }
  if (requiredAnswer) options = options.map((o) => (o.value === requiredAnswer ? { ...o, accepts: true } : o))
  if (!requiredAnswer) requiredAnswer = options.find((o) => o.accepts)?.value || ''
  if (!options.some((o) => o.accepts)) errors.push('mark at least one option as completing the task')

  return { options, requiredAnswer }
}

function normalizeItems(rows) {
  const ids = new Set()
  return (Array.isArray(rows) ? rows : []).map((c, i) => {
    let id = text(c.id) || slugify(c.text, i)
    while (ids.has(id)) id = `${id}-${i}`
    ids.add(id)
    return { id, text: text(c.text), required: c.required !== false }
  }).filter((c) => c.text)
}

// One question. Ids are stable and are how answers are addressed for the rest
// of the occurrence's life, so an authored id always wins over a fresh slug.
function normalizeQuestion(src = {}, i, errors, ids) {
  if (!QUESTION_TYPES.includes(src.type)) {
    errors.push(`question ${i + 1}: type must be one of ${QUESTION_TYPES.join(', ')}`)
    return null
  }
  const prompt = text(src.prompt)
  if (!prompt) errors.push(`question ${i + 1} needs a prompt`)
  let id = text(src.id) || slugify(prompt, i)
  while (ids.has(id)) id = `${id}-${i}`
  ids.add(id)

  const q = { id, type: src.type, prompt, required: src.required !== false }
  if (src.type === 'yes_no' || src.type === 'choose_one') {
    const { options, requiredAnswer } = normalizeOptions(src, errors)
    q.options = options
    // kept per question: the lunch task has BOTH answers accepting, so "the
    // accepting option" is ambiguous without it — and it is what an action's
    // `when` defaults to
    q.requiredAnswer = requiredAnswer
  }
  if (src.type === 'checklist') {
    q.items = normalizeItems(src.items)
    if (!q.items.length) errors.push(`question ${i + 1}: a checklist needs at least one item`)
  }
  return q
}

export function normalizeQuestions(rows, errors) {
  const ids = new Set()
  return (Array.isArray(rows) ? rows : []).map((q, i) => normalizeQuestion(q, i, errors, ids)).filter(Boolean)
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

// The system check: completion gated on a real signal from another module. The
// answer is DERIVED and read-only — doing the work in the module is what flips
// it — which is why `readOnly` is not configurable.
function normalizeSystem(src = {}, errors) {
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
  const derivedMcq = src.derivedMcq
    ? { question: text(src.derivedMcq.question) || sig.label, readOnly: true }
    : null
  return { moduleKey, signalKey, paramBinding, derivedMcq, autoSubmit: src.autoSubmit !== false }
}

// MIRROR, NOT MOVE. `proof` is the authored home for the media rule; the three
// top-level task fields (requiresMedia / mediaTypes / minAttachments) stay the
// enforcement point, because submitWork's check is read in 8 server files and
// is correct as it stands. normalizeTask derives them from this — one authored
// place, every reader unchanged.
function normalizeProof(src = {}) {
  const p = src || {}
  const types = (Array.isArray(p.types) ? p.types : []).map(text).filter(Boolean)
  const min = Number(p.min)
  return {
    required: !!p.required,
    // null means "whatever the task already allows" rather than a second,
    // competing list that can disagree with the first
    types: types.length ? types : null,
    min: Number.isFinite(min) && min > 0 ? min : null,
  }
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
    // task — "did you feed them?" — must only tell the parents on Yes. When
    // nothing is specified, the accepting answer the author nominated is the
    // safe default; firing on every completion would send "your child was fed"
    // after an explicit No.
    //
    // `when` names the QUESTION as well as the answer now. With answers keyed
    // by question id, `{ answer: 'yes' }` alone can no longer be looked up, and
    // the gate would fail open on every multi-question task.
    const choice = (condition?.questions || []).find((q) => q.type === 'yes_no' || q.type === 'choose_one')
    let when = null
    if (r.when?.answer !== undefined && r.when.answer !== null) {
      when = { questionId: text(r.when.questionId) || choice?.id || QID.answer, answer: text(r.when.answer) }
    } else if (choice?.requiredAnswer) {
      when = { questionId: choice.id, answer: choice.requiredAnswer }
    }
    if (when) {
      const q = (condition?.questions || []).find((x) => x.id === when.questionId)
      if (q && !(q.options || []).some((o) => o.value === when.answer)) {
        errors.push(`${moduleKey}.${key}: "${when.answer}" is not one of the answers`)
      }
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

// ---------------------------------------------------- the legacy input shape --
// A client that still posts { nature, mcq, moduleLinked, custom }. These three
// validate that input exactly as they always did, and the result is then read
// through readCondition() — the SAME function the shim uses — so an authored
// row and a shimmed row can never disagree about ids or shape.
function normalizeMcq(src = {}, errors) {
  const question = text(src.question)
  if (!question) errors.push('the MCQ needs a question')
  const { options, requiredAnswer } = normalizeOptions(src, errors)
  return { question, options, requiredAnswer, requireMedia: !!src.requireMedia }
}

function normalizeCustom(src = {}) {
  // An empty statement is legal and means exactly what it did before natures
  // existed: the assignee's word, nothing extra. Forcing every "bring the
  // register to the office" task to carry a written definition would be noise.
  const statement = text(src.statement) || 'Marked done by the assignee'
  return {
    statement,
    checklist: normalizeItems(src.checklist),
    requireNote: !!src.requireNote,
    noteLabel: text(src.noteLabel) || 'What did you do?',
  }
}

function fromNature(src, errors) {
  const nature = NATURES.includes(src.nature) ? src.nature : 'custom'
  if (!NATURES.includes(src.nature)) errors.push(`nature must be one of ${NATURES.join(', ')}`)
  const legacy = { nature, mcq: null, moduleLinked: null, custom: null, derivedFrom: src.derivedFrom || null }
  if (nature === 'mcq') legacy.mcq = normalizeMcq(src.mcq || src, errors)
  if (nature === 'module_linked') legacy.moduleLinked = normalizeSystem(src.moduleLinked || src, errors)
  if (nature === 'custom') legacy.custom = normalizeCustom(src.custom || src)

  const spec = readCondition(legacy)
  return {
    mode: spec.mode,
    questions: spec.questions,
    system: spec.system,
    statement: spec.statement,
    proof: normalizeProof({ required: nature === 'mcq' && !!legacy.mcq?.requireMedia }),
    derivedFrom: legacy.derivedFrom,
  }
}

function authored(src, errors) {
  const mode = MODES.includes(src.mode) ? src.mode : 'answers'
  if (!MODES.includes(src.mode)) errors.push(`mode must be one of ${MODES.join(', ')}`)
  const questions = normalizeQuestions(src.questions, errors)
  const system = mode === 'answers' ? null : normalizeSystem(src.system || {}, errors)
  // 'both' is the mode that exists BECAUSE a system check and questions were
  // mutually exclusive before. Saving one with no questions is asking for
  // 'system' and getting it wrong quietly.
  if (mode === 'both' && !questions.length) {
    errors.push('a task that checks the system AND asks questions needs at least one question')
  }
  return {
    mode,
    questions,
    system,
    statement: text(src.statement) || null,
    proof: normalizeProof(src.proof),
    derivedFrom: src.derivedFrom || null,
  }
}

// The whole completion block for a task. Returns the stored shape plus any
// media requirement it implies, so model.js can fold that into the existing
// requiresMedia fields rather than growing a second one.
export function normalizeCompletion(src = {}, { defaults = null } = {}) {
  const errors = []
  // Nothing said at all — an older client, the seed, or a caller that simply
  // does not care. That is what the module meant before completion had a shape
  // of its own, so it maps to the legacy condition rather than being rejected.
  const condition = (!src.mode && !src.nature)
    ? legacyCondition(defaults || {}, 'default')
    : (src.mode ? authored(src, errors) : fromNature(src, errors))

  return {
    condition,
    onComplete: { actions: normalizeHooks(src.onComplete?.actions, errors, 'action', condition) },
    lockOnComplete: normalizeHooks(src.lockOnComplete, errors, 'guard', condition),
    impliesMedia: !!condition.proof?.required,
    errors,
  }
}

// ------------------------------------------------------------------- legacy --
// Migration mapping for tasks written before completion had a shape at all.
// Those tasks had no verification beyond the assignee's word, so the faithful
// translation asks NO questions — submit behaves exactly as it did.
//
// requiresMedia / requiresApproval are NOT consumed here: they stay on the task
// where they are already enforced. The statement mirrors them so the condition
// reads truthfully on its own, and `derivedFrom` marks the row as migrated
// rather than authored, which an empty condition otherwise looks like.
export function legacyCondition(task = {}, derivedFrom = 'legacy_boolean') {
  const bits = ['Marked done by the assignee']
  if (task.requiresMedia) {
    const n = task.minAttachments || 1
    bits.push(`with ${n} ${(task.mediaTypes || ['photo']).join(' / ')} file${n > 1 ? 's' : ''} attached`)
  }
  if (task.requiresApproval) bits.push('and signed off by the approver')
  return {
    mode: 'answers',
    questions: [],
    system: null,
    statement: bits.join(' '),
    proof: { required: false, types: null, min: null },
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
//
// Returns only the answers this body actually carried. The caller MERGES them
// over what is already stored: with one question a total replacement was safe,
// with several a partial save would wipe the answers to the others.
export function normalizeCompletionInput(inst, body = {}) {
  const spec = readCondition(inst?.completionCondition)
  const answers = {}
  if (!spec) return { answers }
  // A browser tab left open across the deploy still posts { answer, checked,
  // note }. Read those through the same ids for one release, or a day-end
  // report files itself EMPTY and still passes note_required.
  const sent = body.answers && typeof body.answers === 'object' ? body.answers : null
  for (const q of spec.questions) {
    let value = sent && sent[q.id] !== undefined ? sent[q.id] : undefined
    if (value === undefined && !sent) {
      if (q.type === 'checklist') value = body.checked
      else if (q.id === QID.note) value = body.note
      else if (q.id === QID.answer) value = body.answer
    }
    if (value === undefined) continue
    if (q.type === 'checklist') {
      const valid = new Set((q.items || []).map((c) => c.id))
      answers[q.id] = [...new Set((Array.isArray(value) ? value : []).map(text))].filter((id) => valid.has(id))
    } else if (q.type === 'number') {
      answers[q.id] = Number.isFinite(Number(value)) ? Number(value) : null
    } else {
      answers[q.id] = text(value) || null
    }
  }
  return { answers }
}

// ------------------------------------------------------- reading an answer --
// By id, never by field name. Everything that used to reach into
// completion.answer / .checked / .note goes through one of these.
export function answerValue(inst, questionId) {
  const done = inst?.completion
  if (!done || !questionId) return null
  const spec = readCondition(inst?.completionCondition)
  const q = (spec?.questions || []).find((x) => x.id === questionId)
  if (!q) return done.answers?.[questionId] ?? null
  const value = answerOf(done, q)
  return value === undefined ? null : value
}

// The free text the assignee wrote, whatever the question happens to be called
// — the day-end report body resolves it from the form rather than by field
// name, so a form that renames its note question keeps working.
export function writtenNote(inst) {
  const spec = readCondition(inst?.completionCondition)
  const q = (spec?.questions || []).find((x) => x.id === QID.note)
    || (spec?.questions || []).find((x) => x.type === 'text')
  if (!q) return null
  return text(answerOf(inst?.completion || {}, q)) || null
}

// `completion` on the wire in the pre-_tasksV9 field names, for one release:
// TaskDetail.jsx and DayEnd.jsx still read .answer / .checked / .note. Same
// deal as `nature` — derived, never stored.
export function legacyCompletion(inst) {
  const done = inst?.completion
  if (!done) return done ?? null
  const spec = readCondition(inst?.completionCondition)
  const out = { ...done, answer: null, checked: [], note: null }
  for (const q of (spec?.questions || [])) {
    const value = answerOf(done, q)
    if (q.type === 'checklist') out.checked = Array.isArray(value) ? value : []
    else if (q.id === QID.note) out.note = value ?? null
    else if (q.id === QID.answer) out.answer = value ?? null
  }
  return out
}
