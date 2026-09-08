// "How do we know it's done?"
//
// The engine has a mode, a question list and a module/signal/binding vocabulary.
// None of that reaches this screen. A person picks one of three plain answers,
// writes whatever questions they need, and the hard cases stay out of the way
// until asked for.
//
// It used to be three MUTUALLY EXCLUSIVE sub-editors, so "confirm it, and tick
// these off, and tell me about the day" was three tasks instead of one, and
// "the system checks it AND they tell me how it went" was not expressible at
// all. Questions are a list now, and the system check sits alongside them.
import {
  Stack, Group, Text, Radio, Checkbox, TextInput, Textarea, Select,
  Button, ActionIcon, Card, Divider, Badge,
} from '@mantine/core'
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import {
  MODES, MODE_LABEL, MODE_HELP, QUESTION_TYPES, TYPE_LABEL,
  blankQuestion, slugify,
} from '../../services/tasks/conditions'

// The question list on its own. Two places author one: the assign form, and a
// day-end report form in Setup. They ask for exactly the same thing, so they
// use exactly the same editor rather than two that drift apart.
export function QuestionListEditor({ questions = [], onChange, emptyHint = null }) {
  const setQuestion = (i, patch) => onChange(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  const removeQuestion = (i) => onChange(questions.filter((_, j) => j !== i))
  const moveQuestion = (i, by) => {
    const next = [...questions]
    const to = i + by
    if (to < 0 || to >= next.length) return
    ;[next[i], next[to]] = [next[to], next[i]]
    onChange(next)
  }

  return (
    <Stack gap="sm">
      {questions.map((q, i) => (
        <QuestionCard
          key={q.id || i}
          q={q} index={i} total={questions.length}
          set={(p) => setQuestion(i, p)}
          onRemove={() => removeQuestion(i)}
          onMove={(by) => moveQuestion(i, by)}
        />
      ))}

      <Group gap="xs">
        {QUESTION_TYPES.map((t) => (
          <Button key={t} size="compact-xs" variant="light" leftSection={<Plus size={12} />}
            onClick={() => onChange([...questions, blankQuestion(t)])}>
            {TYPE_LABEL[t]}
          </Button>
        ))}
      </Group>
      {!questions.length && emptyHint && <Text size="xs" c="dimmed">{emptyHint}</Text>}
    </Stack>
  )
}

export default function CompletionEditor({ value, onChange, capabilities }) {
  const set = (patch) => onChange({ ...value, ...patch })
  const activities = capabilities?.activities || []
  // nothing in the app can be checked automatically yet -> do not offer either
  // mode that depends on one
  const modes = MODES.filter((m) => m === 'answers' || activities.length > 0)

  return (
    <Stack gap="sm">
      <Radio.Group value={value.mode} onChange={(m) => set({ mode: m })}>
        <Stack gap={6}>
          {modes.map((m) => (
            <Radio key={m} value={m} label={MODE_LABEL[m]} description={MODE_HELP[m]} />
          ))}
        </Stack>
      </Radio.Group>

      <Divider />

      {(value.mode === 'system' || value.mode === 'both') && (
        <VerifiedPicker
          ml={value.system}
          set={(p) => set({ system: { ...value.system, ...p } })}
          activities={activities}
        />
      )}

      {value.mode !== 'system' && (
        <Stack gap="sm">
          {value.mode === 'both' && <Divider label="And ask them" labelPosition="left" />}

          <Textarea
            label="What counts as done?"
            placeholder="Leave blank if their word is enough. Otherwise: every cot stripped, linen bagged, room aired for 20 minutes."
            autosize minRows={2}
            value={value.statement || ''}
            onChange={(e) => set({ statement: e.currentTarget.value })}
          />

          <QuestionListEditor
            questions={value.questions || []}
            onChange={(questions) => set({ questions })}
            emptyHint="No questions: they simply mark it done. That is what a task with nothing set has always meant."
          />

          <Checkbox label="Make them attach a photo as well" checked={!!value.proof?.required}
            onChange={(e) => set({ proof: { ...value.proof, required: e.currentTarget.checked } })} />
        </Stack>
      )}
    </Stack>
  )
}

// ------------------------------------------------------------- a question ----
function QuestionCard({ q, index, total, set, onRemove, onMove }) {
  return (
    <Card withBorder padding="sm" radius="sm">
      <Stack gap="xs">
        <Group gap="xs" wrap="nowrap" align="flex-end">
          <TextInput
            style={{ flex: 1 }}
            label={`Question ${index + 1}`}
            placeholder={
              q.type === 'checklist' ? 'e.g. Before you lock up'
                : q.type === 'number' ? 'e.g. How many children stayed late?'
                  : q.type === 'text' ? 'e.g. Anything your manager should know?'
                    : 'e.g. Did you run the fire drill with your class?'
            }
            value={q.prompt}
            onChange={(e) => set({ prompt: e.currentTarget.value })}
          />
          <Badge variant="light" color="ink">{TYPE_LABEL[q.type]}</Badge>
          <ActionIcon variant="subtle" color="ink" aria-label="Move up"
            disabled={index === 0} onClick={() => onMove(-1)}><ChevronUp size={14} /></ActionIcon>
          <ActionIcon variant="subtle" color="ink" aria-label="Move down"
            disabled={index === total - 1} onClick={() => onMove(1)}><ChevronDown size={14} /></ActionIcon>
          <ActionIcon variant="subtle" color="berry" aria-label="Remove question"
            onClick={onRemove}><Trash2 size={14} /></ActionIcon>
        </Group>

        {(q.type === 'yes_no' || q.type === 'choose_one') && <AnswerEditor q={q} set={set} />}
        {q.type === 'checklist' && <ItemsEditor q={q} set={set} />}

        <Checkbox
          size="xs"
          label="They have to answer this before they can submit"
          checked={q.required !== false}
          onChange={(e) => set({ required: e.currentTarget.checked })}
        />
      </Stack>
    </Card>
  )
}

function AnswerEditor({ q, set }) {
  const options = q.options || []
  const setOption = (i, patch) => set({ options: options.map((o, j) => (j === i ? { ...o, ...patch } : o)) })
  // the 90% case is Yes/No and needs no option editor at all
  const simple = q.type === 'yes_no' && options.length === 2
    && options[0].value === 'yes' && options[1].value === 'no'

  if (simple) {
    return (
      <Select
        label="Which answer finishes it" w={220} value={q.requiredAnswer}
        data={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
        onChange={(v) => set({ requiredAnswer: v, options: options.map((o) => ({ ...o, accepts: o.value === v })) })}
        rightSection={
          <ActionIcon variant="subtle" color="ink" aria-label="More answers"
            onClick={() => set({ type: 'choose_one', options: [...options, { value: '', label: '', accepts: false }] })}>
            <Plus size={14} />
          </ActionIcon>
        }
      />
    )
  }

  return (
    <Stack gap={6}>
      <Text size="sm" fw={600}>Answers</Text>
      {options.map((o, i) => (
        <Group key={i} gap="xs" wrap="nowrap">
          <TextInput
            style={{ flex: 1 }} placeholder="Answer they can pick" value={o.label}
            onChange={(e) => setOption(i, { label: e.currentTarget.value, value: o.value || slugify(e.currentTarget.value, i) })}
          />
          <Checkbox label="finishes it" checked={o.accepts} onChange={() => setOption(i, { accepts: !o.accepts })} />
          <ActionIcon variant="subtle" color="berry" aria-label="Remove answer"
            disabled={options.length <= 2}
            onClick={() => set({ options: options.filter((_, j) => j !== i) })}>
            <Trash2 size={14} />
          </ActionIcon>
        </Group>
      ))}
      <Button size="compact-xs" variant="subtle" leftSection={<Plus size={12} />}
        onClick={() => set({ options: [...options, { value: '', label: '', accepts: false }] })}>
        Add answer
      </Button>
    </Stack>
  )
}

function ItemsEditor({ q, set }) {
  const items = q.items || []
  const setItem = (i, patch) => set({ items: items.map((c, j) => (j === i ? { ...c, ...patch } : c)) })

  return (
    <Stack gap={6}>
      <Text size="sm" fw={600}>Things they must tick off</Text>
      {items.map((c, i) => (
        <Group key={i} gap="xs" wrap="nowrap">
          <TextInput
            style={{ flex: 1 }} placeholder="e.g. Cots stripped" value={c.text}
            onChange={(e) => setItem(i, { text: e.currentTarget.value, id: c.id || slugify(e.currentTarget.value, i) })}
          />
          <Checkbox label="required" checked={c.required !== false} onChange={() => setItem(i, { required: c.required === false })} />
          <ActionIcon variant="subtle" color="berry" aria-label="Remove item"
            onClick={() => set({ items: items.filter((_, j) => j !== i) })}>
            <Trash2 size={14} />
          </ActionIcon>
        </Group>
      ))}
      <Button size="compact-xs" variant="subtle" leftSection={<Plus size={12} />}
        onClick={() => set({ items: [...items, { id: '', text: '', required: true }] })}>
        Add a tick-box
      </Button>
    </Stack>
  )
}

// --------------------------------------------------------------- verified ----
// ONE question, asked once: which module, which thing in it, and how do we know.
//
// It used to offer "attendance is marked" as a rival top-level choice beside
// "they did something in a module" — but attendance IS a module, so the same
// check appeared twice and picking between them meant nothing to anybody.
// A module's hand-written check now appears where it belongs: as the strongest
// answer to "how do we know it's done?" for its own thing.
function VerifiedPicker({ ml, set, activities }) {
  const binding = ml.paramBinding || {}
  const collection = binding.collection?.value || ''
  const op = binding.op?.value || 'any'
  const scoped = binding.scope?.value === 'true'

  // the generic check: everything is a literal on the activity signal
  const setGeneric = (patch) => set({
    moduleKey: 'activity',
    signalKey: 'performed',
    paramBinding: {
      ...binding,
      ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { source: 'literal', value: String(v) }])),
    },
  })

  // which thing is chosen — held in the binding either way, so switching to a
  // module's own check and back does not lose the place
  const pickedModule = activities.find((m) => m.things.some((t) => t.collection === collection))
  const thing = pickedModule?.things.find((t) => t.collection === collection)
  const exact = thing?.exact || []

  // "how do we know": the module's own check first, then the generic ones
  const strictValue = (e) => `strict:${e.moduleKey}.${e.signalKey}`
  const picked = ml.moduleKey && ml.moduleKey !== 'activity'
    ? `strict:${ml.moduleKey}.${ml.signalKey}`
    : op
  const howOptions = [
    ...exact.map((e) => ({ value: strictValue(e), label: e.label })),
    { value: 'any', label: `they have added or changed ${thing ? 'one' : 'it'}` },
    { value: 'created', label: 'they have added a new one' },
    { value: 'updated', label: 'they have changed one' },
  ]
  const strictNote = exact.find((e) => strictValue(e) === picked)?.note

  const setHow = (v) => {
    if (v?.startsWith('strict:')) {
      const [moduleKey, signalKey] = v.slice(7).split('.')
      // the binding is kept so the module/thing selects stay where they are
      return set({ moduleKey, signalKey, paramBinding: binding })
    }
    setGeneric({ collection, op: v, scope: scoped })
  }

  const setThing = (c) => {
    const t = pickedModule?.things.find((x) => x.collection === c)
      || activities.flatMap((m) => m.things).find((x) => x.collection === c)
    // a thing with its own check starts on it — the stronger answer is the
    // better default, and it is the one the module author bothered to write
    if (t?.exact?.length) {
      const e = t.exact[0]
      return set({
        moduleKey: e.moduleKey,
        signalKey: e.signalKey,
        paramBinding: { ...binding, collection: { source: 'literal', value: c }, scope: { source: 'literal', value: 'false' } },
      })
    }
    setGeneric({ collection: c, op: 'any', scope: false })
  }

  return (
    <Stack gap="sm">
      <Group grow>
        <Select
          label="Module" placeholder="Choose" value={pickedModule?.key || null} searchable
          data={activities.map((m) => ({ value: m.key, label: m.label }))}
          onChange={(v) => {
            const mod = activities.find((m) => m.key === v)
            if (mod?.things?.[0]) setThing(mod.things[0].collection)
          }}
        />
        <Select
          label="What" placeholder="Choose" value={collection || null} disabled={!pickedModule} searchable
          data={(pickedModule?.things || []).map((t) => ({ value: t.collection, label: t.label }))}
          onChange={(v) => v && setThing(v)}
        />
      </Group>

      <Select
        label="How do we know it is done?" value={collection ? picked : null} disabled={!collection}
        placeholder="Pick a module first"
        description={strictNote || undefined}
        data={howOptions}
        onChange={(v) => v && setHow(v)}
      />

      {thing?.scoped && !picked.startsWith('strict:') && (
        <Checkbox
          label="Only counts if it was for their own class" checked={scoped}
          onChange={(e) => setGeneric({ collection, op, scope: e.currentTarget.checked })}
        />
      )}

      {collection && (
        <Text size="xs" c="dimmed">
          They cannot tick this themselves — it turns green on its own once the work is there.
        </Text>
      )}
    </Stack>
  )
}

