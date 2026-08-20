// Client-side vocabulary for the two task axes. Mirrors server/tasks/conditions.js
// — the server is still the authority; this exists so the form can label and
// preview without a round-trip on every keystroke.

// Axis 1 — where the task came from. Derived from the recurrence, never typed.
export const originOf = (freq) => (freq && freq !== 'none' ? 'automated' : 'manual')
export const ORIGIN_LABEL = {
  manual: 'Manual — a one-off you assigned',
  automated: 'Automated — generated from the repeat rule',
}

// Axis 2 — how completion is verified.
export const NATURES = ['mcq', 'module_linked', 'custom']

// Plain language, not engine language. Nobody outside this codebase should ever
// meet the words "nature", "signal", "module-linked" or "binding".
export const NATURE_LABEL = {
  mcq: 'They confirm it',
  module_linked: 'The system checks it',
  custom: 'They work through a checklist',
}
export const NATURE_SHORT = { mcq: 'confirms', module_linked: 'auto-checked', custom: 'checklist' }
export const NATURE_HELP = {
  mcq: 'They answer a question you write. Their word — good for anything the system cannot see.',
  module_linked: 'Nothing to tick. Doing the work in the app is what finishes the task.',
  custom: 'Spell out what "done" means, with tick-boxes and an optional note.',
}

export const blankOptions = () => [
  { value: 'yes', label: 'Yes', accepts: true },
  { value: 'no', label: 'No', accepts: false },
]

export const blankCondition = (nature) => {
  if (nature === 'mcq') return { question: '', options: blankOptions(), requiredAnswer: 'yes', requireMedia: false }
  if (nature === 'module_linked') return { moduleKey: '', signalKey: '', paramBinding: {}, derivedMcq: null, autoSubmit: true }
  return { statement: '', checklist: [], requireNote: false, noteLabel: 'What did you do?' }
}

export const slugify = (s, i) =>
  (String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `item-${i + 1}`).slice(0, 40)

// Pull the editable shape back out of a saved task.
export function conditionToForm(condition) {
  const nature = condition?.nature || 'custom'
  return {
    nature,
    mcq: condition?.mcq ? { ...blankCondition('mcq'), ...condition.mcq } : blankCondition('mcq'),
    moduleLinked: condition?.moduleLinked ? { ...blankCondition('module_linked'), ...condition.moduleLinked } : blankCondition('module_linked'),
    custom: condition?.custom ? { ...blankCondition('custom'), ...condition.custom } : blankCondition('custom'),
  }
}

// Build the API payload from form state.
export function formToCondition(f) {
  const base = { nature: f.nature }
  if (f.nature === 'mcq') return { ...base, mcq: f.mcq }
  if (f.nature === 'module_linked') return { ...base, moduleLinked: f.moduleLinked }
  return { ...base, custom: f.custom }
}

// How this task gets ticked off, in one clause.
export function describeCondition(condition, capabilities = null) {
  const c = condition || {}
  if (c.nature === 'mcq') {
    const mcq = c.mcq || {}
    const accepting = (mcq.options || []).filter((o) => o.accepts).map((o) => o.label || o.value)
    if (!mcq.question) return 'they confirm it'
    return `they answer ${accepting.map((a) => `“${a}”`).join(' or ') || '—'} to “${mcq.question}”`
  }
  if (c.nature === 'module_linked') {
    return describeBinding(c.moduleLinked, capabilities) || 'the system checks it (choose which fact proves it)'
  }
  const custom = c.custom || {}
  const parts = []
  if (custom.statement) parts.push(custom.statement.replace(/\.$/, ''))
  const required = (custom.checklist || []).filter((x) => x.required && x.text).length
  if (required) parts.push(`${required} tick-box${required > 1 ? 'es' : ''}`)
  if (custom.requireNote) parts.push('a short note')
  return parts.length ? parts.join(', ') : 'they mark it done'
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
