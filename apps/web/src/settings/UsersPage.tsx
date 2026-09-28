import { Badge, Button, Group, Select, Table, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { formatMobile, userSummarySchema } from '@kidzonia/shared';
import type { User } from '@kidzonia/shared';
import { IconHourglassHigh, IconPlus, IconSearch } from '@tabler/icons-react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { useMeData } from '../shell/AppLayout';
import { NarrowedChip } from '../shell/SchoolSwitcher';
import { Avatar } from '../ui/Avatar';
import { ErrorAlert } from '../ui/errors';
import { keys, useSchools, userPage } from './queries';
import { UserDrawer } from './UserDrawer';

export function UsersPage() {
  const { access } = useMeData();
  const schools = useSchools();
  // Search results for a person open this page already filtered to them.
  const [query] = useSearchParams();
  const q = query.get('q');
  const [search, setSearch] = useState(q ?? '');
  // A new search from the top bar while this page is open replaces the box's text.
  const [lastQ, setLastQ] = useState(q);
  if (q !== lastQ) {
    setLastQ(q);
    if (q !== null) setSearch(q);
  }
  const [term] = useDebouncedValue(search, 300);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  // Columns and filters follow field permissions; the server strips hidden
  // fields and refuses filters on them too.
  const show = (f: string) => access.fieldAccess('users', f) !== 'hidden';

  const params = new URLSearchParams({ limit: '50' });
  if (term) params.set('search', term);
  if (schoolId) params.set('schoolId', schoolId);
  if (status) params.set('status', status);

  const list = useInfiniteQuery({
    queryKey: [...keys.users, 'list', params.toString()],
    queryFn: ({ pageParam }) =>
      api(`/users?${params.toString()}${pageParam ? `&cursor=${pageParam}` : ''}`, userPage),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const summary = useQuery({
    queryKey: [...keys.users, 'summary'],
    queryFn: () => api('/users/summary', userSummarySchema),
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const waiting = summary.data?.waitingForRole ?? 0;
  const canCreate = access.can('users', 'create') && !access.readOnly;

  return (
    <>
      <NarrowedChip />
      <div className="pagehead">
        <h1>Users</h1>
        {canCreate && (
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            Add user
          </Button>
        )}
      </div>
      {waiting > 0 && (
        <div className="banner" role="status">
          <IconHourglassHigh size={20} aria-hidden="true" />
          <span className="grow">
            {waiting} {waiting === 1 ? 'person is' : 'people are'} waiting for a role and can’t use
            the app yet.
          </span>
          {access.can('roles', 'view') && (
            <Button component={Link} to="/settings/roles" size="xs" variant="default">
              Give a role
            </Button>
          )}
        </div>
      )}
      <Group mb="md" gap="sm" wrap="wrap">
        <TextInput
          placeholder="Search people"
          aria-label="Search people"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
          }}
          className="grow"
        />
        {show('school') && (
          <Select
            aria-label="School"
            placeholder="All schools"
            clearable
            data={[
              { value: 'head_office', label: 'Head office' },
              ...(schools.data?.items ?? []).map((s) => ({
                value: s.id,
                label: s.name ?? 'School',
              })),
            ]}
            value={schoolId}
            onChange={setSchoolId}
          />
        )}
        <Select
          aria-label="Status"
          placeholder="Any status"
          clearable
          data={[
            { value: 'active', label: 'Active' },
            { value: 'invited', label: 'Invited' },
            { value: 'inactive', label: 'Inactive' },
          ]}
          value={status}
          onChange={setStatus}
        />
      </Group>
      <ErrorAlert error={list.error} />
      <section className="panel">
        <Table.ScrollContainer minWidth={720}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                {show('mobile') && <Table.Th>Mobile</Table.Th>}
                {show('school') && <Table.Th>School</Table.Th>}
                <Table.Th>Role</Table.Th>
                {show('reportsTo') && <Table.Th>Reports to</Table.Th>}
                {show('employeeId') && <Table.Th>Employee ID</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((u) => (
                <Table.Tr key={u.id}>
                  <Table.Td>
                    <button
                      type="button"
                      className="person lnk-row"
                      onClick={() => {
                        setEditing(u);
                        setOpen(true);
                      }}
                    >
                      <Avatar name={u.fullName ?? '?'} photoUrl={u.photoUrl} size="sm" />
                      <span>
                        <b>{u.fullName ?? 'Someone'}</b>
                        <span>{u.jobTitle ?? ''}</span>
                      </span>
                    </button>
                  </Table.Td>
                  {show('mobile') && <Table.Td>{u.mobile ? formatMobile(u.mobile) : ''}</Table.Td>}
                  {show('school') && <Table.Td>{u.homeSchoolName ?? 'Head office'}</Table.Td>}
                  <Table.Td>
                    {u.status === 'inactive' ? (
                      <Badge color="gray" variant="light">
                        Inactive
                      </Badge>
                    ) : u.role ? (
                      u.role.name
                    ) : (
                      <span className="chip-none">No access yet</span>
                    )}
                  </Table.Td>
                  {show('reportsTo') && (
                    <Table.Td>{u.reportsToName ?? <span className="muted">No one</span>}</Table.Td>
                  )}
                  {show('employeeId') && <Table.Td>{u.employeeId ?? ''}</Table.Td>}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {rows.length === 0 && !list.isLoading && <p className="empty">No one matches.</p>}
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
      <UserDrawer
        // A fresh form each time it opens, filled from the chosen person.
        key={`${String(open)}-${editing?.id ?? 'new'}`}
        opened={open}
        onClose={() => {
          setOpen(false);
        }}
        user={editing}
      />
    </>
  );
}
