// "How do we know it's done?"
//
// The engine has three natures and a module/signal/binding vocabulary. None of
// that reaches this screen. A person picks one of three plain answers, and the
// hard cases stay out of the way until asked for.
import {
  Stack, Group, Text, Radio, Checkbox, TextInput, Textarea, Select,
  Button, ActionIcon, Card, Divider,
} from '@mantine/core'
import { Plus, Trash2 } from 'lucide-react'
import { NATURES, NATURE_LABEL, NATURE_HELP, slugify } from '../../services/tasks/conditions'

export default function CompletionEditor({ value, onChange, capabilities }) {
  const set = (patch) => onChange({ ...value, ...patch })
  const activities = capabilities?.activities || []
  // nothing in the app can be checked automatically yet -> do not offer it
  const options = NATURES.filter((n) => n !== 'module_linked' || activities.length > 0)

  return (
    <Stack gap="sm">
      <Radio.Group value={value.nature} onChange={(n) => set({ nature: n })}>
        <Stack gap={6}>
          {options.map((n) => (
            <Radio key={n} value={n} label={NATURE_LABEL[n]} description={NATURE_HELP[n]} />
          ))}
        </Stack>
      </Radio.Group>

      <Divider />

      {value.nature === 'mcq' && <McqEditor mcq={value.mcq} set={(p) => set({ mcq: { ...value.mcq, ...p } })} />}
      {value.nature === 'custom' && <CustomEditor custom={value.custom} set={(p) => set({ custom: { ...value.custom, ...p } })} />}
      {value.nature === 'module_linked' && (
        <VerifiedPicker
          ml={value.moduleLinked}
          set={(p) => set({ moduleLinked: { ...value.moduleLinked, ...p } })}
          activities={activities}
        />
      )}
    </Stack>
  )
}

// ------------------------------------------------------------------- MCQ ----
function McqEditor({ mcq, set }) {
  const setOption = (i, patch) => set({ options: mcq.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) })
  // the 90% case is Yes/No and needs no option editor at all
  const simple = mcq.options.length === 2 && mcq.options[0].value === 'yes' && mcq.options[1].value === 'no'

  return (
    <Stack gap="sm">
      <TextInput
        label="What do you want them to confirm?"
        placeholder="e.g. Did you run the fire drill with your class?"
        value={mcq.question} onChange={(e) => set({ question: e.currentTarget.value })}
      />

      {simple ? (
        <Select
          label="Which answer finishes it" w={220} value={mcq.requiredAnswer}
          data={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
          onChange={(v) => set({ requiredAnswer: v, options: mcq.options.map((o) => ({ ...o, accepts: o.value === v })) })}
          rightSection={
            <ActionIcon variant="subtle" color="ink" aria-label="More answers"
              onClick={() => set({ options: [...mcq.options, { value: '', label: '', accepts: false }] })}>
              <Plus size={14} />
            </ActionIcon>
          }
        />
      ) : (
        <Stack gap={6}>
          <Text size="sm" fw={600}>Answers</Text>
          {mcq.options.map((o, i) => (
            <Group key={i} gap="xs" wrap="nowrap">
              <TextInput
                style={{ flex: 1 }} placeholder="Answer they can pick" value={o.label}
                onChange={(e) => setOption(i, { label: e.currentTarget.value, value: o.value || slugify(e.currentTarget.value, i) })}
              />
              <Checkbox label="finishes it" checked={o.accepts} onChange={() => setOption(i, { accepts: !o.accepts })} />
              <ActionIcon variant="subtle" color="berry" aria-label="Remove answer"
                disabled={mcq.options.length <= 2}
                onClick={() => set({ options: mcq.options.filter((_, j) => j !== i) })}>
                <Trash2 size={14} />
              </ActionIcon>
            </Group>
          ))}
          <Button size="compact-xs" variant="subtle" leftSection={<Plus size={12} />}
            onClick={() => set({ options: [...mcq.options, { value: '', label: '', accepts: false }] })}>
            Add answer
          </Button>
        </Stack>
      )}

      <Checkbox label="Make them attach a photo as well" checked={!!mcq.requireMedia}
        onChange={(e) => set({ requireMedia: e.currentTarget.checked })} />
    </Stack>
  )
}

// ---------------------------------------------------------------- custom ----
function CustomEditor({ custom, set }) {
  const list = custom.checklist || []
  const setItem = (i, patch) => set({ checklist: list.map((c, j) => (j === i ? { ...c, ...patch } : c)) })

  return (
    <Stack gap="sm">
      <Textarea
        label="What counts as done?"
        placeholder="Leave blank if their word is enough. Otherwise: every cot stripped, linen bagged, room aired for 20 minutes."
        value={custom.statement} onChange={(e) => set({ statement: e.currentTarget.value })}
      />

      <Stack gap={6}>
        <Text size="sm" fw={600}>Things they must tick off (optional)</Text>
        {list.map((c, i) => (
          <Group key={i} gap="xs" wrap="nowrap">
            <TextInput
              style={{ flex: 1 }} placeholder="e.g. Cots stripped" value={c.text}
              onChange={(e) => setItem(i, { text: e.currentTarget.value, id: c.id || slugify(e.currentTarget.value, i) })}
            />
            <Checkbox label="required" checked={c.required} onChange={() => setItem(i, { required: !c.required })} />
            <ActionIcon variant="subtle" color="berry" aria-label="Remove item"
              onClick={() => set({ checklist: list.filter((_, j) => j !== i) })}>
              <Trash2 size={14} />
            </ActionIcon>
          </Group>
        ))}
        <Button size="compact-xs" variant="subtle" leftSection={<Plus size={12} />}
          onClick={() => set({ checklist: [...list, { id: '', text: '', required: true }] })}>
          Add a tick-box
        </Button>
      </Stack>

      <Checkbox label="Make them write a short note" checked={!!custom.requireNote}
        onChange={(e) => set({ requireNote: e.currentTarget.checked })} />
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

  const mcq = condition?.nature === 'mcq' ? condition.mcq : null
  const toggle = (rows, onChange, row, keyName) => {
    const has = rows.some((r) => r.moduleKey === row.moduleKey && r[keyName] === row.key)
    onChange(has
      ? rows.filter((r) => !(r.moduleKey === row.moduleKey && r[keyName] === row.key))
      : [...rows, {
          moduleKey: row.moduleKey, [keyName]: row.key, paramBinding: {}, config: {},
          ...(keyName === 'actionKey' && mcq ? { when: { answer: mcq.requiredAnswer } } : {}),
        }])
  }
  const setWhen = (a, answer) => onActions(actions.map((r) => (
    r.moduleKey === a.moduleKey && r.actionKey === a.key ? { ...r, when: answer ? { answer } : null } : r
  )))
  const setConfig = (a, patch) => onActions(actions.map((r) => (
    r.moduleKey === a.moduleKey && r.actionKey === a.key ? { ...r, config: { ...(r.config || {}), ...patch } } : r
  )))

  return (
    <Stack gap="sm">
      <Divider label="When it is finished" labelPosition="left" />

      {allActions.map((a) => {
        const picked = actions.find((r) => r.moduleKey === a.moduleKey && r.actionKey === a.key)
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
                {mcq && (
                  <Select
                    label="Only when they answer" w={260} value={picked.when?.answer || ''}
                    data={[{ value: '', label: 'any answer that finishes it' },
                      ...(mcq.options || []).map((o) => ({ value: o.value, label: o.label || o.value }))]}
                    onChange={(v) => setWhen(a, v)}
                  />
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
