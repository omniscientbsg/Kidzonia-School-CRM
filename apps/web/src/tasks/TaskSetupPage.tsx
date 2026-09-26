import { ActionIcon, Button, Group, Stack, Tabs, Textarea, TextInput } from '@mantine/core';
import {
  customListSchema,
  messageTemplateSchema,
  REPEAT_LABEL,
  taskSetupSchema,
} from '@kidzonia/shared';
import type { TaskTemplate } from '@kidzonia/shared';
import { IconArrowDown, IconArrowUp, IconCopy, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { api } from '../api/client';
import { useMeData } from '../shell/AppLayout';
import { ErrorAlert } from '../ui/errors';
import { notify } from '../ui/notify';
import { taskKeys, useTaskSetup, useTemplates } from './api';
import { CategoryTag } from './bits';
import { MasterForm } from './MasterForm';
import { MessagePreview } from './TaskDrawer';
import { TaskDrawers, useTaskParams } from './TasksPage';

const none = z.undefined();

function templateSummary(t: TaskTemplate): string {
  const p = t.payload;
  return [
    p.repeat === 'none' ? 'One time' : REPEAT_LABEL[p.repeat],
    p.subtasks.length ? `${String(p.subtasks.length)} sub-tasks` : '',
    p.needsApproval ? 'Needs approval' : '',
    p.blocksLogout ? 'Before logout' : '',
    p.parentMessage ? 'Messages parents' : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/** Task setup (brief 9.9): templates, categories, priorities, lists, parent messages. */
export function TaskSetupPage() {
  const { access } = useMeData();
  const setup = useTaskSetup();
  const templates = useTemplates(true);
  const nav = useTaskParams();
  const qc = useQueryClient();
  const can = (a: string) => access.can('task_setup', a) && !access.readOnly;
  const canCreateTasks = access.can('tasks', 'create') && !access.readOnly;
  const refresh = () => qc.invalidateQueries({ queryKey: taskKeys.all });

  const remove = useMutation({
    mutationFn: (path: string) => api(path, none, { method: 'DELETE' }),
    onSuccess: () => {
      notify('Removed. Tasks that use it keep showing it.');
      void refresh();
    },
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      api('/task-setup/priorities/order', taskSetupSchema, { method: 'PUT', body: { ids } }),
    onSuccess: () => void refresh(),
  });
  const priorities = setup.data?.priorities ?? [];
  const move = (i: number, by: number) => {
    const ids = priorities.map((p) => p.id);
    const [x] = ids.splice(i, 1);
    if (x) ids.splice(i + by, 0, x);
    reorder.mutate(ids);
  };

  return (
    <>
      <div className="pagehead">
        <h1>Task setup</h1>
      </div>
      <ErrorAlert error={setup.error ?? remove.error ?? reorder.error} />
      <Tabs defaultValue="templates" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="templates">Task templates</Tabs.Tab>
          <Tabs.Tab value="categories">Categories</Tabs.Tab>
          <Tabs.Tab value="priorities">Priorities</Tabs.Tab>
          <Tabs.Tab value="lists">Custom lists</Tabs.Tab>
          <Tabs.Tab value="messages">Parent messages</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="templates">
          <Group justify="space-between" mb="md" wrap="wrap">
            <p className="muted">
              A template is a ready-made task without people or dates. Using one fills in the task
              form, and you pick who and when.
            </p>
            {canCreateTasks && (
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={() => {
                  nav.create();
                }}
              >
                New task
              </Button>
            )}
          </Group>
          <section className="panel">
            {(templates.data?.items ?? []).map((t) => (
              <div className="role-row" key={t.id}>
                <span className="attn-i" aria-hidden="true">
                  <IconCopy size={16} />
                </span>
                <div className="t">
                  <b>{t.name}</b>
                  <span>
                    <CategoryTag
                      category={setup.data?.categories.find((c) => c.id === t.payload.categoryId)}
                    />{' '}
                    {templateSummary(t)}
                  </span>
                </div>
                {canCreateTasks && (
                  <Button
                    size="xs"
                    variant="default"
                    onClick={() => {
                      nav.create(t.id);
                    }}
                  >
                    Use
                  </Button>
                )}
                {can('delete') && (
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Delete template ${t.name}`}
                    onClick={() => {
                      remove.mutate(`/task-setup/templates/${t.id}`);
                    }}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                )}
              </div>
            ))}
            {templates.data?.items.length === 0 && (
              <p className="empty">
                No templates yet. Create a task and choose “Save as template”.
              </p>
            )}
          </section>
          <p className="small muted" style={{ marginTop: 10 }}>
            Changing a template never changes tasks already handed out.
          </p>
        </Tabs.Panel>

        <Tabs.Panel value="categories">
          <section className="panel">
            {(setup.data?.categories ?? []).map((c) => (
              <div className="role-row" key={c.id}>
                <i className="dot big" style={{ background: c.color }} aria-hidden="true" />
                <div className="t">
                  <b>{c.name}</b>
                </div>
                {can('delete') && (
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Remove ${c.name}`}
                    onClick={() => {
                      remove.mutate(`/task-setup/categories/${c.id}`);
                    }}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                )}
              </div>
            ))}
            {can('create') && (
              <div className="pad">
                <MasterForm
                  what={{ kind: 'category' }}
                  onDone={() => {
                    notify('Category added.');
                  }}
                />
              </div>
            )}
          </section>
        </Tabs.Panel>

        <Tabs.Panel value="priorities">
          <section className="panel">
            {priorities.map((p, i) => (
              <div className="role-row" key={p.id}>
                <i className="dot big" style={{ background: p.color }} aria-hidden="true" />
                <div className="t">
                  <b>{p.name}</b>
                  <span>
                    {i === 0 ? 'Most urgent' : i === priorities.length - 1 ? 'Least urgent' : ''}
                  </span>
                </div>
                {can('edit') && (
                  <>
                    <ActionIcon
                      variant="subtle"
                      aria-label={`Move ${p.name} up`}
                      disabled={i === 0}
                      onClick={() => {
                        move(i, -1);
                      }}
                    >
                      <IconArrowUp size={16} />
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      aria-label={`Move ${p.name} down`}
                      disabled={i === priorities.length - 1}
                      onClick={() => {
                        move(i, 1);
                      }}
                    >
                      <IconArrowDown size={16} />
                    </ActionIcon>
                  </>
                )}
                {can('delete') && (
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => {
                      remove.mutate(`/task-setup/priorities/${p.id}`);
                    }}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                )}
              </div>
            ))}
            {can('create') && (
              <div className="pad">
                <MasterForm
                  what={{ kind: 'priority' }}
                  onDone={() => {
                    notify('Priority added.');
                  }}
                />
              </div>
            )}
          </section>
        </Tabs.Panel>

        <Tabs.Panel value="lists">
          <p className="muted" style={{ marginBottom: 14 }}>
            Each list becomes a new dropdown on the task form, a new filter, and a new field in role
            permissions.
          </p>
          <Stack>
            {(setup.data?.lists ?? []).map((l) => (
              <section className="panel pad" key={l.id}>
                <Group justify="space-between">
                  <h3>{l.name}</h3>
                  {can('delete') && (
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      onClick={() => {
                        remove.mutate(`/task-setup/lists/${l.id}`);
                      }}
                    >
                      Remove list
                    </Button>
                  )}
                </Group>
                <div className="pills" style={{ marginTop: 10 }}>
                  {l.values.map((v) => (
                    <span className="pill" key={v.id}>
                      {v.value}
                      {can('delete') && (
                        <button
                          type="button"
                          aria-label={`Remove ${v.value}`}
                          onClick={() => {
                            remove.mutate(`/task-setup/lists/${l.id}/values/${v.id}`);
                          }}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                {can('create') && (
                  <div style={{ marginTop: 12 }}>
                    <MasterForm
                      what={{ kind: 'value', listId: l.id, listName: l.name }}
                      onDone={() => undefined}
                    />
                  </div>
                )}
              </section>
            ))}
            {can('create') && <NewList onDone={() => void refresh()} />}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="messages">
          <p className="muted" style={{ marginBottom: 14 }}>
            Words in curly brackets fill themselves in when the message is sent.
          </p>
          <Stack>
            {(setup.data?.messageTemplates ?? []).map((m) => (
              <section className="panel pad" key={m.id}>
                <Group justify="space-between">
                  <h3>{m.name}</h3>
                  {can('delete') && (
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={`Remove ${m.name}`}
                      onClick={() => {
                        remove.mutate(`/task-setup/message-templates/${m.id}`);
                      }}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Group>
                <div className="tpl" style={{ marginTop: 10 }}>
                  <MessagePreview body={m.body} />
                </div>
              </section>
            ))}
            {can('create') && <NewMessage onDone={() => void refresh()} />}
          </Stack>
        </Tabs.Panel>
      </Tabs>
      <TaskDrawers />
    </>
  );
}

function NewList({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api('/task-setup/lists', customListSchema, { method: 'POST', body: { name } }),
    onSuccess: () => {
      setName('');
      notify('List created. It now appears on the task form and in role permissions.');
      onDone();
    },
  });
  return (
    <section className="panel pad">
      <ErrorAlert error={save.error} />
      <Group wrap="nowrap">
        <TextInput
          className="grow"
          aria-label="New list name"
          placeholder="New list name, like Task type"
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value);
          }}
        />
        <Button
          disabled={!name.trim()}
          loading={save.isPending}
          onClick={() => {
            save.mutate();
          }}
        >
          Create list
        </Button>
      </Group>
    </section>
  );
}

function NewMessage({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api('/task-setup/message-templates', messageTemplateSchema, {
        method: 'POST',
        body: { name, body },
      }),
    onSuccess: () => {
      setName('');
      setBody('');
      notify('Message template saved.');
      onDone();
    },
  });
  return (
    <section className="panel pad">
      <h3>New template</h3>
      <ErrorAlert error={save.error} />
      <Stack gap="sm" mt="sm">
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value);
          }}
        />
        <Textarea
          label="Message"
          placeholder="Dear parent, today {class_name} ..."
          description="Available: {student_name} {class_name} {event_name} {activity} {school_name}"
          value={body}
          autosize
          minRows={2}
          onChange={(e) => {
            setBody(e.currentTarget.value);
          }}
        />
        <Group>
          <Button
            disabled={!name.trim() || !body.trim()}
            loading={save.isPending}
            onClick={() => {
              save.mutate();
            }}
          >
            Save template
          </Button>
        </Group>
      </Stack>
    </section>
  );
}
