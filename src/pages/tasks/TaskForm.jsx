// Assign a task.
//
// Six steps, in the order somebody actually thinks:
//   1 what   2 when it is due   3 does it repeat   4 who for   5 how it is
//   confirmed   6 extra rules
//
// The old form asked what → who → when, put every field on screen at once, and
// listed the whole organisation as identical chips. Each step here collapses to
// a one-line summary once answered, so the page stays the length of the decision
// still to be made.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Stack, Card, Group, Text, Title, TextInput, Textarea, Select, NumberInput,
  SegmentedControl, Checkbox, Button, ActionIcon, Collapse, Badge, Alert, Loader, MultiSelect, Divider, Modal,
} from '@mantine/core'
import { DateInput, TimeInput } from '@mantine/dates'
import { ArrowLeft, ChevronDown, ChevronRight, Lock, Info, BookmarkPlus } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { useOrgMe, useDownline, useOrgTree } from '../../services/org/api'
import { flattenTree } from '../../services/org/tree'
import { useCategories, usePriorities, useTags, useTask, useTaskAct, useCapabilities, previewTargets } from '../../services/tasks/api'
import { useGet, useAct } from '../../api/hooks'
import { WEEKDAYS, describeRecurrence, nextOccurrences } from '../../services/tasks/recurrence'
import { conditionToForm, formToCondition, describeCondition, conditionReady as isConditionReady, MODE_LABEL } from '../../services/tasks/conditions'
import CompletionEditor, { HooksEditor } from './CompletionEditor'
import TargetPicker, { targetFromPick, describePick } from './TargetPicker'

const todayISO = () => new Date().toISOString().slice(0, 10)
const addDaysISO = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const toDate = (s) => (s ? new Date(`${s}T00:00:00`) : null)
const fromDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)

// "By end of their day" is per-person now, so the form has to say whose day and
// when. With one recipient it names the time; with several it says so rather than
// picking one and being wrong for everybody else.
function whoseDayEndsWhen(preview) {
  const people = preview?.people || []
  if (!people.length) return 'Ends when their working day does.'
  const ends = people.map((p) => {
    const slots = Object.values(p.hours || {}).map((h) => h?.to).filter(Boolean)
    return slots.length ? slots.sort().slice(-1)[0] : null
  })
  const set = [...new Set(ends)]
  if (people.length === 1) {
    return ends[0]
      ? `${people[0].userName}’s day ends at ${ends[0]}, so it is due at ${ends[0]}.`
      : `No working hours are set for ${people[0].userName}, so it is due at the end of the day.`
  }
  if (set.length === 1 && set[0]) return `Everyone you picked finishes at ${set[0]}, so it is due then.`
  const none = ends.filter((e) => !e).length
  return none === ends.length
    ? 'Nobody you picked has working hours set, so it is due at the end of the day.'
    : `Each person’s own end of day${none ? ` — ${none} of ${ends.length} have no hours set and get the end of the day` : ''}.`
}

// A numbered step. Closed, it still shows what it is set to — folded, not hidden.
function Step({ n, title, summary, children, open, onToggle, done }) {
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <Card padding="md">
      <Group
        gap="sm" wrap="nowrap" onClick={onToggle}
        style={{ cursor: 'pointer' }} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle() }}
      >
        <Badge circle variant={done ? 'filled' : 'light'} color={done ? 'teal' : 'ink'} size="lg">{n}</Badge>
        <Text fw={700} size="sm">{title}</Text>
        <div style={{ flex: 1 }} />
        {!open && <Text size="xs" c="dimmed" ta="right" lineClamp={1}>{summary}</Text>}
        <Chevron size={16} style={{ color: 'var(--mantine-color-dimmed)', flexShrink: 0 }} />
      </Group>
      <Collapse in={open}><div style={{ paddingTop: 14 }}>{children}</div></Collapse>
    </Card>
  )
}

