import { Button, Group, Select, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { isFinished, isOpen, listFieldKey, REPEAT_LABEL } from '@kidzonia/shared';
import type { CopyRow, TaskRow } from '@kidzonia/shared';
import {
  IconCamera,
  IconClock,
  IconLock,
  IconPlus,
  IconRepeat,
  IconSearch,
  IconSubtask,
  IconUsers,
} from '@tabler/icons-react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { useMeData } from '../shell/AppLayout';
import { ErrorAlert, errorMessage } from '../ui/errors';
import { notify } from '../ui/notify';
import { copyDetailSchema, copyPage, taskKeys, taskPage, useTaskSetup } from './api';
import {
  CategoryTag,
  copyDue,
  LockChip,
  PersonCell,
  ProgressBar,
  StatusChip,
  StatusRing,
  taskDue,
  todayIn,
} from './bits';
import { NewTaskDrawer } from './NewTaskDrawer';
import { TaskDrawer } from './TaskDrawer';

type View = 'my' | 'byme' | 'team' | 'watching' | 'approvals';

const VIEWS: Record<string, { view: View; title: string }> = {
  '/tasks': { view: 'my', title: 'My tasks' },
  '/tasks/assigned': { view: 'byme', title: 'Assigned by me' },
  '/tasks/team': { view: 'team', title: 'My team' },
  '/tasks/watching': { view: 'watching', title: 'Watching' },
  '/tasks/approvals': { view: 'approvals', title: 'Approvals' },
};

/** Opening and closing the drawers through the address, so links and Back work. */
export function useTaskParams() {
  const [params, setParams] = useSearchParams();
  const set = (next: Record<string, string | null>) => {
    setParams(
      (p) => {
        const out = new URLSearchParams(p);
        for (const k of ['task', 'copy', 'new', 'edit', 'template']) out.delete(k);
        for (const [k, v] of Object.entries(next)) if (v) out.set(k, v);
        return out;
      },
      { replace: false },
    );
  };
  return {
    task: params.get('task'),
    copy: params.get('copy'),
    creating: params.get('new') === '1',
    editing: params.get('edit'),
    template: params.get('template'),
    open: (task: string, copy: string | null = null) => {
      set({ task, copy });
    },
    create: (template: string | null = null) => {
      set({ new: '1', template });
    },
    edit: (task: string) => {
      set({ edit: task });
    },
    close: () => {
      set({});
    },
  };
}

export function TasksPage() {
  const { pathname } = useLocation();
  const { access } = useMeData();
  const nav = useTaskParams();
  const page = VIEWS[pathname.replace(/\/+$/, '')] ?? { view: 'my' as const, title: 'My tasks' };
  const canCreate = access.can('tasks', 'create') && !access.readOnly;

  return (
    <>
      <div className="pagehead">
        <h1>{page.title}</h1>
        {canCreate && (
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              nav.create();
            }}
          >
            New task
          </Button>
        )}
      </div>
      {page.view === 'my' && <MyTasks />}
      {page.view === 'approvals' && <Approvals />}
      {(page.view === 'byme' || page.view === 'team' || page.view === 'watching') && (
        <TaskList key={page.view} view={page.view} />
      )}
      <TaskDrawers />
    </>
  );
}

/** The drawers every Tasks page (and Task setup) can open. */
export function TaskDrawers() {
  const nav = useTaskParams();
  return (
    <>
      {nav.task && (
        <TaskDrawer
          key={`${nav.task}-${nav.copy ?? ''}`}
          taskId={nav.task}
          copyId={nav.copy}
          onClose={nav.close}
          onEdit={() => {
            nav.edit(nav.task ?? '');
          }}
        />
      )}
      {(nav.creating || nav.editing) && (
        <NewTaskDrawer
          key={nav.editing ?? `new-${nav.template ?? ''}`}
          editId={nav.editing}
          templateId={nav.template}
          onClose={nav.close}
          onSaved={(id) => {
            nav.open(id);
          }}
        />
      )}
    </>
  );
}

