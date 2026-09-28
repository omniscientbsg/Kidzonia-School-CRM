import { Button, Group, Select, TextInput } from '@mantine/core';
import { AUDIT_ACTIONS, AUDIT_AREAS, auditAreaOf, auditLogPageSchema } from '@kidzonia/shared';
import type { AuditArea, AuditEntry } from '@kidzonia/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../api/client';
import { useMeData } from '../shell/AppLayout';
import { ErrorAlert } from '../ui/errors';
import { PersonSelect } from '../ui/PersonSelect';

const AREA_OPTIONS = Object.entries(AUDIT_AREAS).map(([value, label]) => ({ value, label }));

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Changes({ entry }: { entry: AuditEntry }) {
  if (entry.changes.length === 0) return null;
  return (
    <details className="small">
      <summary className="lnk">What changed</summary>
      <ul>
        {entry.changes.map((c, i) => (
          <li key={`${c.field}-${String(i)}`}>
            <b>{c.field}:</b> {c.before ?? <span className="muted">Not set</span>}{' '}
            <span aria-hidden="true">→</span>
            <span className="visually-hidden">changed to</span>{' '}
            {c.after ?? <span className="muted">Not set</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The audit log (brief 10.4): Owners only, like the API. Each line is who did
 * what and when, in the organisation's time zone; "What changed" lists the
 * fields by their labels. Phone numbers arrive already masked.
 */
export function AuditLogPage() {
  const { me } = useMeData();
  const [actor, setActor] = useState<string | null>(null);
  const [area, setArea] = useState<AuditArea | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const actionOptions = useMemo(
    () =>
      Object.entries(AUDIT_ACTIONS)
        .filter(([key]) => !area || auditAreaOf(key) === area)
        .map(([value, label]) => ({ value, label })),
    [area],
  );
  const when = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: me.organisation.timezone,
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }),
    [me.organisation.timezone],
  );

  const params = new URLSearchParams({ limit: '50' });
  if (actor) params.set('actorUserId', actor);
  if (area) params.set('area', area);
  if (action) params.set('action', action);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const list = useInfiniteQuery({
    queryKey: ['audit-log', params.toString()],
    queryFn: ({ pageParam }) =>
      api(
        `/audit-log?${params.toString()}${pageParam ? `&cursor=${pageParam}` : ''}`,
        auditLogPageSchema,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <div className="pagehead">
        <h1>Audit log</h1>
      </div>
      <p className="muted lead">
        Important changes to settings, people and approvals. Only Owners can see this page, and
        phone numbers are partly hidden.
      </p>
      <Group mb="md" gap="sm" wrap="wrap" align="flex-end">
        <PersonSelect label="Person" placeholder="Anyone" value={actor} onChange={setActor} />
        <Select
          label="Area"
          placeholder="All areas"
          clearable
          data={AREA_OPTIONS}
          value={area}
          onChange={(v) => {
            setArea(v as AuditArea | null);
            // A chosen action from another area would leave the list empty.
            if (v && action && auditAreaOf(action) !== v) setAction(null);
          }}
        />
        <Select
          label="Action"
          placeholder="Any action"
          clearable
          searchable
          data={actionOptions}
          value={action}
          onChange={setAction}
        />
        <TextInput
          type="date"
          label="From"
          value={from}
          max={to || undefined}
          onChange={(e) => {
            setFrom(e.currentTarget.value);
          }}
        />
        <TextInput
          type="date"
          label="To"
          value={to}
          min={from || undefined}
          onChange={(e) => {
            setTo(e.currentTarget.value);
          }}
        />
      </Group>
      <ErrorAlert error={list.error} />
      <section className="panel" aria-labelledby="audit-log-h">
        <h2 id="audit-log-h" className="visually-hidden">
          Changes, newest first
        </h2>
        <div className="tbl-wrap">
          <table className="plain">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">What</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="small">
                    <time dateTime={e.createdAt}>{when.format(new Date(e.createdAt))}</time>
                  </td>
                  <td>{e.actor?.fullName ?? <span className="muted">The app</span>}</td>
                  <td>
                    <div>{capitalise(e.summary)}</div>
                    <Changes entry={e} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.isLoading && <p className="empty">Loading…</p>}
        {rows.length === 0 && !list.isLoading && !list.error && (
          <p className="empty">Nothing matches these filters.</p>
        )}
        {list.hasNextPage && (
          <Group justify="center" p="md">
            <Button
              variant="default"
              onClick={() => void list.fetchNextPage()}
              loading={list.isFetchingNextPage}
            >
              Show more
            </Button>
          </Group>
        )}
      </section>
    </>
  );
}
