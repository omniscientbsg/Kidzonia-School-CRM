// Answering a question set — the fields, and nothing else.
//
// Two screens ask the same questions of the same person: the task detail page
// and the day-end report. They were separate implementations, which is why the
// day-end screen had one hardcoded note box while task detail had three
// mutually exclusive blocks. One renderer, driven by the question list that was
// SNAPSHOTTED onto the occurrence.
import { Field } from '../../components/ui'

export default function QuestionFields({
  questions = [],
  answers = {},
  onChange,
  disabled = false,
  missing = [],
  message = null,
}) {
  const flagged = new Set(missing)
  const set = (id, value) => onChange({ ...answers, [id]: value })
  const toggle = (id, itemId) => set(
    id,
    (answers[id] || []).includes(itemId)
      ? (answers[id] || []).filter((x) => x !== itemId)
      : [...(answers[id] || []), itemId],
  )

  return questions.map((q) => (
    <div key={q.id} style={{ marginBottom: 14 }}>
      {(q.type === 'yes_no' || q.type === 'choose_one') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {q.prompt}
            {q.required === false && <span className="muted"> (optional)</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(q.options || []).map((o) => (
              <button type="button" key={o.value} disabled={disabled}
                className={`badge ${answers[q.id] === o.value ? (o.accepts ? 'teal' : 'plum') : 'gray'}`}
                style={{ cursor: disabled ? 'default' : 'pointer', border: 'none' }}
                onClick={() => set(q.id, o.value)}>
                {answers[q.id] === o.value ? '✓ ' : ''}{o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {q.type === 'checklist' && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{q.prompt}</div>
          {(q.items || []).map((c) => (
            <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 7 }}>
              <input type="checkbox" checked={(answers[q.id] || []).includes(c.id)} disabled={disabled}
                onChange={() => toggle(q.id, c.id)} style={{ width: 'auto' }} />
              {c.text}
              {c.required === false && <span className="muted">(optional)</span>}
            </label>
          ))}
        </div>
      )}

      {q.type === 'text' && (
        <Field label={`${q.prompt}${q.required === false ? '' : ' *'}`}>
          <textarea value={answers[q.id] || ''} disabled={disabled}
            onChange={(e) => set(q.id, e.target.value)} />
        </Field>
      )}

      {q.type === 'number' && (
        <Field label={`${q.prompt}${q.required === false ? '' : ' *'}`}>
          <input type="number" value={answers[q.id] ?? ''} disabled={disabled}
            onChange={(e) => set(q.id, e.target.value)} />
        </Field>
      )}

      {flagged.has(q.id) && message && (
        <div style={{ fontSize: 12, color: 'var(--berry)' }}>{message}</div>
      )}
    </div>
  ))
}

// Everything a required question still needs, by id. The server is the
// authority — this only stops the button being pressable when it obviously
// cannot succeed.
export function unanswered(questions = [], answers = {}) {
  return questions.filter((q) => {
    if (q.required === false) return false
    const v = answers[q.id]
    if (q.type === 'checklist') {
      const ticked = new Set(Array.isArray(v) ? v : [])
      return (q.items || []).some((c) => c.required !== false && !ticked.has(c.id))
    }
    return !String(v ?? '').trim()
  }).map((q) => q.id)
}
