import { Button, Drawer, Group, Modal, Select, Stack, TextInput } from '@mantine/core';
import { reportFiltersSchema, STATUS_LABEL, TASK_STATUSES } from '@kidzonia/shared';
import type { ReportFilters } from '@kidzonia/shared';
import { IconDownload, IconInfoCircle, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { downloadFile } from '../api/client';
import {
  filterQuery,
  useDeleteView,
  usePersonTasks,
  useReport,
  useSavedViews,
  useSaveView,
} from '../home/api';
import { useMeData } from '../shell/AppLayout';
import { NarrowedChip } from '../shell/SchoolSwitcher';
import { CopyRowButton, TaskDrawers } from '../tasks/TasksPage';
import { PersonCell } from '../tasks/bits';
import { ErrorAlert, errorMessage } from '../ui/errors';
import { notify } from '../ui/notify';

const FILTER_KEYS = [
  'schoolId',
  'roleId',
  'department',
  'categoryId',
  'priorityId',
  'listValue',
  'status',
  'range',
  'from',
  'to',
] as const;

const RANGE_LABEL: Record<string, string> = {
  today: 'Today',
  this_week: 'This week',
  this_month: 'This month',
  custom: 'Choose dates',
};

const DROPPED_LABEL: Record<string, string> = {
  school: 'school',
  role: 'role',
  department: 'department',
  person: 'person',
  category: 'category',
  priority: 'priority',
  list: 'list value',
};

/** Filters live in the address, so a report can be bookmarked, shared or saved. */
function useFilters() {
  const [params, setParams] = useSearchParams();
  const raw: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) raw[k] = v;
  }
  const parsed = reportFiltersSchema.safeParse(raw);
  const filters: ReportFilters = parsed.success ? parsed.data : { range: 'this_week' };
  const person = params.get('person');
  const set = (next: Partial<ReportFilters> | ReportFilters, replace = false) => {
    setParams((p) => {
      const out = new URLSearchParams(replace ? '' : p);
      if (replace) for (const k of ['task', 'copy']) out.delete(k);
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined || v === '') out.delete(k);
        else out.set(k, v);
      }
      return out;
    });
  };
  const openPerson = (id: string | null) => {
    setParams((p) => {
      const out = new URLSearchParams(p);
      if (id) out.set('person', id);
      else out.delete('person');
      return out;
    });
  };
  return { filters, set, person, openPerson };
}

/**
 * Task reports (brief 9.14): filters, a summary and a row per person, from
 * the same filter code on the server. Saved views are yours alone; a view
 * pointing at something you can no longer see opens without that filter.
 */
