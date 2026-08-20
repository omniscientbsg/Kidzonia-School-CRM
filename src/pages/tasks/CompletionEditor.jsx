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
  const verifiable = capabilities?.verifiable || []
  const activities = capabilities?.activities || []
  // nothing in the app can be checked automatically yet -> do not offer it
  const options = NATURES.filter((n) => n !== 'module_linked' || verifiable.length > 0 || activities.length > 0)

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
          verifiable={verifiable}
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
// Two honest kinds. The hand-written signals know what "finished" looks like;
// the generic one only knows the work was touched. Presenting them as the same
// promise would overstate what the system actually verified.
function VerifiedPicker({ ml, set, verifiable, activities }) {
  const isGeneric = ml.moduleKey === 'activity'
  const binding = ml.paramBinding || {}
  const collection = binding.collection?.value || ''
  const op = binding.op?.value || 'any'
  const scoped = binding.scope?.value === 'true'

  const setBinding = (patch) => set({
    moduleKey: 'activity',
    signalKey: 'performed',
    paramBinding: {
      ...binding,
      ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { source: 'literal', value: String(v) }])),
    },
  })

  const pickedModule = activities.find((m) => m.things.some((t) => t.collection === collection))
  const thing = pickedModule?.things.find((t) => t.collection === collection)
  const exact = verifiable.filter((v) => v.moduleKey !== 'activity' && v.precision !== 'performed')
  const current = isGeneric ? 'activity' : (ml.signalKey ? `${ml.moduleKey}.${ml.signalKey}` : '')

  return (
    <Stack gap="sm">
      <Radio.Group
        value={current}
        onChange={(v) => {
          if (v === 'activity') return setBinding({ collection: collection || 'diaryPosts', op, scope: scoped })
          const [moduleKey, signalKey] = v.split('.')
          set({ moduleKey, signalKey, paramBinding: {} })
        }}
      >
        <Stack gap={6}>
          {exact.map((v) => (
            <Radio
              key={`${v.moduleKey}.${v.signalKey}`} value={`${v.moduleKey}.${v.signalKey}`}
              label={v.sentence.replace(/^Completes when /, '')}
              description={`${v.moduleLabel} · knows when it is complete, not just started`}
            />
          ))}
          {activities.length > 0 && (
            <Radio
              value="activity" label="They did something in a module"
              description="Works for every module. Proves the work was done — not that every child was covered."
            />
          )}
        </Stack>
      </Radio.Group>

      {isGeneric && (
        <Card padding="sm" withBorder>
          <Stack gap="sm">
            <Group grow>
              <Select
                label="Module" placeholder="Choose" value={pickedModule?.key || null} searchable
                data={activities.map((m) => ({ value: m.key, label: m.label }))}
                onChange={(v) => {
                  const mod = activities.find((m) => m.key === v)
                  setBinding({ collection: mod?.things?.[0]?.collection || '', op, scope: false })
                }}
              />
              <Select
                label="What" placeholder="Choose" value={collection || null} disabled={!pickedModule} searchable
                data={(pickedModule?.things || []).map((t) => ({ value: t.collection, label: t.label }))}
                onChange={(v) => setBinding({ collection: v, op, scope: false })}
              />
            </Group>
            <Select
              label="Counts as done when they have" value={op}
              data={[
                { value: 'any', label: 'added or changed one' },
                { value: 'created', label: 'added a new one' },
                { value: 'updated', label: 'changed one' },
              ]}
              onChange={(v) => setBinding({ collection, op: v, scope: scoped })}
            />
            {thing?.scoped && (
              <Checkbox
                label="Only counts if it was for their own class" checked={scoped}
                onChange={(e) => setBinding({ collection, op, scope: e.currentTarget.checked })}
              />
            )}
          </Stack>
        </Card>
      )}

      {(isGeneric ? collection : ml.signalKey) && (
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
