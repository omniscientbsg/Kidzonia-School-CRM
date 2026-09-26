import {
  Button,
  Checkbox,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import {
  ACTION_TEXT,
  REACHES,
  REACH_TEXT,
  assignmentSchema,
  canConfigureFields,
  pageSchema,
  roleDetailSchema,
  toggleAction,
} from '@kidzonia/shared';
import type { Action, FieldRule, ModuleDef, Reach, RoleDetail } from '@kidzonia/shared';
import { IconArrowLeft, IconEye, IconLock } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { api, setPreview } from '../api/client';
import { useMeData } from '../shell/AppLayout';
import { AppIcon } from '../shell/icons';
import { ErrorAlert, fieldError } from '../ui/errors';
import { notify } from '../ui/notify';
import { keys } from './queries';

type Modules = RoleDetail['modules'];
type Fields = RoleDetail['fields'];

const holdersPage = pageSchema(assignmentSchema);

const withoutKey = <T,>(obj: Record<string, T>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));

const defaultRule = (mod: RoleDetail['modules'][string] | undefined): FieldRule => ({
  access: mod?.actions.includes('edit') ? 'edit' : 'view',
  ownRecord: 'same',
  needsApproval: false,
});

function PreviewModal({
  role,
  opened,
  onClose,
}: {
  role: RoleDetail;
  opened: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const holders = useQuery({
    queryKey: keys.holders(role.id),
    queryFn: () => api(`/roles/${role.id}/assignments?limit=200`, holdersPage),
    enabled: opened,
  });
  const [chosen, setWho] = useState<string | null>(null);
  // Defaults to the first holder until someone else is chosen.
  const who = chosen ?? holders.data?.items[0]?.userId ?? null;
  const start = useMutation({
    mutationFn: () =>
      api('/preview', z.undefined(), { method: 'POST', body: { userId: who }, noPreview: true }),
    onSuccess: () => {
      const person = holders.data?.items.find((h) => h.userId === who);
      setPreview({ userId: who ?? '', name: person?.fullName ?? 'someone' });
      void qc.resetQueries();
      void navigate('/');
    },
  });
  const items = holders.data?.items ?? [];
  return (
    <Modal opened={opened} onClose={onClose} title="Preview as this role" centered radius="lg">
      <ErrorAlert error={start.error} />
      {items.length === 0 ? (
        <Text>No one has this role yet. Add someone first, then preview as them.</Text>
      ) : (
        <Stack>
          <Text size="sm">
            You’ll see the app as this person sees it, but never more than your own role allows.
            Nothing can be changed while previewing.
          </Text>
          <Select
            label="Preview as"
            data={items.map((h) => ({ value: h.userId, label: h.fullName }))}
            value={who}
            onChange={setWho}
            allowDeselect={false}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button
              leftSection={<IconEye size={16} />}
              onClick={() => {
                start.mutate();
              }}
              disabled={!who}
              loading={start.isPending}
            >
              Start preview
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

function ActionsPanel({
  mod,
  modules,
  setModules,
  readOnly,
}: {
  mod: ModuleDef;
  modules: Modules;
  setModules: (m: Modules) => void;
  readOnly: boolean;
}) {
  const grant = modules[mod.key];
  const actions = grant?.actions ?? [];
  const update = (next: Action[], reach?: Reach | null) => {
    const others = withoutKey(modules, mod.key);
    setModules(
      next.length === 0
        ? others
        : {
            ...others,
            [mod.key]: {
              actions: next,
              reach: mod.hasReach ? (reach ?? grant?.reach ?? 'own') : null,
            },
          },
    );
  };
  return (
    <>
      {mod.actions.map((a) => (
        <label key={a} className="pcheck">
          <Checkbox
            checked={actions.includes(a)}
            disabled={readOnly}
            onChange={(e) => {
              update(toggleAction(mod, actions, a, e.currentTarget.checked));
            }}
            aria-label={ACTION_TEXT[a].label}
          />
          <span className="t">
            <b>{ACTION_TEXT[a].label}</b>
            <span>{ACTION_TEXT[a].hint}</span>
          </span>
        </label>
      ))}
      {mod.hasReach && (
        <div className="reach">
          <b id={`reach-${mod.key}`}>Whose records</b>
          <Select
            aria-labelledby={`reach-${mod.key}`}
            data={REACHES.map((r) => ({ value: r, label: REACH_TEXT[r] }))}
            value={grant?.reach ?? 'own'}
            disabled={readOnly || !actions.includes('view')}
            onChange={(v) => {
              if (v) update(actions, v);
            }}
          />
          {!actions.includes('view') && <span className="small muted">Turn on View first</span>}
        </div>
      )}
    </>
  );
}

function FieldsPanel({
  mod,
  modules,
  fields,
  setFields,
  readOnly,
}: {
  mod: ModuleDef;
  modules: Modules;
  fields: Fields;
  setFields: (f: Fields) => void;
  readOnly: boolean;
}) {
  if (!canConfigureFields(modules[mod.key])) {
    return (
      <p className="empty">
        Turn on View for {mod.name} first. Field permissions only apply to sections the role can
        see.
      </p>
    );
  }
  const rules = fields[mod.key] ?? {};
  const setRule = (key: string, patch: Partial<FieldRule>) => {
    const current = rules[key] ?? defaultRule(modules[mod.key]);
    const next = { ...current, ...patch };
    if (next.access === 'edit') next.ownRecord = 'same';
    setFields({ ...fields, [mod.key]: { ...rules, [key]: next } });
  };
  return (
    <>
      <Table.ScrollContainer minWidth={560}>
        <Table verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Field</Table.Th>
              <Table.Th>Access</Table.Th>
              <Table.Th>On their own records</Table.Th>
              <Table.Th>Changes need approval</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(mod.fields ?? []).map((f) => {
              const r = rules[f.key] ?? defaultRule(modules[mod.key]);
              return (
                <Table.Tr key={f.key}>
                  <Table.Td>
                    <b>{f.label}</b>
                  </Table.Td>
                  <Table.Td>
                    <SegmentedControl
                      size="xs"
                      aria-label={`${f.label} access`}
                      value={r.access}
                      disabled={readOnly}
                      onChange={(v) => {
                        setRule(f.key, { access: v });
                      }}
                      data={[
                        { value: 'hidden', label: 'Hidden' },
                        { value: 'view', label: 'View' },
                        { value: 'edit', label: 'Edit' },
                      ]}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Select
                      size="xs"
                      aria-label={`${f.label} on their own records`}
                      data={[
                        { value: 'same', label: 'Same as access' },
                        { value: 'edit', label: 'Can edit their own' },
                      ]}
                      value={r.ownRecord}
                      disabled={readOnly || r.access !== 'view'}
                      onChange={(v) => {
                        if (v) setRule(f.key, { ownRecord: v });
                      }}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Switch
                      aria-label={`Changes to ${f.label} need approval`}
                      checked={r.needsApproval}
                      disabled={readOnly || (r.access !== 'edit' && r.ownRecord !== 'edit')}
                      onChange={(e) => {
                        setRule(f.key, { needsApproval: e.currentTarget.checked });
                      }}
                    />
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Text size="sm" c="dimmed" mt="sm">
        Hidden fields are removed before data leaves the server, not just hidden on screen.
      </Text>
    </>
  );
}

export function RoleEditorPage() {
  // Mounted under the "settings/*" route, so the id is the last path segment.
  const { '*': rest = '' } = useParams();
  const id = rest.split('/').pop() ?? '';
  const role = useQuery({
    queryKey: keys.role(id),
    queryFn: () => api(`/roles/${id}`, roleDetailSchema),
    // The form holds unsaved edits; a background refetch must not replace them.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  if (role.error) return <ErrorAlert error={role.error} />;
  if (!role.data) return null;
  return <RoleEditorForm key={id} role={role.data} />;
}

function RoleEditorForm({ role }: { role: RoleDetail }) {
  const id = role.id;
  const qc = useQueryClient();
  const { access } = useMeData();
  // This organisation's registry: its custom task lists are fields too.
  const registry = access.primary.registry;
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [modules, setModules] = useState<Modules>(role.modules);
  const [fields, setFields] = useState<Fields>(role.fields);
  const [current, setCurrent] = useState(registry.modules[0]?.key ?? 'tasks');
  const [tab, setTab] = useState<'actions' | 'fields'>('actions');
  const [previewing, setPreviewing] = useState(false);

  const readOnly = !role.canEdit;
  const save = useMutation({
    mutationFn: async () => {
      await api(`/roles/${id}`, roleDetailSchema, { method: 'PUT', body: { name, description } });
      await api(`/roles/${id}/permissions`, roleDetailSchema, { method: 'PUT', body: { modules } });
      const kept = Object.fromEntries(
        Object.entries(fields).filter(([k]) => canConfigureFields(modules[k])),
      );
      return api(`/roles/${id}/fields`, roleDetailSchema, {
        method: 'PUT',
        body: { fields: kept },
      });
    },
    onSuccess: (r) => {
      qc.setQueryData(keys.role(id), r);
      void qc.invalidateQueries({ queryKey: keys.roles });
      notify(`${r.name} saved. Changes apply straight away.`);
    },
  });

  const mod = registry.module(current);
  const count = (m: ModuleDef) =>
    m.key in modules ? `${modules[m.key]?.actions.length ?? 0}/${m.actions.length}` : 'Off';
  const groups = registry.apps
    .map((a) => ({ app: a, mods: registry.modulesOf(a.key) }))
    .filter((g) => g.mods.length > 0);

  return (
    <>
      <Button
        component={Link}
        to="/settings/roles"
        variant="subtle"
        size="xs"
        leftSection={<IconArrowLeft size={16} />}
        mb="xs"
      >
        All roles
      </Button>
      {role.isOwner && (
        <div className="locked-note">
          <IconLock size={18} aria-hidden="true" />
          The Owner role always has full access so your organisation can never be locked out.
        </div>
      )}
      <ErrorAlert error={save.error} />
      <Group align="flex-end" gap="md" wrap="wrap">
        <TextInput
          label="Role name"
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value);
          }}
          disabled={readOnly}
          error={fieldError(save.error, 'name')}
          className="grow"
        />
        <TextInput
          label="Description"
          value={description}
          onChange={(e) => {
            setDescription(e.currentTarget.value);
          }}
          disabled={readOnly}
          className="grow2"
        />
      </Group>
      <div className="editor">
        <nav className="feat" aria-label="Sections">
          {groups.map((g) => (
            <div key={g.app.key} className="feat-group">
              <h4>{g.app.name}</h4>
              {g.mods.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  aria-current={current === m.key}
                  onClick={() => {
                    setCurrent(m.key);
                    if (!m.fields) setTab('actions');
                  }}
                >
                  <AppIcon name={m.pages?.[0]?.icon ?? g.app.icon} size={16} />
                  {m.name}
                  <small className={m.key in modules ? 'on' : ''}>
                    {role.isOwner ? 'All' : count(m)}
                  </small>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="perm">
          <div className="perm-h">
            <div>
              <h2>{mod.name}</h2>
              <p>{mod.description}</p>
            </div>
            {!readOnly && (
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="default"
                  onClick={() => {
                    setModules({
                      ...modules,
                      [mod.key]: {
                        actions: [...mod.actions],
                        reach: mod.hasReach ? (modules[mod.key]?.reach ?? 'school') : null,
                      },
                    });
                  }}
                >
                  Select all
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={() => {
                    setModules(withoutKey(modules, mod.key));
                  }}
                >
                  Clear
                </Button>
              </Group>
            )}
          </div>
          {role.isOwner ? (
            <p className="empty">The Owner can do everything in every section.</p>
          ) : (
            <>
              {mod.fields && (
                <SegmentedControl
                  mb="sm"
                  value={tab}
                  onChange={(v) => {
                    setTab(v);
                  }}
                  data={[
                    { value: 'actions', label: 'What they can do' },
                    { value: 'fields', label: 'Field permissions' },
                  ]}
                />
              )}
              {tab === 'actions' || !mod.fields ? (
                <ActionsPanel
                  mod={mod}
                  modules={modules}
                  setModules={setModules}
                  readOnly={readOnly}
                />
              ) : (
                <FieldsPanel
                  mod={mod}
                  modules={modules}
                  fields={fields}
                  setFields={setFields}
                  readOnly={readOnly}
                />
              )}
            </>
          )}
        </div>
      </div>
      <Group justify="flex-end" mt="md" gap="sm">
        {access.can('roles', 'edit') && !access.readOnly && (
          <Button
            variant="default"
            leftSection={<IconEye size={16} />}
            onClick={() => {
              setPreviewing(true);
            }}
          >
            Preview as this role
          </Button>
        )}
        {!readOnly && (
          <>
            <Button variant="default" component={Link} to="/settings/roles">
              Cancel
            </Button>
            <Button
              onClick={() => {
                save.mutate();
              }}
              loading={save.isPending}
            >
              Save role
            </Button>
          </>
        )}
      </Group>
      <PreviewModal
        role={role}
        opened={previewing}
        onClose={() => {
          setPreviewing(false);
        }}
      />
    </>
  );
}
