// Client-side vocabulary for the two task axes. Mirrors server/tasks/conditions.js
// — the server is still the authority; this exists so the form can label and
// preview without a round-trip on every keystroke.

// Axis 1 — where the task came from. Derived from the recurrence, never typed.
export const originOf = (freq) => (freq && freq !== 'none' ? 'automated' : 'manual')
export const ORIGIN_LABEL = {
  manual: 'Manual — a one-off you assigned',
  automated: 'Automated — generated from the repeat rule',
}

// Axis 2 — how completion is judged. One mode plus a list of questions, in
// place of three mutually exclusive natures that could never combine.
export const MODES = ['answers', 'system', 'both']

// Plain language, not engine language. Nobody outside this codebase should ever
// meet the words "mode", "signal", "module-linked" or "binding".
export const MODE_LABEL = {
  answers: 'They answer for it',
  system: 'The system checks it',
  both: 'The system checks it, and they answer as well',
}
export const MODE_SHORT = { answers: 'they answer', system: 'auto-checked', both: 'auto-checked + answers' }
export const MODE_HELP = {
  answers: 'Ask them whatever you need — a yes/no, tick-boxes, a written note, or all three.',
  system: 'Nothing to tick. Doing the work in the app is what finishes the task.',
  both: 'The work has to show up in the app AND they answer your questions. Use it when the numbers alone do not tell you how the day went.',
}

export const QUESTION_TYPES = ['yes_no', 'choose_one', 'checklist', 'text', 'number']
export const TYPE_LABEL = {
  yes_no: 'Yes / No',
  choose_one: 'Pick one answer',
  checklist: 'Tick-boxes',
  text: 'Written answer',
  number: 'A number',
}

export const blankOptions = () => [
  { value: 'yes', label: 'Yes', accepts: true },
  { value: 'no', label: 'No', accepts: false },
]

// A new question. `id` is left empty on purpose: the server slugs it from the
// prompt. An EXISTING question keeps the id it was saved with, because that is
// what answers already given are filed under.
export const blankQuestion = (type = 'yes_no') => {
  const q = { id: '', type, prompt: '', required: true }
  if (type === 'yes_no' || type === 'choose_one') return { ...q, options: blankOptions(), requiredAnswer: 'yes' }
  if (type === 'checklist') return { ...q, items: [{ id: '', text: '', required: true }] }
  return q
}

export const blankSystem = () => ({ moduleKey: '', signalKey: '', paramBinding: {}, derivedMcq: null, autoSubmit: true })

export const slugify = (s, i) =>
  (String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `item-${i + 1}`).slice(0, 40)

// Pull the editable shape back out of a saved task.
export function conditionToForm(condition) {
  const c = condition || {}
  return {
    mode: MODES.includes(c.mode) ? c.mode : 'answers',
    questions: (c.questions || []).map((q) => ({ ...blankQuestion(q.type), ...q })),
    system: c.system ? { ...blankSystem(), ...c.system } : blankSystem(),
    statement: c.statement || '',
    proof: { required: false, types: null, min: null, ...(c.proof || {}) },
  }
}

// Build the API payload from form state. Whatever the other mode was holding is
// dropped here rather than sent — the server would reject a system check on a
// questions-only task, and keeping it in form state means switching back and
// forth does not lose the place.
export function formToCondition(f) {
  return {
    mode: f.mode,
    questions: f.mode === 'system' ? [] : f.questions,
    system: f.mode === 'answers' ? null : f.system,
    statement: f.statement?.trim() || null,
    proof: f.proof,
  }
}

// Is there enough here to save? An empty question list is legal and means their
// word is enough — that is what a task with no condition has always meant.
export function conditionReady(f) {
  const c = f || {}
  if ((c.mode === 'system' || c.mode === 'both') && !(c.system?.moduleKey && c.system?.signalKey)) return false
  if (c.mode === 'both' && !(c.questions || []).length) return false
  if (c.mode === 'system') return true
  return (c.questions || []).every((q) => {
    if (!q.prompt?.trim()) return false
    if (q.type === 'yes_no' || q.type === 'choose_one') {
      return (q.options || []).some((o) => o.accepts && (o.label || '').trim())
    }
    if (q.type === 'checklist') return (q.items || []).some((x) => (x.text || '').trim())
    return true
  })
}

