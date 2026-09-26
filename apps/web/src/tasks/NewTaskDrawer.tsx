import {
  Autocomplete,
  Button,
  Checkbox,
  Drawer,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import {
  allowsSubtaskAssignees,
  createTaskSchema,
  createdTaskSchema,
  listFieldKey,
  templateSchema,
  updatedTaskSchema,
} from '@kidzonia/shared';
import type { ApproverMode, DueType, Repeat, TaskDetail, TemplatePayload } from '@kidzonia/shared';
import { IconCopy, IconPlus, IconSubtask, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { useMeData } from '../shell/AppLayout';
import { ErrorAlert, errorMessage } from '../ui/errors';
import { notify } from '../ui/notify';
import {
  peoplePage,
  previewSchema,
  targetOptionsSchema,
  taskDetailSchema,
  taskKeys,
  useTaskSetup,
  useTemplates,
} from './api';
import { PersonCell, todayIn } from './bits';
import { MasterModal } from './MasterForm';
import type { MasterKind } from './MasterForm';
import { MessagePreview } from './TaskDrawer';

/** Placeholder class names until classes exist (open decision 13.1). */
const CLASSES = ['Playgroup', 'Nursery A', 'Nursery B', 'KG 1', 'KG 2'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const NEW = '__new';

interface Named {
  id: string;
  fullName: string;
  sub: string;
}

interface Draft {
  title: string;
  description: string;
  categoryId: string | null;
  priorityId: string | null;
  customValues: Record<string, string | null>;
  dueType: DueType;
  dueTime: string;
  dueDate: string;
  repeat: Repeat;
  repeatWeekdays: number[];
  repeatMonthDay: number | null;
  needsApproval: boolean;
  approverMode: ApproverMode;
  approverUserId: string | null;
  approverName: string;
  blocksLogout: boolean;
  parentOn: boolean;
  parentTemplateId: string | null;
  parentClass: string;
  subtasks: { id?: string; title: string; assigneeUserId: string | null }[];
  watchers: { userId: string; access: 'view' | 'edit'; name: string }[];
  people: Named[];
  roleIds: string[];
  schoolIds: string[];
  fromTemplateId: string | null;
}

const blank = (tomorrow: string): Draft => ({
  title: '',
  description: '',
  categoryId: null,
  priorityId: null,
  customValues: {},
  dueType: 'end_of_day',
  dueTime: '15:00',
  dueDate: tomorrow,
  repeat: 'none',
  repeatWeekdays: [],
  repeatMonthDay: null,
  needsApproval: true,
  approverMode: 'creator',
  approverUserId: null,
  approverName: '',
  blocksLogout: false,
  parentOn: false,
  parentTemplateId: null,
  parentClass: 'Nursery A',
  subtasks: [],
  watchers: [],
  people: [],
  roleIds: [],
  schoolIds: [],
  fromTemplateId: null,
});

/** Using a template copies it into the form (brief 9.10); who and when stay yours. */
function fromTemplate(base: Draft, id: string, p: TemplatePayload): Draft {
  return {
    ...base,
    title: p.title,
    description: p.description ?? '',
    categoryId: p.categoryId,
    priorityId: p.priorityId,
    customValues: p.customValues,
    dueType: p.dueType,
    dueTime: p.dueTime ?? base.dueTime,
    repeat: p.repeat,
    repeatWeekdays: p.repeatWeekdays,
    repeatMonthDay: p.repeatMonthDay,
    needsApproval: p.needsApproval,
    approverMode: p.approverMode,
    blocksLogout: p.blocksLogout,
    parentOn: p.parentMessage !== null,
    parentTemplateId: p.parentMessage?.templateId ?? null,
    parentClass: p.parentMessage?.className ?? base.parentClass,
    subtasks: p.subtasks.map((s) => ({ title: s.title, assigneeUserId: null })),
    fromTemplateId: id,
  };
}

function fromTask(base: Draft, t: TaskDetail): Draft {
  const names = new Map(t.people.map((p) => [p.person.id, p.person]));
  return {
    ...base,
    title: t.title ?? '',
    description: t.description ?? '',
    categoryId: t.categoryId ?? null,
    priorityId: t.priorityId ?? null,
    customValues: Object.fromEntries(
      Object.entries(t)
        .filter(([k]) => k.startsWith('list_'))
        .map(([, v]) => {
          const c = v as { listId: string; valueId: string };
          return [c.listId, c.valueId];
        }),
    ),
    dueType: t.dueType ?? 'end_of_day',
    dueTime: t.dueTime ?? base.dueTime,
    dueDate: t.dueDate ?? base.dueDate,
    repeat: t.repeat,
    repeatWeekdays: t.repeatWeekdays,
    repeatMonthDay: t.repeatMonthDay,
    needsApproval: t.needsApproval,
    approverMode: t.approverMode,
    approverUserId: t.approver?.id ?? null,
    approverName: t.approver?.fullName ?? '',
    blocksLogout: t.blocksLogout,
    parentOn: t.parentMessage !== null,
    parentTemplateId: t.parentMessage?.templateId ?? null,
    parentClass: t.parentMessage?.className ?? base.parentClass,
    subtasks: t.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      assigneeUserId: s.assignee?.id ?? null,
    })),
    watchers: (t.watchers ?? []).map((w) => ({
      userId: w.person.id,
      access: w.access,
      name: w.person.fullName,
    })),
    people: (t.target?.userIds ?? []).map((id) => {
      const p = names.get(id);
      return {
        id,
        fullName: p?.fullName ?? 'Someone',
        sub: [p?.jobTitle, p?.schoolName].filter(Boolean).join(', '),
      };
    }),
    roleIds: t.target?.roleIds ?? [],
    schoolIds: t.target?.schoolIds ?? [],
    fromTemplateId: t.fromTemplateId,
  };
}

