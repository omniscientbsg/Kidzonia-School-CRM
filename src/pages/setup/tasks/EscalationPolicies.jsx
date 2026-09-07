// Escalation policies — the first screen these have ever had.
//
// The engine, the SLA clock, the ancestor walk and the audit trail all exist and
// are tested, but `escalationPolicies` has zero rows because there was no way to
// write one. A feature nobody has configured is indistinguishable from a feature
// that does not work.
//
// The vocabulary here is deliberately not the engine's. Nobody outside the code
// says "resolver" or "SLA breach"; they say "who it goes to next" and "how long
// they get".
import { useState } from 'react'
import {
  Stack, Group, Text, Title, Card, Button, ActionIcon, Modal, TextInput,
  NumberInput, Select, Checkbox, Badge, Loader, Alert, Divider,
} from '@mantine/core'
import { Plus, Pencil, Trash2, Info, ArrowDown } from 'lucide-react'
import { useGet, useAct } from '../../../api/hooks'
import { useOrgLevels } from '../../../services/org/api'
import { useStore } from '../../../store/useStore'

const MANAGE_ROLES = ['super_admin', 'branch_admin', 'hq_coordinator', 'school_owner']

// The engine's four resolvers, in words a principal would use.
const WHO = [
  { value: 'named', label: 'The person named on the task' },
  { value: 'next_ancestor', label: 'Whoever is directly above them' },
  { value: 'tier', label: 'A particular job title' },
  { value: 'node_admin', label: 'The top of their reporting line' },
]

// onFinalBreach, in the same register.
const AT_THE_END = [
  { value: 'notify_only', label: 'Tell everyone above them and stop' },
  { value: 'raise_task', label: 'Give whoever is holding it a mandatory task of their own' },
  { value: 'auto_approve', label: 'Approve it automatically' },
]

