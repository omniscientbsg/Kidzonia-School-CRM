// Answering a question set — the fields, and nothing else.
//
// Two screens ask the same questions of the same person: the task detail page
// and the day-end report. They were separate implementations, which is why the
// day-end screen had one hardcoded note box while task detail had three
// mutually exclusive blocks. One renderer, driven by the question list that was
// SNAPSHOTTED onto the occurrence.
import { Stack, Group, Text, Textarea, NumberInput, Checkbox, Badge } from '@mantine/core'

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

  return (
    <Stack gap="md">
      {questions.map((q) => (
        <div key={q.id}>
          {(q.type === 'yes_no' || q.type === 'choose_one') && (
            <Stack gap={8}>
              <Group gap={6} align="center" wrap="wrap">
                <Text fw={600} size="sm">{q.prompt}</Text>
                {q.required === false && <Text size="xs" c="dimmed">(optional)</Text>}
              </Group>
              <Group gap="xs" wrap="wrap">
                {(q.options || []).map((o) => {
                  const picked = answers[q.id] === o.value
                  return (
                    <Badge
                      key={o.value}
                      size="lg"
                      variant={picked ? 'filled' : 'light'}
                      color={picked ? (o.accepts ? 'teal' : 'plum') : 'gray'}
                      style={{ cursor: disabled ? 'default' : 'pointer' }}
                      onClick={() => !disabled && set(q.id, o.value)}
                    >
                      {picked ? '✓ ' : ''}{o.label}
                    </Badge>
                  )
                })}
              </Group>
            </Stack>
          )}

          {q.type === 'checklist' && (
            <Stack gap={7}>
              <Text fw={600} size="sm">{q.prompt}</Text>
              {(q.items || []).map((c) => (
                <Checkbox
                  key={c.id}
                  size="sm"
                  disabled={disabled}
                  checked={(answers[q.id] || []).includes(c.id)}
                  onChange={() => toggle(q.id, c.id)}
                  label={
                    <Group gap={6} align="center">
                      <Text size="sm">{c.text}</Text>
                      {c.required === false && <Text size="xs" c="dimmed">(optional)</Text>}
                    </Group>
                  }
                />
              ))}
            </Stack>
          )}

          {q.type === 'text' && (
            <Textarea
              label={q.prompt} required={q.required !== false} autosize minRows={3} disabled={disabled}
              value={answers[q.id] || ''} onChange={(e) => set(q.id, e.currentTarget.value)}
            />
          )}

          {q.type === 'number' && (
            <NumberInput
              label={q.prompt} required={q.required !== false} disabled={disabled} w={200}
              value={answers[q.id] ?? ''} onChange={(v) => set(q.id, v)}
            />
          )}

          {flagged.has(q.id) && message && <Text size="xs" c="berry" mt={4}>{message}</Text>}
        </div>
      ))}
    </Stack>
  )
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
