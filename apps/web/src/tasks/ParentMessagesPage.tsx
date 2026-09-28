import { Button, Group, Select, TextInput } from '@mantine/core';
import {
  PARENT_MESSAGE_STATUS_LABEL,
  PARENT_MESSAGE_STATUSES,
  parentMessageLogSchema,
} from '@kidzonia/shared';
import type { ParentMessageSummary } from '@kidzonia/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { api } from '../api/client';
import { useMeData } from '../shell/AppLayout';
import { NarrowedChip } from '../shell/SchoolSwitcher';
import { ErrorAlert } from '../ui/errors';
import { TaskDrawers, useTaskParams } from './TasksPage';

type Status = ParentMessageSummary['status'];
const schoolList = z.object({ items: z.array(z.object({ id: z.string(), name: z.string() })) });

const counts = (m: ParentMessageSummary) =>
  m.status === 'skipped'
    ? (m.skipReason ?? 'Not sent')
    : m.status === 'queued' || m.status === 'sending'
      ? 'Sending…'
      : `Sent to ${String(m.sentCount)} of ${String(m.recipientsCount)} parents${
          m.skippedCount ? `, ${String(m.skippedCount)} not sent` : ''
        }${m.failedCount ? `, ${String(m.failedCount)} failed` : ''}`;

/**
 * The parent message log (Phase 6 answer 4): what went to which class's
 * parents and how many were reached. Counts only: no parent's number or
 * child's name ever appears here.
 */
export function ParentMessagesPage() {
  const { me, access } = useMeData();
  const nav = useTaskParams();
  const tz = me.organisation.timezone;
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [className, setClassName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // School names for the filter, when the person can also open Parent contacts.
  const schools = useQuery({
    queryKey: ['parent-contacts', 'schools'],
    queryFn: () => api('/parent-contacts/schools', schoolList),
    enabled: access.can('parent_contacts', 'view'),
  });
  const params = new URLSearchParams({ limit: '50' });
  if (schoolId) params.set('schoolId', schoolId);
  if (status) params.set('status', status);
  if (className.trim()) params.set('className', className.trim());
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const log = useInfiniteQuery({
    queryKey: ['parent-messages', params.toString()],
    queryFn: ({ pageParam }) =>
      api(
        `/parent-messages?${params.toString()}${pageParam ? `&cursor=${pageParam}` : ''}`,
        parentMessageLogSchema,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = log.data?.pages.flatMap((p) => p.items) ?? [];
  const when = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  });

  return (
    <>
      <NarrowedChip />
      <div className="pagehead">
        <h1>Parent messages</h1>
      </div>
      <section className="panel filters">
        <Group align="flex-end" gap="sm" wrap="wrap">
          {(schools.data?.items.length ?? 0) > 1 && (
            <Select
              label="School"
              data={[
                { value: '', label: 'All schools' },
                ...(schools.data?.items ?? []).map((s) => ({ value: s.id, label: s.name })),
              ]}
              value={schoolId ?? ''}
              onChange={(v) => {
                setSchoolId(v || null);
              }}
              allowDeselect={false}
              w={190}
            />
          )}
          <Select
            label="Status"
            data={[
              { value: '', label: 'Any status' },
              ...PARENT_MESSAGE_STATUSES.map((s) => ({
                value: s,
                label: PARENT_MESSAGE_STATUS_LABEL[s],
              })),
            ]}
            value={status ?? ''}
            onChange={(v) => {
              setStatus((v as Status | '') || null);
            }}
            allowDeselect={false}
            w={170}
          />
          <TextInput
            label="Class"
            value={className}
            onChange={(e) => {
              setClassName(e.currentTarget.value);
            }}
            w={150}
          />
          <TextInput
            type="date"
            label="From"
            value={from}
            onChange={(e) => {
              setFrom(e.currentTarget.value);
            }}
          />
          <TextInput
            type="date"
            label="To"
            value={to}
            onChange={(e) => {
              setTo(e.currentTarget.value);
            }}
          />
        </Group>
      </section>
      <ErrorAlert error={log.error} />
      <section className="panel">
        <div className="tbl-wrap">
          <table className="plain">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Task</th>
                <th scope="col">For</th>
                <th scope="col">Class</th>
                <th scope="col">Message</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>
                    <time dateTime={m.createdAt}>{when.format(new Date(m.createdAt))}</time>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="rowlink"
                      onClick={() => {
                        nav.open(m.taskId);
                      }}
                    >
                      {m.taskTitle}
                    </button>
                  </td>
                  <td>{m.personName}</td>
                  <td>
                    {m.className}
                    {m.schoolName && <span className="small muted">, {m.schoolName}</span>}
                  </td>
                  <td>{m.templateName ?? <span className="muted">Removed</span>}</td>
                  <td>
                    <span className={`chip pm-${m.status}`}>
                      {PARENT_MESSAGE_STATUS_LABEL[m.status]}
                    </span>{' '}
                    <span className="small muted">{counts(m)}</span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !log.isLoading && (
                <tr>
                  <td colSpan={6} className="empty">
                    No messages to parents yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {log.hasNextPage && (
          <Group justify="center" p="md">
            <Button variant="default" onClick={() => void log.fetchNextPage()}>
              Show more
            </Button>
          </Group>
        )}
      </section>
      <TaskDrawers />
    </>
  );
}