const hours = (m) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`)

function StageRow({ stage, i, levels, onChange, onRemove, canRemove }) {
  return (
    <Card withBorder padding="sm">
      <Group gap="sm" wrap="nowrap" align="flex-end">
        <Badge circle variant="light" color="ink" size="lg">{i + 1}</Badge>
        <Select
          label={i === 0 ? 'Starts with' : 'Then goes to'} style={{ flex: 2 }}
          data={WHO} value={stage.resolver}
          onChange={(v) => onChange({ ...stage, resolver: v || 'next_ancestor' })}
        />
        {stage.resolver === 'tier' && (
          <Select
            label="Which title" style={{ flex: 2 }} searchable
            data={levels.map((l) => ({ value: l.id, label: l.name }))}
            value={stage.levelId || null}
            onChange={(v) => onChange({ ...stage, levelId: v })}
          />
        )}
        <NumberInput
          label="They get" style={{ flex: 1 }} min={1} suffix=" min"
          value={stage.slaMinutes} onChange={(v) => onChange({ ...stage, slaMinutes: Number(v) || 60 })}
        />
        <ActionIcon variant="subtle" color="berry" aria-label="Remove stage" disabled={!canRemove} onClick={onRemove} mb={4}>
          <Trash2 size={15} />
        </ActionIcon>
      </Group>
    </Card>
  )
}

function PolicyModal({ policy, levels, onClose }) {
  const editing = !!policy
  const act = useAct(['/escalation-policies'])
  const [form, setForm] = useState(() => ({
    name: policy?.name || '',
    description: policy?.description || '',
    stages: policy?.stages?.length
      ? policy.stages.map((s) => ({ ...s }))
      : [{ resolver: 'named', levelId: null, slaMinutes: 120 }],
    onFinalBreach: policy?.onFinalBreach || 'notify_only',
    skipNonWorkingDays: policy?.skipNonWorkingDays !== false,
  }))
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setStage = (i, s) => set('stages', form.stages.map((x, j) => (j === i ? s : x)))

  const save = () => {
    const body = { ...form }
    if (editing) act.mutate({ method: 'put', path: `/escalation-policies/${policy.id}`, body, success: 'Policy saved' }, { onSuccess: onClose })
    else act.mutate({ path: '/escalation-policies', body, success: 'Policy created' }, { onSuccess: onClose })
  }

  const badTier = form.stages.some((s) => s.resolver === 'tier' && !s.levelId)

  return (
    <Modal opened onClose={onClose} size="lg" title={editing ? 'Edit policy' : 'New escalation policy'}>
      <Stack gap="sm">
        <TextInput label="Name" required placeholder="e.g. School approvals"
          value={form.name} onChange={(e) => set('name', e.currentTarget.value)} />
        <TextInput label="What it is for" placeholder="Optional"
          value={form.description} onChange={(e) => set('description', e.currentTarget.value)} />

        <Divider label="If nobody decides, it moves up" labelPosition="left" mt="xs" />
        <Stack gap="xs">
          {form.stages.map((s, i) => (
            <StageRow
              key={i} stage={s} i={i} levels={levels}
              canRemove={form.stages.length > 1}
              onChange={(next) => setStage(i, next)}
              onRemove={() => set('stages', form.stages.filter((_, j) => j !== i))}
            />
          ))}
          <Button size="compact-sm" variant="subtle" leftSection={<Plus size={13} />}
            onClick={() => set('stages', [...form.stages, { resolver: 'next_ancestor', levelId: null, slaMinutes: 240 }])}>
            Add another step
          </Button>
        </Stack>

        <Select label="When it runs out of steps" data={AT_THE_END}
          value={form.onFinalBreach} onChange={(v) => set('onFinalBreach', v || 'notify_only')} />
        {form.onFinalBreach === 'auto_approve' && (
          <Alert color="berry" variant="light" icon={<Info size={15} />} p="xs">
            <Text size="xs">
              An approval nobody made still reads as “approved” in the audit log for ever. Only choose
              this where that is genuinely what you want.
            </Text>
          </Alert>
        )}

        <Checkbox label="Don’t count days the school is shut"
          description="A deadline landing on a closed day waits for the next working morning, so Monday does not always look like a breach."
          checked={form.skipNonWorkingDays} onChange={(e) => set('skipNonWorkingDays', e.currentTarget.checked)} />

        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button disabled={!form.name.trim() || badTier} loading={act.isPending} onClick={save}>
            {editing ? 'Save' : 'Create'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

export default function EscalationPolicies() {
  const { user } = useStore()
  const canManage = MANAGE_ROLES.includes(user?.role)
  const { data: rows = [], isLoading, isError, error } = useGet('/escalation-policies')
  const { data: levels = [] } = useOrgLevels()
  const [modal, setModal] = useState(null)

  if (isLoading) return <Loader />
  if (isError) return <Alert color="berry" icon={<Info size={16} />}>{error?.message || 'Could not load policies'}</Alert>

  return (
    <Stack gap="md">
      <Group align="flex-start" wrap="nowrap">
        <div style={{ flex: 1 }}>
          <Title order={2}>Escalation policies</Title>
          <Text size="sm" c="dimmed" mt={2}>
            What happens when a task is submitted and nobody decides. Each step names who it moves to
            and how long they get. It can never leave the person’s own reporting line.
          </Text>
        </div>
        {canManage && <Button leftSection={<Plus size={15} />} onClick={() => setModal({})}>New policy</Button>}
      </Group>

      {rows.length === 0 ? (
        <Card withBorder padding="lg">
          <Stack gap={4} align="center">
            <Text c="dimmed">No policies yet, so an approval waits with the named approver for ever.</Text>
            <Text size="sm" c="dimmed">Attach one to a category and every task in it inherits the ladder.</Text>
          </Stack>
        </Card>
      ) : rows.map((p) => (
        <Card withBorder padding="md" key={p.id}>
          <Group align="flex-start" wrap="nowrap">
            <div style={{ flex: 1 }}>
              <Group gap="xs">
                <Text fw={700}>{p.name}</Text>
                {p.active === false && <Badge color="ink" variant="light">off</Badge>}
                {p.onFinalBreach === 'auto_approve' && <Badge color="berry" variant="light">auto-approves</Badge>}
              </Group>
              {p.description && <Text size="sm" c="dimmed">{p.description}</Text>}
              <Stack gap={2} mt="xs">
                {p.stages.map((s, i) => (
                  <Group key={i} gap={6}>
                    {i > 0 && <ArrowDown size={12} style={{ color: 'var(--mantine-color-dimmed)' }} />}
                    <Text size="sm">
                      {WHO.find((w) => w.value === s.resolver)?.label || s.resolver}
                      {s.resolver === 'tier' && s.levelId ? ` — ${levels.find((l) => l.id === s.levelId)?.name || 'that title'}` : ''}
                      {' · '}
                      <Text span c="dimmed">{hours(s.slaMinutes)}</Text>
                    </Text>
                  </Group>
                ))}
                <Text size="sm" c="dimmed" mt={2}>
                  Then: {AT_THE_END.find((a) => a.value === p.onFinalBreach)?.label.toLowerCase()}
                </Text>
              </Stack>
            </div>
            {canManage && (
              <ActionIcon variant="subtle" color="ink" aria-label="Edit" onClick={() => setModal({ policy: p })}>
                <Pencil size={15} />
              </ActionIcon>
            )}
          </Group>
        </Card>
      ))}

      {modal && <PolicyModal policy={modal.policy} levels={levels} onClose={() => setModal(null)} />}
    </Stack>
  )
}