function useCopies(tab: 'my' | 'approvals') {
  return useInfiniteQuery({
    queryKey: [...taskKeys.copies, tab],
    queryFn: ({ pageParam }) =>
      api(`/assignments?tab=${tab}&limit=100${pageParam ? `&cursor=${pageParam}` : ''}`, copyPage),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

function Meta({ children }: { children: ReactNode }) {
  return <span className="meta">{children}</span>;
}

function CopyRowButton({ c, tz }: { c: CopyRow; tz: string }) {
  const nav = useTaskParams();
  const due = copyDue(c, tz);
  return (
    <button
      type="button"
      className="trow"
      onClick={() => {
        nav.open(c.taskId, c.id);
      }}
    >
      <StatusRing status={c.status} />
      <span className="tr-body">
        <span className="title">{c.title ?? 'Task'}</span>
        <Meta>
          {due && (
            <span>
              <IconClock size={14} aria-hidden="true" />
              {due}
            </span>
          )}
          {c.repeat !== 'none' && (
            <span>
              <IconRepeat size={14} aria-hidden="true" />
              {REPEAT_LABEL[c.repeat]}
            </span>
          )}
          {c.category !== undefined && <CategoryTag category={c.category} />}
          {c.subtaskCount > 0 && (
            <span>
              <IconSubtask size={14} aria-hidden="true" />
              {c.subtasksDone} of {c.subtaskCount} sub-tasks
            </span>
          )}
        </Meta>
      </span>
      <span className="end">
        {c.blocksLogout && isOpen(c.status) && <LockChip short />}
        <StatusChip status={c.status} />
      </span>
    </button>
  );
}

function MyTasks() {
  const { me } = useMeData();
  const tz = me.organisation.timezone;
  const list = useCopies('my');
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const today = todayIn(tz);
  const done = rows.filter(
    (c) => isFinished(c.status) || c.status === 'cancelled' || c.status === 'expired',
  );
  const live = rows.filter((c) => !done.includes(c));
  const todays = live.filter((c) => c.serviceDate <= today);
  // Coming up shows each repeating task once, at its next copy (not a week of them).
  const later = live
    .filter((c) => c.serviceDate > today)
    .filter((c, i, all) => all.findIndex((x) => x.taskId === c.taskId) === i);
  const blocking = todays.filter((c) => c.blocksLogout && isOpen(c.status)).length;

  const group = (label: string, items: CopyRow[]) =>
    items.length > 0 && (
      <>
        <h2 className="group-h">{label}</h2>
        <div className="tlist">
          {items.map((c) => (
            <CopyRowButton key={c.id} c={c} tz={tz} />
          ))}
        </div>
      </>
    );

  return (
    <>
      {blocking > 0 && (
        <div className="banner" role="status">
          <IconLock size={20} aria-hidden="true" />
          <b>
            {blocking} {blocking === 1 ? 'task' : 'tasks'} must be submitted before you log out.
          </b>
        </div>
      )}
      <ErrorAlert error={list.error} />
      <section className="panel">
        {group('Today', todays)}
        {group('Coming up', later)}
        {group('Done', done)}
        {rows.length === 0 && !list.isLoading && <p className="empty">No tasks here yet.</p>}
        {list.hasNextPage && (
          <Group justify="center" p="md">
            <Button variant="default" onClick={() => void list.fetchNextPage()}>
              Show more
            </Button>
          </Group>
        )}
      </section>
    </>
  );
}

function Approvals() {
  const nav = useTaskParams();
  const qc = useQueryClient();
  const list = useCopies('approvals');
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const approve = useMutation({
    mutationFn: (id: string) =>
      api(`/assignments/${id}/approve`, copyDetailSchema, {
        method: 'POST',
        body: { remarks: null },
      }),
    onSuccess: (c) => {
      notify(`Approved ${c.person.fullName}’s work.`);
      void qc.invalidateQueries({ queryKey: taskKeys.all });
    },
    onError: (err) => {
      notify(errorMessage(err));
    },
  });
  return (
    <>
      <ErrorAlert error={list.error} />
      <section className="panel">
        {rows.length === 0 && !list.isLoading ? (
          <p className="empty">Nothing is waiting for your approval.</p>
        ) : (
          <div className="tlist">
            {rows.map((c) => (
              <div key={c.id} className="trow static">
                <PersonCell person={c.person} sub={c.title ?? 'Task'} />
                <span className="tr-body">
                  <Meta>
                    {c.person.schoolName && <span>{c.person.schoolName}</span>}
                    {(c.attachmentCount ?? 0) > 0 && (
                      <span>
                        <IconCamera size={14} aria-hidden="true" />
                        {c.attachmentCount} {c.attachmentCount === 1 ? 'file' : 'files'}
                      </span>
                    )}
                  </Meta>
                </span>
                <span className="end">
                  <Button
                    size="xs"
                    variant="default"
                    onClick={() => {
                      nav.open(c.taskId, c.id);
                    }}
                  >
                    Review
                  </Button>
                  <Button
                    size="xs"
                    loading={approve.isPending && approve.variables === c.id}
                    onClick={() => {
                      approve.mutate(c.id);
                    }}
                  >
                    Approve
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function TaskList({ view }: { view: 'byme' | 'team' | 'watching' }) {
  const { access, me } = useMeData();
  const nav = useTaskParams();
  const setup = useTaskSetup();
  const tz = me.organisation.timezone;
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search, 300);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [priorityId, setPriorityId] = useState<string | null>(null);
  const [listValue, setListValue] = useState<string | null>(null);
  // Filters follow field permissions; the server refuses hidden ones too.
  const show = (f: string) => access.fieldAccess('tasks', f) !== 'hidden';

  const params = new URLSearchParams({ view, limit: '50' });
  if (q) params.set('q', q);
  if (categoryId) params.set('categoryId', categoryId);
  if (priorityId) params.set('priorityId', priorityId);
  if (listValue) params.set('listValue', listValue);

  const list = useInfiniteQuery({
    queryKey: [...taskKeys.lists, params.toString()],
    queryFn: ({ pageParam }) =>
      api(`/tasks?${params.toString()}${pageParam ? `&cursor=${pageParam}` : ''}`, taskPage),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const lists = (setup.data?.lists ?? []).filter((l) => show(listFieldKey(l.id)));

  return (
    <>
      <Group mb="md" gap="sm" wrap="wrap">
        <TextInput
          placeholder="Search tasks"
          aria-label="Search tasks"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
          }}
          className="grow"
        />
        {show('category') && (
          <Select
            aria-label="Category"
            placeholder="All categories"
            clearable
            data={(setup.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
            value={categoryId}
            onChange={setCategoryId}
          />
        )}
        {show('priority') && (
          <Select
            aria-label="Priority"
            placeholder="Any priority"
            clearable
            data={(setup.data?.priorities ?? []).map((p) => ({ value: p.id, label: p.name }))}
            value={priorityId}
            onChange={setPriorityId}
          />
        )}
        {lists.map((l) => (
          <Select
            key={l.id}
            aria-label={l.name}
            placeholder={`Any ${l.name.toLowerCase()}`}
            clearable
            data={l.values.map((v) => ({ value: `${l.id}:${v.id}`, label: v.value }))}
            value={listValue?.startsWith(l.id) ? listValue : null}
            onChange={setListValue}
          />
        ))}
      </Group>
      <ErrorAlert error={list.error} />
      <section className="panel">
        {rows.length === 0 && !list.isLoading ? (
          <p className="empty">
            {view === 'watching'
              ? 'When someone adds you as a watcher, the task shows up here.'
              : 'No tasks here yet.'}
          </p>
        ) : (
          <div className="tlist">
            {rows.map((t) => (
              <TaskRowButton
                key={t.id}
                t={t}
                tz={tz}
                onOpen={() => {
                  nav.open(t.id);
                }}
              />
            ))}
          </div>
        )}
        {list.hasNextPage && (
          <Group justify="center" p="md">
            <Button variant="default" onClick={() => void list.fetchNextPage()}>
              Show more
            </Button>
          </Group>
        )}
      </section>
    </>
  );
}

function TaskRowButton({ t, tz, onOpen }: { t: TaskRow; tz: string; onOpen: () => void }) {
  const due = taskDue(t, tz);
  return (
    <button type="button" className="trow" onClick={onOpen}>
      <span className="ring" aria-hidden="true">
        <IconUsers size={12} />
      </span>
      <span className="tr-body">
        <span className="title">{t.title ?? 'Task'}</span>
        <Meta>
          {due && (
            <span>
              <IconClock size={14} aria-hidden="true" />
              {due}
            </span>
          )}
          {t.repeat !== 'none' && (
            <span>
              <IconRepeat size={14} aria-hidden="true" />
              {REPEAT_LABEL[t.repeat]}
            </span>
          )}
          {t.category !== undefined && <CategoryTag category={t.category} />}
          <span>By {t.creator.fullName.split(' ')[0]}</span>
        </Meta>
      </span>
      <span className="end">
        {t.cancelledAt ? (
          <span className="chip st-cancelled">Cancelled</span>
        ) : (
          <>
            {t.blocksLogout && <LockChip short />}
            <ProgressBar progress={t.progress} />
          </>
        )}
      </span>
    </button>
  );
}