export function ReportsPage() {
  const { access } = useMeData();
  const { filters, set, person, openPerson } = useFilters();
  const report = useReport(filters);
  const views = useSavedViews();
  const saveView = useSaveView();
  const deleteView = useDeleteView();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [downloading, setDownloading] = useState(false);

  const first = report.data?.pages[0];
  const rows = report.data?.pages.flatMap((p) => p.rows) ?? [];
  const opts = first?.options;
  const canExport = access.can('task_reports', 'export') && !access.readOnly;
  const canSave = !access.readOnly;

  const select = (
    key: keyof ReportFilters,
    label: string,
    all: string,
    data: { value: string; label: string }[] | undefined,
  ) =>
    data && data.length > 0 ? (
      <Select
        label={label}
        data={[{ value: '', label: all }, ...data]}
        value={filters[key] ?? ''}
        onChange={(v) => {
          set({ [key]: v ?? '' });
        }}
        allowDeselect={false}
        w={170}
      />
    ) : null;

  const download = async () => {
    setDownloading(true);
    try {
      const f = first;
      await downloadFile(
        `/reports/tasks.csv?${filterQuery(filters)}`,
        `task-report-${f?.from ?? ''}-to-${f?.to ?? ''}.csv`,
      );
    } catch (err) {
      notify(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  const personRow = rows.find((r) => r.person.id === person);

  return (
    <>
      <NarrowedChip />
      <div className="pagehead">
        <h1>Task reports</h1>
      </div>

      <section className="panel filters">
        <Group align="flex-end" gap="sm" wrap="wrap">
          {select('schoolId', 'School', 'All schools', opts?.schools)}
          {select('roleId', 'Role', 'All roles', opts?.roles)}
          {select('department', 'Department', 'All departments', opts?.departments)}
          {select('categoryId', 'Category', 'All categories', opts?.categories)}
          {select('priorityId', 'Priority', 'All priorities', opts?.priorities)}
          <Select
            label="Status"
            data={[
              { value: '', label: 'Any status' },
              { value: 'open', label: 'Still open' },
              ...TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
            ]}
            value={filters.status ?? ''}
            onChange={(v) => {
              set({ status: (v ?? '') as ReportFilters['status'] });
            }}
            allowDeselect={false}
            w={170}
          />
          <Select
            label="Dates"
            data={Object.entries(RANGE_LABEL).map(([value, label]) => ({ value, label }))}
            value={filters.range}
            onChange={(v) => {
              set({ range: (v ?? 'this_week') as ReportFilters['range'] });
            }}
            allowDeselect={false}
            w={160}
          />
          {filters.range === 'custom' && (
            <>
              <TextInput
                type="date"
                label="From"
                value={filters.from ?? ''}
                onChange={(e) => {
                  set({ from: e.currentTarget.value });
                }}
              />
              <TextInput
                type="date"
                label="To"
                value={filters.to ?? ''}
                onChange={(e) => {
                  set({ to: e.currentTarget.value });
                }}
              />
            </>
          )}
          <span className="grow" />
          {canSave && (
            <Button
              variant="default"
              onClick={() => {
                setName('');
                setNaming(true);
              }}
            >
              Save this view
            </Button>
          )}
          {canExport && (
            <Button
              variant="default"
              leftSection={<IconDownload size={16} />}
              loading={downloading}
              onClick={() => void download()}
            >
              Download
            </Button>
          )}
        </Group>
        {(views.data?.items.length ?? 0) > 0 && (
          <div className="views">
            <span className="small muted">Saved views</span>
            {views.data?.items.map((v) => (
              <span key={v.id} className="pill">
                <button
                  type="button"
                  className="pill-b"
                  onClick={() => {
                    set(v.filters, true);
                  }}
                >
                  {v.name}
                </button>
                <button
                  type="button"
                  aria-label={`Delete saved view ${v.name}`}
                  onClick={() => {
                    deleteView.mutate(v.id);
                  }}
                >
                  <IconX size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {first && first.dropped.length > 0 && (
        <div className="banner info" role="status">
          <IconInfoCircle size={20} aria-hidden="true" />
          <span>
            We left out the {first.dropped.map((d) => DROPPED_LABEL[d] ?? d).join(' and ')} filter
            because you can no longer see what it pointed to.
          </span>
        </div>
      )}
      <ErrorAlert error={report.error} />

      {first && (
        <div className="figs">
          <div className="fig">
            <b>{first.summary.people}</b>
            <span>People</span>
          </div>
          <div className="fig">
            <b>{first.summary.tasks}</b>
            <span>Tasks</span>
          </div>
          <div className="fig">
            <b>{first.summary.percent}%</b>
            <span>Done or submitted</span>
          </div>
          <div className={first.summary.overdue ? 'fig alert' : 'fig'}>
            <b>{first.summary.overdue}</b>
            <span>Overdue</span>
          </div>
        </div>
      )}

      <section className="panel">
        <div className="tbl-wrap">
          <table className="plain">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                <th scope="col">Progress</th>
                <th scope="col">Done</th>
                <th scope="col">Waiting approval</th>
                <th scope="col">Overdue</th>
                <th scope="col">Day-end today</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.person.id}
                  className="click"
                  onClick={() => {
                    openPerson(r.person.id);
                  }}
                >
                  <td>
                    <button
                      type="button"
                      className="rowlink"
                      onClick={(e) => {
                        e.stopPropagation();
                        openPerson(r.person.id);
                      }}
                    >
                      <PersonCell person={r.person} sub={r.person.schoolName ?? 'Head office'} />
                    </button>
                  </td>
                  <td>{r.roleName ?? <span className="muted">No role</span>}</td>
                  <td>
                    <span className="row">
                      <span
                        className={`bar ${r.percent >= 75 ? '' : r.percent >= 50 ? 'warn' : 'bad'}`}
                        style={{ width: 90 }}
                        aria-hidden="true"
                      >
                        <i style={{ width: `${String(r.percent)}%` }} />
                      </span>
                      <span className="small muted">{r.percent}%</span>
                    </span>
                  </td>
                  <td>
                    {r.done}/{r.total}
                  </td>
                  <td>{r.submitted || <span className="muted">0</span>}</td>
                  <td>
                    {r.overdue ? (
                      <span className="chip st-overdue">{r.overdue}</span>
                    ) : (
                      <span className="muted">0</span>
                    )}
                  </td>
                  <td>
                    {r.dayEnd === 'in' && <span className="chip st-done">In</span>}
                    {r.dayEnd === 'due' && <span className="chip">Due</span>}
                    {r.dayEnd === null && <span className="muted">None</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !report.isLoading && (
                <tr>
                  <td colSpan={7} className="empty">
                    No one matches these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {report.hasNextPage && (
          <Group justify="center" p="md">
            <Button
              variant="default"
              loading={report.isFetchingNextPage}
              onClick={() => void report.fetchNextPage()}
            >
              Show more people
            </Button>
          </Group>
        )}
      </section>

      <PersonDrawer
        id={person}
        name={personRow?.person.fullName}
        filters={filters}
        onClose={() => {
          openPerson(null);
        }}
      />
      <TaskDrawers />

      <Modal
        opened={naming}
        onClose={() => {
          setNaming(false);
        }}
        title="Save this view"
        centered
        radius="lg"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveView.mutate(
              { name, filters },
              {
                onSuccess: () => {
                  setNaming(false);
                  notify('View saved');
                },
              },
            );
          }}
        >
          <Stack>
            <TextInput
              label="Name"
              value={name}
              onChange={(e) => {
                setName(e.currentTarget.value);
              }}
              maxLength={60}
              required
              data-autofocus
              error={saveView.error ? errorMessage(saveView.error) : undefined}
            />
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => {
                  setNaming(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" loading={saveView.isPending}>
                Save view
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

/** One person's tasks in the report's dates. */
function PersonDrawer({
  id,
  name,
  filters,
  onClose,
}: {
  id: string | null;
  name: string | undefined;
  filters: ReportFilters;
  onClose: () => void;
}) {
  const { me } = useMeData();
  const tasks = usePersonTasks(id, filters);
  const items = tasks.data?.items ?? [];
  return (
    <Drawer
      opened={id !== null}
      onClose={onClose}
      position="right"
      size={560}
      title={name ?? items[0]?.person.fullName ?? 'Tasks'}
    >
      <ErrorAlert error={tasks.error} />
      <div className="tlist">
        {items.map((c) => (
          <CopyRowButton key={c.id} c={c} tz={me.organisation.timezone} />
        ))}
      </div>
      {items.length === 0 && !tasks.isLoading && !tasks.error && (
        <p className="empty">No tasks in these dates.</p>
      )}
    </Drawer>
  );
}