export default function TaskForm() {
  const { id } = useParams()
  const { data: me, isLoading: meLoading } = useOrgMe()
  const { data: downline = [] } = useDownline()
  const { data: categories = [] } = useCategories()
  const { data: priorities = [] } = usePriorities()
  const { data: tags = [] } = useTags()
  const { data: capabilities } = useCapabilities()
  const { data: templates = [] } = useGet('/task-templates')
  const { data: existing, isLoading: taskLoading } = useTask(id)

  if (meLoading || (id && taskLoading)) return <Loader />
  if (id && !existing) return <Card withBorder padding="lg"><Text ta="center" c="dimmed">Task not found.</Text></Card>
  if (!me?.canAssign) {
    return (
      <Card withBorder padding="lg">
        <Text ta="center" c="dimmed">
          You have nobody below you in the org tree yet, so there is no one to assign work to.
        </Text>
      </Card>
    )
  }

  const src = existing || {}
  const initial = formFromTask(src)

  return <Inner taskId={id} initial={initial} me={me} downline={downline} categories={categories}
    priorities={priorities} tags={tags} capabilities={capabilities} templates={templates} />
}

// A task-shaped object -> the form's own state. Named and lifted out because a
// TEMPLATE is exactly a task-shaped object, so applying one is this function
// and nothing else.
function formFromTask(src = {}) {
  return {
    title: src.title || '',
    description: src.description || '',
    categoryId: src.categoryId || '',
    priority: src.priority || '',
    tagIds: src.tagIds || [],
    // 2 — deadline
    dueMode: src.dueType === 'at_time' ? 'at_time' : src.dueType === 'n_days' ? 'n_days' : 'end_of_day',
    dueDate: src.recurrence?.startDate || todayISO(),
    dueTime: src.dueConfig?.time || '17:00',
    days: src.dueConfig?.days || 2,
    // when it CLOSES, which is not the deadline: late is still doable,
    // closed is not
    expiryMode: src.expiry?.mode || 'never',
    expiryDays: src.expiry?.days || 7,
    // 3 — repeat
    freq: src.recurrence?.freq || 'none',
    byWeekday: src.recurrence?.byWeekday?.length ? src.recurrence.byWeekday : [1, 3, 5],
    dayOfMonth: src.recurrence?.dayOfMonth || 5,
    recEnd: src.recurrence?.endDate || '',
    skipNonWorkingDays: src.recurrence?.skipNonWorkingDays ?? true,
    // 4 — who
    pick: {
      nodeIds: src.target?.nodeIds || [],
      // levelIds is the current shape; levelId is what tasks saved before
      // multi-role selection carry, so editing one of those still shows its role
      levelIds: src.target?.levelIds?.length
        ? src.target.levelIds
        : src.target?.levelId ? [src.target.levelId] : [],
      positionIds: src.target?.positionIds || [],
      excludePositionIds: src.target?.excludePositionIds || [],
    },
    // 5 — confirmation
    completion: conditionToForm(src.completionCondition),
    onCompleteActions: src.onComplete?.actions || [],
    lockOnComplete: src.lockOnComplete || [],
    // 6 — extras
    requiresApproval: !!src.requiresApproval,
    approverPositionId: src.approverPositionId || '',
    requiresMedia: !!src.requiresMedia,
    mediaTypes: src.mediaTypes?.length ? src.mediaTypes : ['photo'],
    minAttachments: src.minAttachments || 1,
    isBlocking: !!src.isBlocking,
  }
}

