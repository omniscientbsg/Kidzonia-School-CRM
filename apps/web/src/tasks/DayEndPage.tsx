import {
  ActionIcon,
  Button,
  Group,
  Modal,
  MultiSelect,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  TextInput,
} from '@mantine/core';
import {
  blockingSchema,
  completionOf,
  dayEndFormListSchema,
  dayEndFormSchema,
  dayEndTodaySchema,
  QUESTION_TYPE_LABEL,
  QUESTION_TYPES,
} from '@kidzonia/shared';
import type { DayEndForm, Question } from '@kidzonia/shared';
import { IconLock, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { api } from '../api/client';
import { useMeData } from '../shell/AppLayout';
import { NarrowedChip } from '../shell/SchoolSwitcher';
import { ErrorAlert } from '../ui/errors';
import { notify } from '../ui/notify';
import { dayLabel, PersonCell, ProgressBar, StatusChip, clockTime, todayIn } from './bits';
import { TaskDrawers, useTaskParams } from './TasksPage';

const dayEndKeys = {
  today: ['tasks', 'day-end', 'today'] as const,
  forms: ['tasks', 'day-end', 'forms'] as const,
};

/** Day-end reports (brief 9.11): Today (who has submitted, release) and Forms. */
export function DayEndPage() {
  const { access } = useMeData();
  const canBuild = access.can('dayend', 'create') || access.can('dayend', 'edit');
  return (
    <>
      <NarrowedChip />
      <div className="pagehead">
        <h1>Day-end reports</h1>
      </div>
      <Tabs defaultValue="today" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="today">Today</Tabs.Tab>
          <Tabs.Tab value="forms">Forms</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="today">
          <Today />
        </Tabs.Panel>
        <Tabs.Panel value="forms">
          <Forms canBuild={canBuild && !access.readOnly} />
        </Tabs.Panel>
      </Tabs>
      <TaskDrawers />
    </>
  );
}

function Today() {
  const { me } = useMeData();
  const nav = useTaskParams();
  const tz = me.organisation.timezone;
  const today = useQuery({
    queryKey: dayEndKeys.today,
    queryFn: () => api('/day-end/today', dayEndTodaySchema),
  });
  const [releasing, setReleasing] = useState<{ id: string; name: string } | null>(null);
  const rows = today.data?.rows ?? [];
  const progress = completionOf(rows);
  return (
    <>
      <ErrorAlert error={today.error} />
      {rows.length > 0 && (
        <Group mb="md" gap="sm">
          <ProgressBar progress={progress} width={160} />
          <span className="small muted">
            submitted {dayLabel(today.data?.date ?? '', todayIn(tz), tz).toLowerCase()}
          </span>
        </Group>
      )}
      <section className="panel">
        <Table.ScrollContainer minWidth={560}>
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Person</Table.Th>
                <Table.Th>Report</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>
                  <span className="visually-hidden">Actions</span>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.copyId}>
                  <Table.Td>
                    <PersonCell person={r.person} />
                  </Table.Td>
                  <Table.Td>
                    <button
                      type="button"
                      className="lnk"
                      onClick={() => {
                        nav.open(r.taskId, r.copyId);
                      }}
                    >
                      {r.formName}
                    </button>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6}>
                      <StatusChip status={r.status} />
                      {r.submittedAt && (
                        <span className="small muted">{clockTime(r.submittedAt, tz)}</span>
                      )}
                      {r.blocking && (
                        <span className="chip lock">
                          <IconLock size={12} aria-hidden="true" />
                          Blocking logout
                        </span>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {r.canRelease && r.blocking && (
                      <Button
                        size="compact-sm"
                        variant="default"
                        onClick={() => {
                          setReleasing({ id: r.person.id, name: r.person.fullName });
                        }}
                      >
                        Release for today
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {rows.length === 0 && !today.isLoading && (
          <p className="empty">No day-end reports today.</p>
        )}
      </section>
      {releasing && (
        <ReleaseModal
          person={releasing}
          onClose={() => {
            setReleasing(null);
          }}
        />
      )}
    </>
  );
}

/**
 * The release screen (answer 3): every date the person still has blocking
 * work open, each released on its own, or all at once. Each date gets its
 * own release and audit entry on the server.
 */
export function ReleaseModal({
  person,
  onClose,
}: {
  person: { id: string; name: string };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { me } = useMeData();
  const tz = me.organisation.timezone;
  const blocking = useQuery({
    queryKey: ['tasks', 'blocking', person.id],
    queryFn: () => api(`/users/${person.id}/blocking`, blockingSchema),
  });
  const release = useMutation({
    mutationFn: (dates: string[]) =>
      api(`/users/${person.id}/release`, blockingSchema, { method: 'POST', body: { dates } }),
    onSuccess: (left) => {
      qc.setQueryData(['tasks', 'blocking', person.id], left);
      void qc.invalidateQueries({ queryKey: dayEndKeys.today });
      if (left.dates.length === 0) {
        notify(`${person.name} can log out now.`);
        onClose();
      }
    },
  });
  const dates = blocking.data?.dates ?? [];
  return (
    <Modal opened onClose={onClose} title={`Release ${person.name}`} centered>
      <Stack>
        <ErrorAlert error={blocking.error ?? release.error} />
        {dates.map((d) => (
          <div className="check wrap" key={d.date}>
            <span className="grow">
              <b>{dayLabel(d.date, todayIn(tz), tz)}</b>
              <span className="small muted"> · {d.tasks.map((x) => x.title).join(', ')}</span>
            </span>
            <Button
              size="compact-sm"
              variant="default"
              onClick={() => {
                release.mutate([d.date]);
              }}
            >
              Release
            </Button>
          </div>
        ))}
        {dates.length === 0 && !blocking.isLoading && (
          <p className="empty">Nothing is blocking {person.name}.</p>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Close
          </Button>
          {dates.length > 1 && (
            <Button
              loading={release.isPending}
              onClick={() => {
                release.mutate(dates.map((d) => d.date));
              }}
            >
              Release all
            </Button>
          )}
          {dates.length === 1 && (
            <Button
              loading={release.isPending}
              onClick={() => {
                release.mutate(dates.map((d) => d.date));
              }}
            >
              Release for today
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}

function Forms({ canBuild }: { canBuild: boolean }) {
  const { access } = useMeData();
  const qc = useQueryClient();
  const forms = useQuery({
    queryKey: dayEndKeys.forms,
    queryFn: () => api('/day-end-forms', dayEndFormListSchema),
  });
  const [editing, setEditing] = useState<DayEndForm | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/day-end-forms/${id}`, z.undefined(), { method: 'DELETE' }),
    onSuccess: () => {
      notify('Form removed. Reports already filed are kept.');
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
  const roleName = (id: string) => forms.data?.roles.find((r) => r.id === id)?.name ?? 'Role';
  return (
    <>
      <ErrorAlert error={forms.error ?? remove.error} />
      {canBuild && access.can('dayend', 'create') && (
        <Group mb="md">
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              setEditing('new');
            }}
          >
            New form
          </Button>
        </Group>
      )}
      <section className="panel">
        {(forms.data?.items ?? []).map((f) => (
          <div className="role-row" key={f.id}>
            <div className="t">
              <b>{f.name}</b>
              <span>
                For {f.roleIds.map(roleName).join(', ')} · {f.questions.length} questions · version{' '}
                {f.version}
                {f.blocksLogout ? ' · must be submitted before logging out' : ''}
              </span>
            </div>
            {canBuild && access.can('dayend', 'edit') && (
              <Button
                size="xs"
                variant="default"
                onClick={() => {
                  setEditing(f);
                }}
              >
                Edit
              </Button>
            )}
            {canBuild && access.can('dayend', 'delete') && (
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={`Remove ${f.name}`}
                onClick={() => {
                  remove.mutate(f.id);
                }}
              >
                <IconTrash size={16} />
              </ActionIcon>
            )}
          </div>
        ))}
        {forms.data?.items.length === 0 && <p className="empty">No day-end forms yet.</p>}
      </section>
      {editing && (
        <FormBuilder
          key={editing === 'new' ? 'new' : editing.id}
          form={editing === 'new' ? null : editing}
          roles={forms.data?.roles ?? []}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

const newQuestion = (n: number): Question => ({
  id: `q${String(Date.now()).slice(-6)}${String(n)}`,
  text: '',
  type: 'yes_no',
  required: true,
  options: [],
});

/** The form builder: questions of five types, each optionally required (brief 9.11). */
function FormBuilder({
  form,
  roles,
  onClose,
}: {
  form: DayEndForm | null;
  roles: { id: string; name: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(form?.name ?? '');
  const [roleIds, setRoleIds] = useState<string[]>(form?.roleIds ?? []);
  const [blocks, setBlocks] = useState(form?.blocksLogout ?? true);
  const [questions, setQuestions] = useState<Question[]>(form?.questions ?? [newQuestion(0)]);
  const patch = (i: number, p: Partial<Question>) => {
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...p } : q)));
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { name, roleIds, blocksLogout: blocks, questions };
      return form
        ? api(`/day-end-forms/${form.id}`, dayEndFormSchema, { method: 'PUT', body })
        : api('/day-end-forms', dayEndFormSchema, { method: 'POST', body });
    },
    onSuccess: () => {
      notify(
        form
          ? 'Saved. New reports use the new questions; filed ones keep theirs.'
          : 'Form created.',
      );
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
  });
  return (
    <Modal opened onClose={onClose} title={form ? 'Edit form' : 'New day-end form'} size="lg">
      <Stack>
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value);
          }}
          required
        />
        <MultiSelect
          label="Who fills it in"
          placeholder="Choose roles"
          data={roles.map((r) => ({ value: r.id, label: r.name }))}
          value={roleIds}
          onChange={setRoleIds}
        />
        <Switch
          label="Must be submitted before logging out"
          checked={blocks}
          onChange={(e) => {
            setBlocks(e.currentTarget.checked);
          }}
        />
        <h3 className="sec-h">Questions</h3>
        {questions.map((q, i) => (
          <div className="panel pad" key={q.id}>
            <Stack gap="xs">
              <TextInput
                label={`Question ${String(i + 1)}`}
                value={q.text}
                onChange={(e) => {
                  patch(i, { text: e.currentTarget.value });
                }}
              />
              <Group gap="sm" align="flex-end" wrap="wrap">
                <Select
                  label="Answer type"
                  allowDeselect={false}
                  data={QUESTION_TYPES.map((tp) => ({ value: tp, label: QUESTION_TYPE_LABEL[tp] }))}
                  value={q.type}
                  onChange={(v) => {
                    patch(i, { type: v ?? 'yes_no' });
                  }}
                />
                <Switch
                  label="Required"
                  checked={q.required}
                  onChange={(e) => {
                    patch(i, { required: e.currentTarget.checked });
                  }}
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={`Remove question ${String(i + 1)}`}
                  onClick={() => {
                    setQuestions((qs) => qs.filter((_, j) => j !== i));
                  }}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
              {(q.type === 'pick_one' || q.type === 'checklist') && (
                <TextInput
                  label="Choices"
                  description="Separate them with commas"
                  value={q.options.join(', ')}
                  onChange={(e) => {
                    patch(i, {
                      options: e.currentTarget.value
                        .split(',')
                        .map((o) => o.trim())
                        .filter(Boolean),
                    });
                  }}
                />
              )}
            </Stack>
          </div>
        ))}
        <Group>
          <Button
            variant="default"
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              setQuestions((qs) => [...qs, newQuestion(qs.length)]);
            }}
          >
            Add question
          </Button>
        </Group>
        <ErrorAlert error={save.error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            {form ? 'Save form' : 'Create form'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
