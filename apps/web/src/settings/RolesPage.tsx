import {
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core';
import {
  assignmentSchema,
  automaticRolesSchema,
  pageSchema,
  roleDetailSchema,
} from '@kidzonia/shared';
import type { RoleSummary, SchoolScope } from '@kidzonia/shared';
import { IconLock, IconPlus, IconUsers } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { api } from '../api/client';
import { useMeData } from '../shell/AppLayout';
import { initials } from '../shell/TopBar';
import { ErrorAlert, fieldError } from '../ui/errors';
import { notify } from '../ui/notify';
import { PersonSelect } from '../ui/PersonSelect';
import { keys, rolePage, useSchools } from './queries';
import { ScopePicker } from './ScopePicker';

const holdersPage = pageSchema(assignmentSchema);

function ManagePeople({ role, onClose }: { role: RoleSummary | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { access, me } = useMeData();
  const schools = useSchools(role !== null);
  const [person, setPerson] = useState<string | null>(null);
  const scopeAllowed = me.role?.isOwner === true || me.scope.allSchools;
  const [scope, setScope] = useState<SchoolScope>(
    scopeAllowed
      ? { allSchools: true, schoolIds: [] }
      : { allSchools: false, schoolIds: [...me.scope.schoolIds] },
  );
  const holders = useQuery({
    queryKey: keys.holders(role?.id ?? ''),
    queryFn: () => api(`/roles/${role?.id ?? ''}/assignments?limit=200`, holdersPage),
    enabled: role !== null,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.roles });
    void qc.invalidateQueries({ queryKey: keys.users });
  };
  const add = useMutation({
    mutationFn: () =>
      api(`/roles/${role?.id ?? ''}/assignments`, z.undefined(), {
        method: 'POST',
        body: { userId: person, scope },
      }),
    onSuccess: () => {
      refresh();
      notify(`They can now use the app as ${role?.name ?? 'this role'}.`);
      setPerson(null);
    },
  });
  const remove = useMutation({
    mutationFn: (userId: string) =>
      api(`/roles/${role?.id ?? ''}/assignments/${userId}`, z.undefined(), { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      notify('Role removed. They now have no access.');
    },
  });
  const schoolName = (id: string) =>
    schools.data?.items.find((s) => s.id === id)?.name ?? 'a school';
  const canEdit = access.can('roles', 'edit') && !access.readOnly && !role?.isOwner;

  return (
    <Modal
      opened={role !== null}
      onClose={onClose}
      title={role?.name}
      centered
      radius="lg"
      size="lg"
    >
      <ErrorAlert error={add.error ?? remove.error ?? holders.error} />
      {canEdit && (
        <Stack gap="sm" mb="md">
          <PersonSelect label="Add a person" value={person} onChange={setPerson} />
          <ScopePicker
            value={scope}
            onChange={setScope}
            allowAll={scopeAllowed}
            error={fieldError(add.error, 'scope')}
          />
          <Text size="sm" c="dimmed">
            The schools you pick are the scope: where this role applies for that person.
          </Text>
          <Group justify="flex-end">
            <Button
              onClick={() => {
                add.mutate();
              }}
              disabled={!person}
              loading={add.isPending}
            >
              Add
            </Button>
          </Group>
        </Stack>
      )}
      {(holders.data?.items ?? []).map((h) => (
        <div key={h.userId} className="check-row">
          <span className="av sm" aria-hidden="true">
            {initials(h.fullName)}
          </span>
          <div className="grow">
            <b>{h.fullName}</b>
            <div className="small muted">
              {h.scope.allSchools ? 'All schools' : h.scope.schoolIds.map(schoolName).join(', ')}
            </div>
          </div>
          {canEdit && (
            <Button
              size="xs"
              variant="subtle"
              color="red"
              onClick={() => {
                remove.mutate(h.userId);
              }}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {holders.data?.items.length === 0 && <p className="empty">No one has this role yet.</p>}
    </Modal>
  );
}

function NewRoleModal({
  opened,
  onClose,
  roles,
}: {
  opened: boolean;
  onClose: () => void;
  roles: RoleSummary[];
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [copyFrom, setCopyFrom] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api('/roles', roleDetailSchema, {
        method: 'POST',
        body: { name, description, copyFromRoleId: copyFrom },
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: keys.roles });
      notify(`${r.name} created. Use “people” to give it to someone.`);
      onClose();
      void navigate(`/settings/roles/${r.id}`);
    },
  });
  return (
    <Modal opened={opened} onClose={onClose} title="New role" centered radius="lg">
      <ErrorAlert error={create.error} />
      <Stack>
        <TextInput
          label="Role name"
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value);
          }}
          error={fieldError(create.error, 'name')}
          data-autofocus
        />
        <TextInput
          label="Description"
          value={description}
          onChange={(e) => {
            setDescription(e.currentTarget.value);
          }}
        />
        <Select
          label="Copy from"
          placeholder="Start empty"
          clearable
          data={roles.filter((r) => !r.isOwner).map((r) => ({ value: r.id, label: r.name }))}
          value={copyFrom}
          onChange={setCopyFrom}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              create.mutate();
            }}
            loading={create.isPending}
          >
            Create role
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function AutomaticRoles() {
  const qc = useQueryClient();
  const { access } = useMeData();
  const data = useQuery({
    queryKey: keys.automatic,
    queryFn: () => api('/automatic-roles', automaticRolesSchema),
  });
  const save = useMutation({
    mutationFn: (s: Record<string, boolean>) =>
      api('/automatic-roles', automaticRolesSchema, { method: 'PUT', body: { switches: s } }),
    onSuccess: (d) => {
      qc.setQueryData(keys.automatic, d);
      notify('Saved');
    },
  });
  const canEdit = access.can('roles', 'edit') && !access.readOnly;
  return (
    <>
      <p className="muted lead">
        These roles come from how people are set up, not from a list. Nobody needs to be added to
        them.
      </p>
      <ErrorAlert error={save.error ?? data.error} />
      <section className="panel">
        <div className="role-row">
          <div className="t">
            <b>Reporting manager</b>
            <span>Anyone who has people reporting to them. Applies to their team only.</span>
          </div>
        </div>
        <div className="panel-b">
          {(data.data?.switches ?? []).map((s) => (
            <div key={s.key} className="opt">
              <div className="t">
                <b>{s.label}</b>
                <span>{s.description}</span>
              </div>
              <Switch
                checked={s.enabled}
                aria-label={s.label}
                disabled={!canEdit}
                onChange={(e) => {
                  save.mutate({ [s.key]: e.currentTarget.checked });
                }}
              />
            </div>
          ))}
        </div>
        <div className="role-row">
          <div className="t">
            <b>Watcher</b>
            <span>
              Anyone added to a task as a watcher. Sees that task, and edits it if given edit
              rights.
            </span>
          </div>
        </div>
      </section>
    </>
  );
}

export function RolesPage() {
  const { access } = useMeData();
  const roles = useQuery({
    queryKey: keys.roles,
    queryFn: () => api('/roles?limit=200', rolePage),
  });
  const [managing, setManaging] = useState<RoleSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const items = roles.data?.items ?? [];
  const canCreate = access.can('roles', 'create') && !access.readOnly;
  const canEdit = access.can('roles', 'edit') && !access.readOnly;

  return (
    <>
      <div className="pagehead">
        <h1>Roles &amp; permissions</h1>
      </div>
      <Tabs defaultValue="roles" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="roles">Roles</Tabs.Tab>
          <Tabs.Tab value="auto">Automatic roles</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="roles">
          <Group justify="space-between" mb="md" wrap="nowrap">
            <p className="muted">
              A role decides which sections people see and what they can do in them.
            </p>
            {canCreate && (
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={() => {
                  setCreating(true);
                }}
              >
                New role
              </Button>
            )}
          </Group>
          <ErrorAlert error={roles.error} />
          <section className="panel">
            {items.map((r) => (
              <div key={r.id} className="role-row">
                <div className="t">
                  <b>
                    {r.name}
                    {r.isOwner && (
                      <Badge
                        size="sm"
                        variant="light"
                        color="amber"
                        leftSection={<IconLock size={12} />}
                      >
                        Locked
                      </Badge>
                    )}
                  </b>
                  <span>
                    {r.description ?? ''} {r.modulesOn} sections.
                  </span>
                </div>
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconUsers size={15} />}
                  onClick={() => {
                    setManaging(r);
                  }}
                >
                  {r.peopleCount} {r.peopleCount === 1 ? 'person' : 'people'}
                </Button>
                <Button size="xs" variant="default" component={Link} to={`/settings/roles/${r.id}`}>
                  {r.isOwner || !canEdit ? 'View' : 'Edit'}
                </Button>
              </div>
            ))}
          </section>
        </Tabs.Panel>
        <Tabs.Panel value="auto">
          <AutomaticRoles />
        </Tabs.Panel>
      </Tabs>
      <ManagePeople
        key={managing?.id ?? 'none'}
        role={managing}
        onClose={() => {
          setManaging(null);
        }}
      />
      <NewRoleModal
        opened={creating}
        onClose={() => {
          setCreating(false);
        }}
        roles={items}
      />
    </>
  );
}