// ------------------------------------------------- on-complete / on-lock ----
// Only rendered when a module has actually published something.
export function HooksEditor({ capabilities, actions, locks, onActions, onLocks, condition }) {
  const modules = capabilities?.modules || []
  const allActions = modules.flatMap((m) => (m.actions || []).map((a) => ({ ...a, moduleKey: m.key, moduleLabel: m.label })))
  const allGuards = modules.flatMap((m) => (m.guards || []).map((g) => ({ ...g, moduleKey: m.key, moduleLabel: m.label })))
  if (!allActions.length && !allGuards.length) return null

  // Which questions can gate an action: only the ones with a fixed answer set.
  // `when` names the QUESTION as well as the answer, because answers are keyed
  // by question id — with several questions there is nothing to look up
  // otherwise, and this is the gate that stops parents being told "your child
  // was fed" after an explicit No.
  const gateable = (condition?.questions || []).filter(
    (q) => (q.type === 'yes_no' || q.type === 'choose_one') && (q.prompt || '').trim(),
  )
  const first = gateable[0] || null

  const toggle = (rows, onChange, row, keyName) => {
    const has = rows.some((r) => r.moduleKey === row.moduleKey && r[keyName] === row.key)
    onChange(has
      ? rows.filter((r) => !(r.moduleKey === row.moduleKey && r[keyName] === row.key))
      : [...rows, {
          moduleKey: row.moduleKey, [keyName]: row.key, paramBinding: {}, config: {},
          ...(keyName === 'actionKey' && first
            ? { when: { questionId: first.id || null, answer: first.requiredAnswer } }
            : {}),
        }])
  }
  const setWhen = (a, patch) => onActions(actions.map((r) => (
    r.moduleKey === a.moduleKey && r.actionKey === a.key ? { ...r, ...patch } : r
  )))
  const setConfig = (a, patch) => onActions(actions.map((r) => (
    r.moduleKey === a.moduleKey && r.actionKey === a.key ? { ...r, config: { ...(r.config || {}), ...patch } } : r
  )))

  return (
    <Stack gap="sm">
      <Divider label="When it is finished" labelPosition="left" />

      {allActions.map((a) => {
        const picked = actions.find((r) => r.moduleKey === a.moduleKey && r.actionKey === a.key)
        const onQuestion = gateable.find((q) => q.id && q.id === picked?.when?.questionId) || first
        return (
          <Stack key={`${a.moduleKey}.${a.key}`} gap="xs">
            <Checkbox label={a.label} checked={!!picked}
              onChange={() => toggle(actions, onActions, a, 'actionKey')} />
            {picked && (
              <Stack gap="xs" pl={28}>
                {(a.configFields || []).map((f) => (
                  <Textarea
                    key={f.name} label={f.label} value={picked.config?.[f.name] || ''}
                    placeholder="e.g. {child} had a good day and ate all of lunch."
                    description={f.placeholders ? `You can use ${Object.keys(f.placeholders).join(' ')} — replaced for each family.` : undefined}
                    onChange={(e) => setConfig(a, { [f.name]: e.currentTarget.value })}
                  />
                ))}
                {gateable.length > 0 && (
                  <Group gap="xs" align="flex-end">
                    {gateable.length > 1 && (
                      <Select
                        label="Only when they answer" w={260}
                        value={picked.when?.questionId || onQuestion?.id || ''}
                        data={gateable.map((q) => ({ value: q.id || q.prompt, label: q.prompt }))}
                        onChange={(v) => setWhen(a, { when: { questionId: v, answer: picked.when?.answer || '' } })}
                      />
                    )}
                    <Select
                      label={gateable.length > 1 ? 'with' : 'Only when they answer'} w={260}
                      value={picked.when?.answer || ''}
                      data={[{ value: '', label: 'any answer that finishes it' },
                        ...((onQuestion?.options) || []).map((o) => ({ value: o.value, label: o.label || o.value }))]}
                      onChange={(v) => setWhen(a, { when: v ? { questionId: onQuestion?.id || null, answer: v } : null })}
                    />
                  </Group>
                )}
              </Stack>
            )}
          </Stack>
        )
      })}

      {allGuards.map((g) => {
        const on = locks.some((r) => r.moduleKey === g.moduleKey && r.guardKey === g.key)
        return (
          <Checkbox
            key={`${g.moduleKey}.${g.key}`} checked={on}
            label={`Lock ${g.label.toLowerCase()} — changing it afterwards needs a manager’s approval`}
            onChange={() => toggle(locks, onLocks, g, 'guardKey')}
          />
        )
      })}
    </Stack>
  )
}