function describeQuestion(q) {
  if (q.type === 'yes_no' || q.type === 'choose_one') {
    const accepting = (q.options || []).filter((o) => o.accepts).map((o) => o.label || o.value)
    return `they answer ${accepting.map((a) => `“${a}”`).join(' or ') || '—'} to “${q.prompt}”`
  }
  if (q.type === 'checklist') {
    const n = (q.items || []).filter((x) => x.required && x.text).length
    return n ? `they tick ${n} box${n > 1 ? 'es' : ''}` : 'they work through a checklist'
  }
  if (q.type === 'number') return `they enter a number for “${q.prompt}”`
  return `they write an answer to “${q.prompt}”`
}

// How this task gets ticked off, in one clause.
export function describeCondition(condition, capabilities = null) {
  const c = condition || {}
  const bits = []
  if (c.mode === 'system' || c.mode === 'both') {
    bits.push(describeBinding(c.system, capabilities) || 'the system checks it (choose which fact proves it)')
  }
  if (c.mode !== 'system') {
    const asked = (c.questions || []).filter((q) => (q.prompt || '').trim())
    if (!asked.length) bits.push(c.statement?.trim() ? c.statement.trim().replace(/\.$/, '') : 'they mark it done')
    else if (asked.length === 1) bits.push(describeQuestion(asked[0]))
    else bits.push(`they answer ${asked.length} questions`)
  }
  return bits.join(', and ')
}

// THE SENTENCE. The whole task read back in English, so nobody has to hold six
// cards of form state in their head to know what they are about to create.
export function describeTask(f, { preview, capabilities, recurrenceText } = {}) {
  const who = preview?.count
    ? (preview.count === 1
      ? (preview.byNode?.[0]?.people?.[0]?.userName || '1 person')
      : `${preview.count} people`)
    : 'nobody yet'
  const what = f.title?.trim() || 'this task'

  const when = f.freq === 'none'
    ? (f.dueType === 'n_days' ? `within ${f.days} day${Number(f.days) === 1 ? '' : 's'}`
      : f.dueType === 'date_window' ? `between ${f.startDate} and ${f.dueDate}`
        : 'by the end of today')
    : `${(recurrenceText || '').toLowerCase()}, by the end of each day`

  const bits = [`**${who}** must do “${what}” ${when}.`]
  bits.push(`Finished when ${describeCondition(f.completion, capabilities)}.`)

  const extras = []
  if (f.requiresMedia) extras.push(`${f.minAttachments} ${f.mediaTypes.join('/')} attached`)
  if (f.requiresApproval) extras.push('a manager signs it off')
  if (f.isBlocking) extras.push('**they cannot log out until it is done**')
  if (extras.length) bits.push(`Also needs ${extras.join(', and ')}.`)
  return bits.join(' ')
}

// "attendance is marked for the assignee's class on the task's date"
export function describeBinding(ml, capabilities) {
  if (!capabilities || !ml?.moduleKey || !ml?.signalKey) return null
  const mod = capabilities.modules?.find((m) => m.key === ml.moduleKey)
  const sig = mod?.signals?.find((s) => s.key === ml.signalKey)
  if (!sig) return null
  const labelOf = (key) => capabilities.bindSources?.find((b) => b.key === key)?.label || key
  let phrase = sig.phrase
  for (const p of sig.params || []) {
    const bound = ml.paramBinding?.[p.name] || { source: p.bind }
    const label = bound.source === 'literal' ? `“${bound.value || '—'}”` : labelOf(bound.source)
    phrase = phrase.replaceAll(`{${p.name}}`, label)
  }
  return phrase
}

// Which bind sources a parameter of this type may use.
export const sourcesForType = (capabilities, type) =>
  (capabilities?.bindSources || []).filter((b) => b.types?.includes(type))
