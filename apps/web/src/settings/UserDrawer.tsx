import {
  Alert,
  Button,
  Drawer,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { formatMobile, userSchema } from '@kidzonia/shared';
import type { RecordFacts, SchoolScope, User } from '@kidzonia/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { api } from '../api/client';
import { useMeData } from '../shell/AppLayout';
import { ErrorAlert, fieldError } from '../ui/errors';
import { notify } from '../ui/notify';
import { PersonSelect } from '../ui/PersonSelect';
import { keys, useAssignableRoles, useSchools } from './queries';
import { ScopePicker } from './ScopePicker';

const HEAD_OFFICE = 'head_office';
const updateResult = z.object({ user: userSchema, pending: z.array(z.string()) });

interface Draft {
  fullName: string;
  mobile: string;
  email: string;
  jobTitle: string;
  employeeId: string;
  homeSchoolId: string | null;
  reportsToUserId: string | null;
  department: string;
  startDate: string;
}

const fromUser = (u: User | null): Draft => ({
  fullName: u?.fullName ?? '',
  mobile: u?.mobile ? formatMobile(u.mobile) : '',
  email: u?.email ?? '',
  jobTitle: u?.jobTitle ?? '',
  employeeId: u?.employeeId ?? '',
  homeSchoolId: u?.homeSchoolId ?? null,
  reportsToUserId: u?.reportsToUserId ?? null,
  department: u?.department ?? '',
  startDate: u?.startDate ?? '',
});

/** Maps editable props to their registry field (e.g. homeSchoolId → school). */
const FIELD_OF: Record<keyof Draft, string | null> = {
  fullName: 'fullName',
  mobile: 'mobile',
  email: 'email',
  employeeId: 'employeeId',
  homeSchoolId: 'school',
  reportsToUserId: 'reportsTo',
  jobTitle: null,
  department: null,
  startDate: null,
};

export function DeactivateModal({
  user,
  opened,
  onClose,
}: {
  user: User;
  opened: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const reports = user.directReportsCount ?? 0;
  const run = useMutation({
    mutationFn: () =>
      api(`/users/${user.id}/deactivate`, z.object({ movedReports: z.number() }), {
        method: 'POST',
        body: { moveReportsTo: moveTo },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.users });
      notify(`${user.fullName ?? 'This person'} was deactivated and signed out.`);
      onClose();
    },
  });
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`Deactivate ${user.fullName ?? 'this person'}?`}
      centered
      radius="lg"
    >
      <ErrorAlert error={run.error} />
      <Stack>
        <Text>
          They’ll be signed out straight away and won’t be able to sign in until reactivated.
        </Text>
        {reports > 0 && (
          <>
            <Alert color="yellow" variant="light">
              {reports} {reports === 1 ? 'person reports' : 'people report'} to {user.fullName}.
              Choose who they report to now, or approvals for them will go to {user.fullName}’s own
              manager.
            </Alert>
            <PersonSelect
              label="New manager for their team"
              value={moveTo}
              onChange={setMoveTo}
              exclude={[user.id]}
              error={fieldError(run.error, 'reportsToUserId')}
            />
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            color="red"
            onClick={() => {
              run.mutate();
            }}
            loading={run.isPending}
          >
            Deactivate
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/**
 * Adding or editing a person (the demo's three sections). Every input follows
 * the signed-in person's field permissions for this record; the server
 * enforces the same rules.
 */
export function UserDrawer({
  opened,
  onClose,
  user,
}: {
  opened: boolean;
  onClose: () => void;
  user: User | null;
}) {
  const qc = useQueryClient();
  const { access, me } = useMeData();
  const isNew = user === null;
  const schools = useSchools(opened);
  const canGiveRoles = access.can('users', isNew ? 'create' : 'edit');
  const roles = useAssignableRoles(opened && canGiveRoles);
  const [draft, setDraft] = useState<Draft>(fromUser(user));
  const [roleId, setRoleId] = useState<string | null>(user?.role?.id ?? null);
  const [scope, setScope] = useState<SchoolScope>(
    user?.role?.scope ?? {
      allSchools: false,
      schoolIds: user?.homeSchoolId ? [user.homeSchoolId] : [],
    },
  );
  const [sendInvite, setSendInvite] = useState(true);
  const [deactivating, setDeactivating] = useState(false);

  const facts: RecordFacts | undefined = user
    ? { subjectUserIds: [user.id], schoolIds: user.homeSchoolId ? [user.homeSchoolId] : [] }
    : undefined;
  const fieldState = (prop: keyof Draft): 'hidden' | 'view' | 'edit' => {
    const field = FIELD_OF[prop];
    if (access.readOnly) return 'view';
    if (!field) return isNew || access.can('users', 'edit', facts) ? 'edit' : 'view';
    return access.fieldAccess('users', field, facts);
  };
  const scopeAllowed = me.role?.isOwner === true || me.scope.allSchools;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
  };

  const body = useMemo(() => {
    const out: Record<string, unknown> = {};
    const initial = fromUser(user);
    for (const k of Object.keys(draft) as (keyof Draft)[]) {
      if (fieldState(k) !== 'edit') continue;
      if (!isNew && draft[k] === initial[k]) continue;
      const v = draft[k];
      out[k] = v === '' ? null : v;
    }
    return out;
    // fieldState depends on access/user, both stable while the drawer is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, user, isNew]);

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) {
        return {
          user: await api('/users', userSchema, {
            method: 'POST',
            body: {
              ...body,
              homeSchoolId: draft.homeSchoolId,
              role: roleId ? { roleId, scope } : null,
              sendInvite,
            },
          }),
          pending: [] as string[],
        };
      }
      const updated =
        Object.keys(body).length > 0
          ? await api(`/users/${user.id}`, updateResult, { method: 'PUT', body })
          : { user, pending: [] as string[] };
      const roleChanged =
        canGiveRoles &&
        (roleId !== (user.role?.id ?? null) ||
          JSON.stringify(scope) !== JSON.stringify(user.role?.scope ?? scope));
      if (roleChanged) {
        await api(`/users/${user.id}/role`, userSchema, {
          method: 'PUT',
          body: { role: roleId ? { roleId, scope } : null },
        });
      }
      return updated;
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: keys.users });
      notify(
        isNew
          ? `${r.user.fullName ?? 'Person'} added.${sendInvite ? ' Invite sent.' : ''}${roleId ? '' : ' They’ll see nothing until they get a role.'}`
          : r.pending.length > 0
            ? 'Saved. Some changes are waiting for approval.'
            : 'Saved',
      );
      onClose();
    },
  });

  const invite = useMutation({
    mutationFn: () => api(`/users/${user?.id ?? ''}/invite`, userSchema, { method: 'POST' }),
    onSuccess: () => {
      notify('Invite sent');
    },
  });
  const reactivate = useMutation({
    mutationFn: () => api(`/users/${user?.id ?? ''}/reactivate`, userSchema, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.users });
      notify('Reactivated');
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/users/${user?.id ?? ''}`, z.undefined(), { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.users });
      notify('Deleted');
      onClose();
    },
  });

  const input = (
    prop: keyof Draft,
    label: string,
    extra: Partial<Parameters<typeof TextInput>[0]> = {},
  ) => {
    const state = fieldState(prop);
    if (state === 'hidden') return null;
    return (
      <TextInput
        label={label}
        value={draft[prop] ?? ''}
        onChange={(e) => {
          set(prop, e.currentTarget.value);
        }}
        disabled={state !== 'edit'}
        error={fieldError(save.error, prop)}
        {...extra}
      />
    );
  };

  const schoolOptions = [
    ...(me.role?.isOwner || me.scope.allSchools
      ? [{ value: HEAD_OFFICE, label: 'Head office' }]
      : []),
    ...(schools.data?.items ?? []).map((s) => ({ value: s.id, label: s.name ?? 'School' })),
  ];
  const editableUser = user && !access.readOnly && access.can('users', 'edit', facts);

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="lg"
      title={isNew ? 'Add user' : (user.fullName ?? 'Person')}
      padding="lg"
    >
      <ErrorAlert error={save.error ?? invite.error ?? reactivate.error ?? remove.error} />
      <Stack gap="lg">
        <section>
          <h3 className="sec-h">The person</h3>
          <Stack gap="sm">
            {input('fullName', 'Full name', { required: true })}
            <div className="two">
              {input('mobile', 'Mobile number', {
                required: true,
                inputMode: 'tel',
                description: 'Used to sign in with a one-time code',
              })}
              {input('email', 'Email', { type: 'email' })}
            </div>
            <div className="two">
              {input('jobTitle', 'Job title', { placeholder: 'Teacher, KG 1' })}
              {input('employeeId', 'Employee ID')}
            </div>
          </Stack>
        </section>
        <section>
          <h3 className="sec-h">Where they work</h3>
          <Stack gap="sm">
            <div className="two">
              {fieldState('homeSchoolId') !== 'hidden' && (
                <Select
                  label="School"
                  required
                  data={schoolOptions}
                  value={draft.homeSchoolId ?? (isNew ? null : HEAD_OFFICE)}
                  onChange={(v) => {
                    set('homeSchoolId', v === HEAD_OFFICE ? null : v);
                  }}
                  disabled={fieldState('homeSchoolId') !== 'edit'}
                  error={fieldError(save.error, 'homeSchoolId')}
                />
              )}
              {fieldState('reportsToUserId') !== 'hidden' && (
                <PersonSelect
                  label="Reports to"
                  description="Their work goes to this person for approval"
                  value={draft.reportsToUserId}
                  currentName={user?.reportsToName}
                  onChange={(v) => {
                    set('reportsToUserId', v);
                  }}
                  exclude={user ? [user.id] : []}
                  disabled={fieldState('reportsToUserId') !== 'edit'}
                  error={fieldError(save.error, 'reportsToUserId')}
                />
              )}
            </div>
            <div className="two">
              {input('department', 'Department')}
              {input('startDate', 'Start date', { type: 'date' })}
            </div>
          </Stack>
        </section>
        {canGiveRoles && !access.readOnly && (
          <section>
            <h3 className="sec-h">Access</h3>
            <Stack gap="sm">
              <Select
                label="Role"
                data={[
                  { value: '', label: 'No access yet (give a role later)' },
                  ...(roles.data?.items ?? []).map((r) => ({ value: r.id, label: r.name })),
                  ...(user?.role && !(roles.data?.items ?? []).some((r) => r.id === user.role?.id)
                    ? [{ value: user.role.id, label: user.role.name }]
                    : []),
                ]}
                value={roleId ?? ''}
                onChange={(v) => {
                  setRoleId(v ? v : null);
                }}
                description="Without a role, they can sign in but won’t see anything."
              />
              {roleId && (
                <ScopePicker
                  value={scope}
                  onChange={setScope}
                  allowAll={scopeAllowed}
                  error={fieldError(save.error, 'scope')}
                />
              )}
              {isNew && (
                <Switch
                  label="Send invite by SMS and WhatsApp"
                  description="They sign in with a one-time code and can set a password later"
                  checked={sendInvite}
                  onChange={(e) => {
                    setSendInvite(e.currentTarget.checked);
                  }}
                />
              )}
            </Stack>
          </section>
        )}
        {!access.readOnly && (
          <Group justify="space-between" className="drawer-actions">
            <Group gap="xs">
              {editableUser && user.status !== 'inactive' && (
                <>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => {
                      invite.mutate();
                    }}
                    loading={invite.isPending}
                  >
                    Re-send invite
                  </Button>
                  <Button
                    variant="subtle"
                    color="red"
                    size="sm"
                    onClick={() => {
                      setDeactivating(true);
                    }}
                  >
                    Deactivate
                  </Button>
                </>
              )}
              {editableUser && user.status === 'inactive' && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    reactivate.mutate();
                  }}
                >
                  Reactivate
                </Button>
              )}
              {user && access.can('users', 'delete', facts) && (
                <Button
                  variant="subtle"
                  color="red"
                  size="sm"
                  onClick={() => {
                    remove.mutate();
                  }}
                  loading={remove.isPending}
                >
                  Delete
                </Button>
              )}
            </Group>
            <Group gap="xs">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  save.mutate();
                }}
                loading={save.isPending}
              >
                {isNew ? 'Add user' : 'Save'}
              </Button>
            </Group>
          </Group>
        )}
      </Stack>
      {user && (
        <DeactivateModal
          user={user}
          opened={deactivating}
          onClose={() => {
            setDeactivating(false);
            onClose();
          }}
        />
      )}
    </Drawer>
  );
}