interface Props {
  editId: string | null;
  templateId: string | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}

/** New task (brief 9.13) and, with `editId`, editing one. */
export function NewTaskDrawer(props: Props) {
  const phone = useMediaQuery('(max-width: 640px)');
  const existing = useQuery({
    queryKey: taskKeys.detail(props.editId ?? '', null),
    queryFn: () => api(`/tasks/${props.editId ?? ''}`, taskDetailSchema),
    enabled: props.editId !== null,
    // The form is filled once from this; don't refresh it under someone's edits.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const ready = props.editId === null || existing.data !== undefined;
  return (
    <Drawer
      opened
      onClose={props.onClose}
      position="right"
      size={phone ? '100%' : 600}
      padding={0}
      title={props.editId ? 'Edit task' : 'New task'}
      classNames={{ header: 'drawer-h', title: 'drawer-title', body: 'drawer-body' }}
    >
      <ErrorAlert error={existing.error} />
      {ready ? (
        <TaskForm {...props} existing={existing.data ?? null} />
      ) : (
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      )}
    </Drawer>
  );
}

function TaskForm({
  editId,
  templateId,
  onClose,
  onSaved,
  existing,
}: Props & { existing: TaskDetail | null }) {
  const { access, me } = useMeData();
  const qc = useQueryClient();
  const setup = useTaskSetup();
  const tz = me.organisation.timezone;
  const today = todayIn(tz);
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const canSetup = access.can('task_setup', 'create') && !access.readOnly;
  const templates = useTemplates(!editId);
  const options = useQuery({
    queryKey: taskKeys.targetOptions,
    queryFn: () => api('/tasks/target-options', targetOptionsSchema),
  });
  const canAssign = options.data?.canAssign ?? false;
  const retarget = !existing || existing.target !== null;

  const [d, setD] = useState<Draft>(() => {
    const base = blank(tomorrow);
    if (existing) return fromTask(base, existing);
    return base;
  });
  const [appliedTemplate, setAppliedTemplate] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
  };
  // A template chosen from Task setup ("Use") fills the form once it loads.
  if (templateId && appliedTemplate !== templateId && templates.data) {
    const tpl = templates.data.items.find((x) => x.id === templateId);
    if (tpl) {
      setAppliedTemplate(templateId);
      setD((x) => fromTemplate(x, tpl.id, tpl.payload));
    }
  }

  // Field permissions: hidden fields aren't shown; view-only ones can't be set.
  const rules = access.primary.role?.isOwner ? {} : (access.primary.role?.fields.tasks ?? {});
  const fieldState = (f: string): 'hidden' | 'view' | 'edit' => {
    const r = rules[f];
    if (!r) return 'edit';
    if (r.access === 'hidden') return 'hidden';
    return r.access === 'view' && r.ownRecord !== 'edit' ? 'view' : 'edit';
  };
  const shown = (f: string) => fieldState(f) !== 'hidden';
  const locked = (f: string) => fieldState(f) === 'view';

  const [master, setMaster] = useState<(MasterKind & { apply: (id: string) => void }) | null>(null);
  const [saveTpl, setSaveTpl] = useState(false);
  const [tplName, setTplName] = useState('');

  const target =
    canAssign || existing
      ? { userIds: d.people.map((p) => p.id), roleIds: d.roleIds, schoolIds: d.schoolIds }
      : { userIds: [me.user.id], roleIds: [], schoolIds: [] };
  const subtaskPeopleAllowed = allowsSubtaskAssignees(target);

  const body = () => ({
    title: d.title,
    description: d.description.trim() || null,
    categoryId: d.categoryId,
    priorityId: d.priorityId,
    customValues: d.customValues,
    dueType: d.dueType,
    dueTime: d.dueType === 'end_of_day' ? null : d.dueType === 'on_date' ? null : d.dueTime,
    dueDate: d.dueType === 'on_date' ? d.dueDate : null,
    repeat: d.dueType === 'on_date' ? 'none' : d.repeat,
    repeatWeekdays: d.repeat === 'weekly' ? d.repeatWeekdays : [],
    repeatMonthDay: d.repeat === 'monthly' ? d.repeatMonthDay : null,
    needsApproval: d.needsApproval,
    approverMode: d.approverMode,
    approverUserId: d.approverMode === 'named_user' ? d.approverUserId : null,
    blocksLogout: d.blocksLogout,
    parentMessage:
      d.parentOn && d.parentTemplateId
        ? { templateId: d.parentTemplateId, className: d.parentClass }
        : null,
    subtasks: d.subtasks.map((s) => ({
      ...(s.id ? { id: s.id } : {}),
      title: s.title,
      assigneeUserId: subtaskPeopleAllowed ? s.assigneeUserId : null,
    })),
    ...(shown('watchers')
      ? { watchers: d.watchers.map((w) => ({ userId: w.userId, access: w.access })) }
      : {}),
    ...(retarget ? { target } : {}),
  });

  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const b = body();
      if (editId) {
        return api(`/tasks/${editId}`, updatedTaskSchema, { method: 'PUT', body: b });
      }
      return api('/tasks', createdTaskSchema, {
        method: 'POST',
        body: { ...b, fromTemplateId: d.fromTemplateId },
      });
    },
    onSuccess: (res) => {
      if ('assigned' in res) {
        notify(
          `Task assigned to ${String(res.assigned)} ${res.assigned === 1 ? 'person' : 'people'}.`,
        );
      } else {
        // Decision 1: say how many copies changed and how many kept the old version.
        const kept =
          res.keptCopies > 0
            ? ` ${String(res.keptCopies)} already started and keep the old version.`
            : '';
        notify(
          `Saved. ${String(res.updatedCopies)} ${res.updatedCopies === 1 ? 'copy' : 'copies'} updated.${kept}`,
        );
      }
      void qc.invalidateQueries({ queryKey: taskKeys.all });
      onSaved(res.id);
    },
  });
  const submit = () => {
    const check = createTaskSchema.safeParse({
      ...body(),
      target: retarget ? target : { userIds: [me.user.id] },
    });
    if (!check.success) {
      setProblem(check.error.issues[0]?.message ?? 'Please check the details.');
      return;
    }
    setProblem(null);
    save.mutate();
  };
  const saveTemplate = useMutation({
    mutationFn: () =>
      api('/task-setup/templates', templateSchema, {
        method: 'POST',
        body: { name: tplName, payload: body() },
      }),
    onSuccess: () => {
      notify('Saved as a template. People and dates aren’t kept.');
      setSaveTpl(false);
      void qc.invalidateQueries({ queryKey: taskKeys.templates });
    },
  });

  const picker = (
    kind: 'category' | 'priority',
    label: string,
    items: { id: string; name: string }[],
    value: string | null,
    onChange: (v: string | null) => void,
  ) => (
    <Select
      label={label}
      placeholder="None"
      clearable
      disabled={locked(kind)}
      data={[
        ...items.map((c) => ({ value: c.id, label: c.name })),
        ...(canSetup ? [{ value: NEW, label: '+ New…' }] : []),
      ]}
      value={value}
      onChange={(v) => {
        if (v === NEW)
          setMaster({
            kind,
            apply: (id) => {
              onChange(id);
            },
          });
        else onChange(v);
      }}
    />
  );

  return (
    <>
      <div className="drawer-scroll">
        {!editId && (templates.data?.items.length ?? 0) > 0 && (
          <div className="banner info">
            <IconCopy size={18} aria-hidden="true" />
            <Select
              label="Start from a template"
              placeholder="Blank task"
              className="grow"
              clearable
              data={(templates.data?.items ?? []).map((x) => ({ value: x.id, label: x.name }))}
              value={d.fromTemplateId}
              onChange={(id) => {
                const tpl = templates.data?.items.find((x) => x.id === id);
                setD((x) =>
                  tpl
                    ? fromTemplate(x, tpl.id, tpl.payload)
                    : {
                        ...blank(tomorrow),
                        people: x.people,
                        roleIds: x.roleIds,
                        schoolIds: x.schoolIds,
                      },
                );
              }}
            />
          </div>
        )}
        <Stack gap="sm">
          <TextInput
            label="Title"
            required
            placeholder="What needs to be done?"
            value={d.title}
            disabled={locked('title')}
            onChange={(e) => {
              set('title', e.currentTarget.value);
            }}
          />
          {shown('description') && (
            <Textarea
              label="Description"
              placeholder="Add details, steps or links"
              autosize
              minRows={2}
              value={d.description}
              disabled={locked('description')}
              onChange={(e) => {
                set('description', e.currentTarget.value);
              }}
            />
          )}
        </Stack>

        {retarget && (
          <section className="sec">
            <h3>
              Assign to <span className="req">*</span>
            </h3>
            {canAssign || existing ? (
              <AssignPicker d={d} setD={setD} options={options.data ?? null} />
            ) : (
              <p className="small muted">This task is for you.</p>
            )}
          </section>
        )}

        {shown('due') && (
          <section className="sec">
            <h3>When</h3>
            <div className="seg" role="group" aria-label="Due">
              {(
                [
                  ['end_of_day', 'End of day'],
                  ['at_time', 'At a time'],
                  ['on_date', 'On a date'],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={d.dueType === v}
                  disabled={locked('due')}
                  onClick={() => {
                    set('dueType', v);
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="two">
              {d.dueType === 'at_time' && (
                <TextInput
                  type="time"
                  label="Time"
                  value={d.dueTime}
                  onChange={(e) => {
                    set('dueTime', e.currentTarget.value);
                  }}
                />
              )}
              {d.dueType === 'on_date' && (
                <TextInput
                  type="date"
                  label="Date"
                  min={today}
                  value={d.dueDate}
                  onChange={(e) => {
                    set('dueDate', e.currentTarget.value);
                  }}
                />
              )}
              {d.dueType === 'end_of_day' && (
                <p className="small muted hint">At the end of each person’s working hours</p>
              )}
              {d.dueType !== 'on_date' && (
                <Select
                  label="Repeat"
                  allowDeselect={false}
                  data={[
                    { value: 'none', label: 'Does not repeat' },
                    { value: 'daily', label: 'Every working day' },
                    { value: 'weekly', label: 'Every week' },
                    { value: 'monthly', label: 'Every month' },
                  ]}
                  value={d.repeat}
                  onChange={(v) => {
                    set('repeat', v ?? 'none');
                  }}
                />
              )}
            </div>
            {d.repeat === 'weekly' && d.dueType !== 'on_date' && (
              <div className="seg days" role="group" aria-label="Days of the week">
                {WEEKDAYS.map((w, i) => (
                  <button
                    key={w}
                    type="button"
                    aria-pressed={d.repeatWeekdays.includes(i)}
                    onClick={() => {
                      set(
                        'repeatWeekdays',
                        d.repeatWeekdays.includes(i)
                          ? d.repeatWeekdays.filter((x) => x !== i)
                          : [...d.repeatWeekdays, i].sort(),
                      );
                    }}
                  >
                    {w}
                  </button>
                ))}
              </div>
            )}
            {d.repeat === 'monthly' && d.dueType !== 'on_date' && (
              <NumberInput
                label="Day of the month"
                min={1}
                max={31}
                value={d.repeatMonthDay ?? ''}
                onChange={(v) => {
                  set('repeatMonthDay', typeof v === 'number' ? v : null);
                }}
                w={180}
              />
            )}
            {d.repeat !== 'none' && d.dueType !== 'on_date' && (
              <p className="small muted">
                Holidays and non-working days are skipped automatically.
              </p>
            )}
          </section>
        )}

        <section className="sec">
          <h3>Details</h3>
          <div className="two">
            {shown('category') &&
              picker('category', 'Category', setup.data?.categories ?? [], d.categoryId, (v) => {
                set('categoryId', v);
              })}
            {shown('priority') &&
              picker('priority', 'Priority', setup.data?.priorities ?? [], d.priorityId, (v) => {
                set('priorityId', v);
              })}
            {(setup.data?.lists ?? [])
              .filter((l) => shown(listFieldKey(l.id)))
              .map((l) => (
                <Select
                  key={l.id}
                  label={l.name}
                  placeholder="None"
                  clearable
                  disabled={locked(listFieldKey(l.id))}
                  data={[
                    ...l.values.map((v) => ({ value: v.id, label: v.value })),
                    ...(canSetup ? [{ value: NEW, label: '+ New…' }] : []),
                  ]}
                  value={d.customValues[l.id] ?? null}
                  onChange={(v) => {
                    const put = (id: string | null) => {
                      setD((x) => ({ ...x, customValues: { ...x.customValues, [l.id]: id } }));
                    };
                    if (v === NEW)
                      setMaster({ kind: 'value', listId: l.id, listName: l.name, apply: put });
                    else put(v);
                  }}
                />
              ))}
          </div>
        </section>

        <section className="sec">
          <h3>Sub-tasks</h3>
          <Subtasks d={d} setD={setD} withPeople={subtaskPeopleAllowed} />
          <p className="small muted">The task can be submitted once every sub-task is ticked.</p>
        </section>

        <section className="sec">
          <h3>Rules</h3>
          <div className="opt">
            <div className="t">
              <b>Needs approval</b>
              <span>Work goes to an approver after it’s submitted</span>
            </div>
            <Switch
              aria-label="Needs approval"
              checked={d.needsApproval}
              onChange={(e) => {
                set('needsApproval', e.currentTarget.checked);
              }}
            />
          </div>
          {d.needsApproval && (
            <Stack gap="xs" mt="xs">
              <Select
                label="Approver"
                allowDeselect={false}
                data={[
                  { value: 'creator', label: `Me (${me.user.fullName})` },
                  { value: 'reporting_manager', label: 'Each person’s reporting manager' },
                  { value: 'named_user', label: 'Someone else' },
                ]}
                value={d.approverMode}
                onChange={(v) => {
                  set('approverMode', v ?? 'creator');
                }}
              />
              {d.approverMode === 'named_user' && (
                <PeopleSearch
                  label="Who approves"
                  path="/tasks/people"
                  exclude={[]}
                  placeholder={d.approverName || 'Search by name'}
                  onPick={(p) => {
                    setD((x) => ({ ...x, approverUserId: p.id, approverName: p.fullName }));
                  }}
                />
              )}
            </Stack>
          )}
          <div className="opt">
            <div className="t">
              <b>Must submit before logging out</b>
              <span>People can’t log out while this is open</span>
            </div>
            <Switch
              aria-label="Must submit before logging out"
              checked={d.blocksLogout}
              onChange={(e) => {
                set('blocksLogout', e.currentTarget.checked);
              }}
            />
          </div>
          <div className="opt">
            <div className="t">
              <b>Message parents when done</b>
              <span>Sends a saved message template to parents</span>
            </div>
            <Switch
              aria-label="Message parents when done"
              checked={d.parentOn}
              onChange={(e) => {
                set('parentOn', e.currentTarget.checked);
              }}
            />
          </div>
          {d.parentOn && (
            <>
              <div className="two">
                <Select
                  label="Template"
                  data={(setup.data?.messageTemplates ?? []).map((m) => ({
                    value: m.id,
                    label: m.name,
                  }))}
                  value={d.parentTemplateId}
                  onChange={(v) => {
                    set('parentTemplateId', v);
                  }}
                />
                <Autocomplete
                  label="Send to parents of"
                  data={CLASSES}
                  value={d.parentClass}
                  onChange={(v) => {
                    set('parentClass', v);
                  }}
                />
              </div>
              {d.parentTemplateId && (
                <div className="tpl">
                  <MessagePreview
                    body={
                      setup.data?.messageTemplates.find((m) => m.id === d.parentTemplateId)?.body ??
                      ''
                    }
                  />
                </div>
              )}
            </>
          )}
        </section>

        {shown('watchers') && retarget && (
          <section className="sec">
            <h3>Watchers</h3>
            <p className="small muted">People from any department who can follow this task.</p>
            {d.watchers.map((w, i) => (
              <div className="check" key={w.userId}>
                <span className="grow">{w.name}</span>
                <div className="seg" role="group" aria-label={`${w.name}’s access`}>
                  {(['view', 'edit'] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      aria-pressed={w.access === a}
                      disabled={locked('watchers')}
                      onClick={() => {
                        setD((x) => ({
                          ...x,
                          watchers: x.watchers.map((y, j) => (j === i ? { ...y, access: a } : y)),
                        }));
                      }}
                    >
                      {a === 'view' ? 'Can view' : 'Can edit'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={`Remove ${w.name}`}
                  onClick={() => {
                    setD((x) => ({
                      ...x,
                      watchers: x.watchers.filter((y) => y.userId !== w.userId),
                    }));
                  }}
                >
                  <IconX size={14} />
                </button>
              </div>
            ))}
            {!locked('watchers') && (
              <PeopleSearch
                label="Add a watcher"
                path="/tasks/people"
                exclude={[me.user.id, ...d.watchers.map((w) => w.userId)]}
                onPick={(p) => {
                  setD((x) => ({
                    ...x,
                    watchers: [...x.watchers, { userId: p.id, access: 'view', name: p.fullName }],
                  }));
                }}
              />
            )}
          </section>
        )}
        {(problem ?? save.error) && (
          <div className="sec">
            {problem ? (
              <p className="err" role="alert">
                {problem}
              </p>
            ) : (
              <ErrorAlert error={save.error} />
            )}
          </div>
        )}
      </div>
      <div className="drawer-f">
        {canSetup && !editId && (
          <Button
            variant="subtle"
            mr="auto"
            leftSection={<IconCopy size={16} />}
            onClick={() => {
              setTplName(d.title);
              setSaveTpl(true);
            }}
          >
            Save as template
          </Button>
        )}
        <Button variant="default" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={save.isPending} onClick={submit}>
          {editId ? 'Save changes' : 'Assign task'}
        </Button>
      </div>
      <MasterModal
        what={master}
        onClose={() => {
          setMaster(null);
        }}
        onCreated={(id) => {
          master?.apply(id);
          setMaster(null);
        }}
      />
      <Modal
        opened={saveTpl}
        onClose={() => {
          setSaveTpl(false);
        }}
        title="Save as template"
        centered
      >
        <Stack>
          <p className="small muted">
            People and fixed dates aren’t saved; you pick them each time.
          </p>
          <TextInput
            label="Template name"
            value={tplName}
            onChange={(e) => {
              setTplName(e.currentTarget.value);
            }}
            data-autofocus
          />
          <ErrorAlert error={saveTemplate.error} />
          <Group justify="flex-end">
            <Button
              loading={saveTemplate.isPending}
              disabled={!tplName.trim()}
              onClick={() => {
                saveTemplate.mutate();
              }}
            >
              Save template
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

function Subtasks({
  d,
  setD,
  withPeople,
}: {
  d: Draft;
  setD: (f: (x: Draft) => Draft) => void;
  withPeople: boolean;
}) {
  const [input, setInput] = useState('');
  const add = () => {
    const title = input.trim();
    if (!title) return;
    setD((x) => ({ ...x, subtasks: [...x.subtasks, { title, assigneeUserId: null }] }));
    setInput('');
  };
  const people = useQuery({
    queryKey: ['tasks', 'assignable', ''],
    queryFn: () => api('/tasks/assignable-people?limit=100', peoplePage),
    enabled: withPeople,
  });
  return (
    <>
      {d.subtasks.map((s, i) => (
        <div className="check" key={s.id ?? `new-${String(i)}`}>
          <IconSubtask size={16} aria-hidden="true" className="muted" />
          <span className="grow">{s.title}</span>
          {withPeople && (
            <Select
              aria-label={`Who does “${s.title}”`}
              placeholder="Same person"
              clearable
              size="xs"
              w={160}
              data={(people.data?.items ?? []).map((p) => ({ value: p.id, label: p.fullName }))}
              value={s.assigneeUserId}
              onChange={(v) => {
                setD((x) => ({
                  ...x,
                  subtasks: x.subtasks.map((y, j) => (j === i ? { ...y, assigneeUserId: v } : y)),
                }));
              }}
            />
          )}
          <button
            type="button"
            className="iconbtn"
            aria-label="Remove sub-task"
            onClick={() => {
              setD((x) => ({ ...x, subtasks: x.subtasks.filter((_, j) => j !== i) }));
            }}
          >
            <IconX size={14} />
          </button>
        </div>
      ))}
      <Group gap="xs" mt="xs" wrap="nowrap">
        <TextInput
          className="grow"
          aria-label="Add a sub-task"
          placeholder="Add a sub-task"
          value={input}
          onChange={(e) => {
            setInput(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="default" onClick={add}>
          Add
        </Button>
      </Group>
    </>
  );
}

/** "All [role] at [school]" quick-add plus a searchable list of people (brief 9.3). */
function AssignPicker({
  d,
  setD,
  options,
}: {
  d: Draft;
  setD: (f: (x: Draft) => Draft) => void;
  options: {
    canAssign: boolean;
    roles: { id: string; name: string }[];
    schools: { id: string; name: string }[];
  } | null;
}) {
  const [role, setRole] = useState<string | null>(null);
  const [school, setSchool] = useState<string | null>('all');
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search, 250);
  const people = useQuery({
    queryKey: ['tasks', 'assignable', q],
    queryFn: () =>
      api(`/tasks/assignable-people?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`, peoplePage),
  });
  const hasGroup = d.roleIds.length + d.schoolIds.length > 0;
  const target = { userIds: d.people.map((p) => p.id), roleIds: d.roleIds, schoolIds: d.schoolIds };
  const preview = useQuery({
    queryKey: ['tasks', 'preview', JSON.stringify(target)],
    queryFn: () =>
      api('/tasks/target-preview', previewSchema, { method: 'POST', body: { target } }),
    enabled: target.userIds.length + target.roleIds.length + target.schoolIds.length > 0,
  });
  const roleName = (id: string) => options?.roles.find((r) => r.id === id)?.name ?? 'Role';
  const schoolName = (id: string) => options?.schools.find((s) => s.id === id)?.name ?? 'School';
  const toggle = (p: {
    id: string;
    fullName: string;
    jobTitle: string | null;
    schoolName: string | null;
  }) => {
    setD((x) =>
      x.people.some((y) => y.id === p.id)
        ? { ...x, people: x.people.filter((y) => y.id !== p.id) }
        : {
            ...x,
            people: [
              ...x.people,
              {
                id: p.id,
                fullName: p.fullName,
                sub: [p.jobTitle, p.schoolName].filter(Boolean).join(', '),
              },
            ],
          },
    );
  };
  return (
    <>
      {options?.canAssign && (
        <Group gap="xs" mb="sm" wrap="wrap" align="flex-end">
          <Select
            aria-label="Role"
            placeholder="Pick a role"
            data={options.roles.map((r) => ({
              value: r.id,
              label: `All ${r.name.toLowerCase()}s`,
            }))}
            value={role}
            onChange={setRole}
          />
          <span className="small muted">at</span>
          <Select
            aria-label="School"
            allowDeselect={false}
            data={[
              { value: 'all', label: 'all my schools' },
              ...options.schools.map((s) => ({ value: s.id, label: s.name })),
            ]}
            value={school}
            onChange={setSchool}
          />
          <Button
            variant="default"
            leftSection={<IconPlus size={16} />}
            disabled={!role}
            onClick={() => {
              if (!role) return;
              setD((x) => ({
                ...x,
                roleIds: x.roleIds.includes(role) ? x.roleIds : [...x.roleIds, role],
                schoolIds:
                  school && school !== 'all' && !x.schoolIds.includes(school)
                    ? [...x.schoolIds, school]
                    : x.schoolIds,
              }));
              setRole(null);
            }}
          >
            Add
          </Button>
        </Group>
      )}
      {(hasGroup || d.people.length > 0) && (
        <div className="pills" aria-label="Chosen">
          {hasGroup && (
            <span className="pill group">
              All {d.roleIds.map(roleName).join(', ') || 'people'}
              {d.schoolIds.length > 0
                ? ` at ${d.schoolIds.map(schoolName).join(', ')}`
                : ' · all my schools'}
              <button
                type="button"
                aria-label="Remove group"
                onClick={() => {
                  setD((x) => ({ ...x, roleIds: [], schoolIds: [] }));
                }}
              >
                <IconX size={12} />
              </button>
            </span>
          )}
          {d.people.map((p) => (
            <span className="pill" key={p.id}>
              {p.fullName}
              <button
                type="button"
                aria-label={`Remove ${p.fullName}`}
                onClick={() => {
                  setD((x) => ({ ...x, people: x.people.filter((y) => y.id !== p.id) }));
                }}
              >
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <TextInput
        mt="sm"
        placeholder="Search people"
        aria-label="Search people"
        value={search}
        onChange={(e) => {
          setSearch(e.currentTarget.value);
        }}
      />
      <div className="picker">
        {(people.data?.items ?? []).map((p) => (
          <label className="check" key={p.id}>
            <Checkbox
              checked={d.people.some((y) => y.id === p.id)}
              onChange={() => {
                toggle(p);
              }}
              aria-label={p.fullName}
            />
            <PersonCell person={p} sub={[p.roleName, p.schoolName ?? 'Head office'].join(', ')} />
          </label>
        ))}
        {people.data?.items.length === 0 && <p className="empty">No one matches.</p>}
      </div>
      <p className="small muted" role="status">
        {preview.data
          ? `${String(preview.data.count)} ${preview.data.count === 1 ? 'person' : 'people'}. Each person gets their own copy to complete.`
          : 'Choose people or a group. Each person gets their own copy.'}
        {preview.data &&
          preview.data.count > preview.data.limit &&
          ` One task can go to at most ${String(preview.data.limit)}.`}
      </p>
      {preview.error && <p className="err small">{errorMessage(preview.error)}</p>}
    </>
  );
}

function PeopleSearch({
  label,
  path,
  exclude,
  onPick,
  placeholder,
}: {
  label: string;
  path: string;
  exclude: string[];
  onPick: (p: { id: string; fullName: string }) => void;
  placeholder?: string;
}) {
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search, 250);
  const people = useQuery({
    queryKey: ['tasks', 'people', path, q],
    queryFn: () => api(`${path}?limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`, peoplePage),
  });
  const items = (people.data?.items ?? []).filter((p) => !exclude.includes(p.id));
  return (
    <Select
      label={label}
      placeholder={placeholder ?? 'Search by name'}
      searchable
      searchValue={search}
      onSearchChange={setSearch}
      data={items.map((p) => ({
        value: p.id,
        label: [p.fullName, p.jobTitle].filter(Boolean).join(', '),
      }))}
      value={null}
      filter={({ options: o }) => o}
      nothingFoundMessage={people.isFetching ? 'Searching…' : 'No one found'}
      onChange={(id) => {
        const p = items.find((x) => x.id === id);
        if (p) onPick(p);
        setSearch('');
      }}
    />
  );
}