function Inner({ taskId: id, initial, me, downline, categories, priorities, tags, capabilities, templates = [] }) {
  const navigate = useNavigate()
  const { activeSessionId } = useStore()
  const act = useTaskAct()
  const tplAct = useAct(['/task-templates'])

  const [form, setForm] = useState(initial)
  const [step, setStep] = useState(id ? null : 1)
  const [preview, setPreview] = useState(null)
  const [saveAs, setSaveAs] = useState(null)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // COPY ON APPLY. The payload becomes form state and the link ends there —
  // nothing stores a templateId, so editing a template later cannot rewrite
  // work already assigned. `pick` is kept: a template carries the work, never
  // the people, because a frozen list of positions goes stale in silence.
  const applyTemplate = (tpl) => {
    if (!tpl) return
    setForm((f) => ({ ...formFromTask(tpl.payload || {}), pick: f.pick }))
    setStep(1)
    toast.success(`Started from “${tpl.name}”`)
  }

  const target = targetFromPick(form.pick)
  const repeats = form.freq !== 'none'
  const { data: tree } = useOrgTree()
  const orgNodes = flattenTree(tree?.tree).flat

  // live "who gets this" — the same resolver the server runs on save
  useEffect(() => {
    let cancelled = false
    previewTargets(target)
      .then((res) => { if (!cancelled) setPreview(res) })
      .catch(() => { if (!cancelled) setPreview(null) })
    return () => { cancelled = true }
  }, [JSON.stringify(target)])   // eslint-disable-line react-hooks/exhaustive-deps

  const rec = {
    freq: form.freq, byWeekday: form.byWeekday, dayOfMonth: form.dayOfMonth, interval: 1,
    startDate: form.dueDate, endDate: form.recEnd || null, skipNonWorkingDays: form.skipNonWorkingDays,
  }
  const dueType = form.dueMode === 'n_days' ? 'n_days' : form.dueMode === 'at_time' ? 'at_time' : 'end_of_day'

  function buildBody() {
    return {
      title: form.title.trim(),
      description: form.description.trim(),
      categoryId: form.categoryId || null,
      priority: form.priority || null,
      tagIds: form.tagIds,
      target,
      dueType,
      dueConfig: { startDate: form.dueDate, dueDate: form.dueDate, days: Number(form.days), time: form.dueTime },
      expiry: {
        mode: form.expiryMode,
        days: form.expiryMode === 'after_days' ? Number(form.expiryDays) : null,
      },
      recurrence: { ...rec, count: null },
      requiresApproval: form.requiresApproval,
      approverPositionId: form.approverPositionId || null,
      requiresMedia: form.requiresMedia,
      mediaTypes: form.mediaTypes,
      minAttachments: Number(form.minAttachments),
      isBlocking: form.isBlocking,
      academicYearId: activeSessionId || null,
      completionCondition: formToCondition(form.completion),
      onComplete: { actions: form.onCompleteActions },
      lockOnComplete: form.lockOnComplete,
    }
  }

  function save() {
    const body = buildBody()
    const done = (res) => navigate('/tasks/assigned', { replace: true, state: { openTaskId: res?.id } })
    if (id) act.mutate({ method: 'put', path: `/tasks/${id}`, body, success: 'Task updated' }, { onSuccess: done })
    else {
      act.mutate({ path: '/tasks', body }, {
        onSuccess: (res) => {
          toast.success(`Assigned to ${res.assignedCount} ${res.assignedCount === 1 ? 'person' : 'people'}`)
          done(res)
        },
      })
    }
  }

  const c = form.completion
  const conditionReady = isConditionReady(c)
  const canSave = form.title.trim() && preview?.count > 0 && !preview?.rejected?.length && conditionReady

  const whenSummary = form.dueMode === 'n_days'
    ? `within ${form.days} day${Number(form.days) === 1 ? '' : 's'}`
    : form.dueMode === 'at_time'
      ? `by ${form.dueTime}${repeats ? ' each day' : ` on ${form.dueDate}`}`
      : repeats ? 'by the end of each working day' : `by the end of their working day on ${form.dueDate === todayISO() ? 'today' : form.dueDate}`
  // role names for the read-back come off the downline rows themselves, so the
  // footer sentence never has to say "that role"
  const whoSummary = describePick(form.pick, {
    nodes: orgNodes,
    levels: downline.map((p) => ({ levelId: p.levelId, name: p.tier })),
    people: downline,
  }).text
  const extras = [
    form.requiresMedia && 'photo needed',
    form.requiresApproval && 'needs sign-off',
    form.isBlocking && 'mandatory',
    // only worth saying when it is not the everyday default
    (() => {
      const p = priorities.find((x) => x.id === form.priority)
      return p && !p.isDefault ? p.name.toLowerCase() : null
    })(),
    form.tagIds.length ? `${form.tagIds.length} tag${form.tagIds.length > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ') || 'nothing extra'

  const toggle = (n) => setStep(step === n ? null : n)

  return (
    <Stack gap="md" pb={40}>
      <Group gap="sm">
        <ActionIcon variant="subtle" color="ink" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft size={16} />
        </ActionIcon>
        <Title order={1}>{id ? 'Edit task' : 'Assign a task'}</Title>
      </Group>

      {!id && templates.length > 0 && (
        <Card withBorder padding="sm">
          <Group gap="sm" align="flex-end" wrap="wrap">
            <Select
              label="Start from a template" placeholder="Blank task" w={280} clearable searchable
              description="Fills in everything except who it is for"
              data={templates.map((t) => ({ value: t.id, label: t.name }))}
              onChange={(v) => applyTemplate(templates.find((t) => t.id === v))}
            />
          </Group>
        </Card>
      )}

      <Step n={1} title="What is the task?" open={step === 1} onToggle={() => toggle(1)}
        done={!!form.title.trim()} summary={form.title || 'Not named yet'}>
        <Stack gap="sm">
          <TextInput
            label="What needs doing?" placeholder="e.g. Mark class attendance" data-autofocus
            value={form.title} onChange={(e) => set('title', e.currentTarget.value)}
          />
          <Textarea
            label="Anything they need to know (optional)" placeholder="Detail that helps them do it properly"
            value={form.description} onChange={(e) => set('description', e.currentTarget.value)}
          />
        </Stack>
      </Step>

      <Step n={2} title="When is it due?" open={step === 2} onToggle={() => toggle(2)} done summary={whenSummary}>
        <Stack gap="sm">
          {!repeats && (
            <Group gap="xs">
              <Button size="xs" variant={form.dueDate === todayISO() ? 'filled' : 'default'}
                onClick={() => set('dueDate', todayISO())}>Today</Button>
              <Button size="xs" variant={form.dueDate === addDaysISO(1) ? 'filled' : 'default'}
                onClick={() => set('dueDate', addDaysISO(1))}>Tomorrow</Button>
              <DateInput value={toDate(form.dueDate)} onChange={(d) => set('dueDate', fromDate(d) || todayISO())}
                placeholder="Pick a date" w={170} />
            </Group>
          )}
          <SegmentedControl
            value={form.dueMode} onChange={(v) => set('dueMode', v)} size="xs"
            data={[
              { label: 'By end of their day', value: 'end_of_day' },
              { label: 'By a set time', value: 'at_time' },
              { label: 'Within N days', value: 'n_days' },
            ]}
          />
          {form.dueMode === 'end_of_day' && (
            <Text size="xs" c="dimmed">{whoseDayEndsWhen(preview)}</Text>
          )}
          {form.dueMode === 'at_time' && (
            <TimeInput label="Due by" value={form.dueTime} w={150}
              onChange={(e) => set('dueTime', e.currentTarget.value)} />
          )}
          {form.dueMode === 'n_days' && (
            <NumberInput label="Days to finish it" min={1} w={150}
              value={form.days} onChange={(v) => set('days', v || 1)} />
          )}
          {form.isBlocking && form.dueMode === 'at_time' && (
            <Alert variant="light" color="ink" icon={<Info size={15} />} p="xs">
              <Text size="xs">
                It counts as late after {form.dueTime}, but it only holds their sign-off once the day is over —
                nobody is locked out mid-afternoon.
              </Text>
            </Alert>
          )}

          <Divider label="And if they miss it?" labelPosition="left" />
          <SegmentedControl
            value={form.expiryMode} onChange={(v) => set('expiryMode', v)} size="xs"
            data={[
              { label: 'It waits for them', value: 'never' },
              { label: 'It closes that night', value: 'end_of_day' },
              { label: 'It closes after N days', value: 'after_days' },
            ]}
          />
          {form.expiryMode === 'after_days' && (
            <NumberInput label="Days of grace after the deadline" min={1} w={220}
              value={form.expiryDays} onChange={(v) => set('expiryDays', v || 1)} />
          )}
          <Text size="xs" c="dimmed">
            {form.expiryMode === 'never'
              ? 'It goes late and stays on their list until it is done. That is what every task does today.'
              : form.expiryMode === 'end_of_day'
                ? 'Late from the deadline, closed at midnight. After that it cannot be done at all — and it stops holding their sign-off.'
                : `Late from the deadline, closed ${form.expiryDays} day${Number(form.expiryDays) === 1 ? '' : 's'} later. After that it cannot be done at all.`}
          </Text>
        </Stack>
      </Step>

      <Step n={3} title="Does it repeat?" open={step === 3} onToggle={() => toggle(3)} done
        summary={repeats ? describeRecurrence(rec) : 'One-off'}>
        <Stack gap="sm">
          <SegmentedControl
            value={repeats ? 'repeat' : 'once'} size="xs"
            onChange={(v) => set('freq', v === 'once' ? 'none' : 'daily')}
            data={[{ label: 'Just once', value: 'once' }, { label: 'It repeats', value: 'repeat' }]}
          />
          {repeats && (
            <>
              <Group grow>
                <Select label="How often" value={form.freq} onChange={(v) => set('freq', v || 'daily')}
                  data={[
                    { value: 'daily', label: 'Every day' },
                    { value: 'weekdays', label: 'Certain weekdays' },
                    { value: 'weekly', label: 'Weekly' },
                    { value: 'monthly', label: 'Monthly' },
                  ]} />
                <DateInput label="Starting" value={toDate(form.dueDate)}
                  onChange={(d) => set('dueDate', fromDate(d) || todayISO())} />
              </Group>
              {form.freq === 'weekdays' && (
                <Group gap={6}>
                  {WEEKDAYS.map((d, i) => (
                    <Button key={d} size="compact-xs"
                      variant={form.byWeekday.includes(i) ? 'filled' : 'default'}
                      onClick={() => set('byWeekday', form.byWeekday.includes(i)
                        ? form.byWeekday.filter((x) => x !== i) : [...form.byWeekday, i])}>
                      {d}
                    </Button>
                  ))}
                </Group>
              )}
              {form.freq === 'weekly' && (
                <Select label="Which day" value={String(form.byWeekday[0])} w={180}
                  onChange={(v) => set('byWeekday', [Number(v)])}
                  data={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} />
              )}
              {form.freq === 'monthly' && (
                <NumberInput label="Day of the month" min={1} max={31} w={180}
                  value={form.dayOfMonth} onChange={(v) => set('dayOfMonth', v || 1)} />
              )}
              <Checkbox label="Skip weekly offs and school holidays" checked={form.skipNonWorkingDays}
                onChange={(e) => set('skipNonWorkingDays', e.currentTarget.checked)} />
              <DateInput label="Stop repeating on (optional)" clearable w={220}
                value={toDate(form.recEnd)} onChange={(d) => set('recEnd', fromDate(d) || '')} />
              <Text size="xs" c="dimmed">Next: {nextOccurrences(rec, todayISO(), 4).join(', ')}</Text>
            </>
          )}
        </Stack>
      </Step>

      <Step n={4} title="Who is it for?" open={step === 4} onToggle={() => toggle(4)}
        done={preview?.count > 0} summary={preview ? `${preview.count} people · ${whoSummary}` : whoSummary}>
        <TargetPicker value={form.pick} onChange={(pick) => set('pick', pick)} preview={preview} />
      </Step>

      <Step n={5} title="How do we know it is done?" open={step === 5} onToggle={() => toggle(5)}
        done={conditionReady} summary={`${MODE_LABEL[c.mode]} — ${describeCondition(c, capabilities)}`}>
        <Stack gap="sm">
          <CompletionEditor
            value={form.completion} capabilities={capabilities}
            onChange={(completion) => setForm((f) => ({
              ...f,
              completion,
              // `proof` is where the media rule is AUTHORED; requiresMedia is
              // where it is enforced, in 8 server files and 6 client ones. One
              // authored place, every reader unchanged.
              requiresMedia: completion.proof?.required ? true : f.requiresMedia,
            }))}
          />
          <HooksEditor
            capabilities={capabilities}
            condition={c}
            actions={form.onCompleteActions}
            locks={form.lockOnComplete}
            onActions={(v) => set('onCompleteActions', v)}
            onLocks={(v) => set('lockOnComplete', v)}
          />
        </Stack>
      </Step>

      <Step n={6} title="Extra rules" open={step === 6} onToggle={() => toggle(6)} done summary={extras}>
        <Stack gap="sm">
          <Checkbox label="They must attach a photo or file as proof" checked={form.requiresMedia}
            onChange={(e) => set('requiresMedia', e.currentTarget.checked)} />
          {form.requiresMedia && (
            <Group grow>
              <Select label="What kind" value={form.mediaTypes[0]} onChange={(v) => set('mediaTypes', [v])}
                data={[{ value: 'photo', label: 'Photo' }, { value: 'document', label: 'Document' }, { value: 'video', label: 'Video' }]} />
              <NumberInput label="How many" min={1} value={form.minAttachments} onChange={(v) => set('minAttachments', v || 1)} />
            </Group>
          )}

          <Checkbox label="A manager must sign it off before it counts" checked={form.requiresApproval}
            onChange={(e) => set('requiresApproval', e.currentTarget.checked)} />
          {form.requiresApproval && (
            <Select label="Who signs off" searchable clearable
              placeholder={`Me (${me?.tier})`} value={form.approverPositionId}
              onChange={(v) => set('approverPositionId', v || '')}
              data={[...(me?.positions || []), ...downline].map((p) => ({ value: p.id, label: `${p.userName} · ${p.tier}` }))} />
          )}

          <Checkbox checked={form.isBlocking} onChange={(e) => set('isBlocking', e.currentTarget.checked)}
            label={
              <Group gap={6}>
                <Lock size={13} /> <span>They cannot log out until this is done</span>
                {form.isBlocking && <Badge color="marmalade" size="xs">enforced on the server</Badge>}
              </Group>
            } />

          <Group grow>
            {/* ordered by rank, which is what survives a rename — never by name */}
            <Select
              label="Priority" clearable
              placeholder={priorities.find((p) => p.isDefault)?.name || 'Normal'}
              value={form.priority || null} onChange={(v) => set('priority', v || '')}
              data={priorities.map((p) => ({ value: p.id, label: p.name }))} />
            <Select label="Category" clearable placeholder="None" value={form.categoryId}
              onChange={(v) => set('categoryId', v || '')}
              data={categories.map((cat) => ({ value: cat.id, label: cat.name }))} />
          </Group>

          {tags.length > 0 && (
            <MultiSelect
              label="Tags" placeholder="None"
              description="A controlled list — Setup › Task setup › Tags is where new ones are added"
              value={form.tagIds} onChange={(v) => set('tagIds', v)}
              data={tags.map((t) => ({ value: t.id, label: t.name }))} />
          )}
        </Stack>
      </Step>

      {/* the decision point: the whole task in words, next to the button */}
      <Card padding="md" withBorder>
        <Group justify="space-between" wrap="nowrap" align="flex-end">
          <Text size="sm" style={{ flex: 1 }}>
            <b>{preview?.count ? whoSummary : 'Nobody yet'}</b>{' '}
            {form.title.trim() ? `must do “${form.title.trim()}” ${whenSummary}.` : 'have not been given a task yet.'}
            {form.title.trim() && ` Finished when ${describeCondition(c, capabilities)}.`}
          </Text>
          <Group gap="xs" wrap="nowrap">
            <Button variant="default" onClick={() => navigate(-1)}>Cancel</Button>
            <Button variant="default" disabled={!form.title.trim()}
              leftSection={<BookmarkPlus size={14} />}
              onClick={() => setSaveAs({ name: form.title.trim(), description: '' })}>
              Save as template
            </Button>
            <Button disabled={!canSave} loading={act.isPending} onClick={save}>
              {id ? 'Save changes' : `Assign to ${preview?.count || 0}`}
            </Button>
          </Group>
        </Group>
        {!canSave && (
          <Text size="xs" c="dimmed" mt={6}>
            {!form.title.trim() ? 'Step 1 — name the task'
              : !preview?.count ? 'Step 4 — choose who it is for'
                : preview?.rejected?.length ? 'Step 4 — remove the people you cannot assign to'
                  : 'Step 5 — finish the confirmation rule'}
          </Text>
        )}
      </Card>

      {saveAs && (
        <Modal opened onClose={() => setSaveAs(null)} title="Save this as a template">
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Everything on this form is kept except who it is for. Applying it later copies
              these settings into a fresh task — changing the template afterwards does not
              touch work that has already gone out.
            </Text>
            <TextInput
              label="Template name" required data-autofocus
              value={saveAs.name} onChange={(e) => setSaveAs({ ...saveAs, name: e.currentTarget.value })}
            />
            <Textarea
              label="What is it for?" autosize minRows={2}
              placeholder="e.g. The daily close-down checklist for any classroom"
              value={saveAs.description}
              onChange={(e) => setSaveAs({ ...saveAs, description: e.currentTarget.value })}
            />
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => setSaveAs(null)}>Cancel</Button>
              <Button
                disabled={!saveAs.name.trim()} loading={tplAct.isPending}
                onClick={() => tplAct.mutate(
                  {
                    path: '/task-templates',
                    body: { name: saveAs.name.trim(), description: saveAs.description.trim(), payload: buildBody() },
                    success: 'Saved as a template',
                  },
                  { onSuccess: () => setSaveAs(null) },
                )}
              >
                Save template
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  )
}
