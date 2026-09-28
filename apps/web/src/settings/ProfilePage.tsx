import { Alert, Button, Group, PasswordInput, Stack, TextInput } from '@mantine/core';
import { formatMobile, profileResultSchema, userSchema } from '@kidzonia/shared';
import type { User } from '@kidzonia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { ApiError, api } from '../api/client';
import { useMeData } from '../shell/AppLayout';
import { ErrorAlert, fieldError } from '../ui/errors';
import { notify } from '../ui/notify';
import { keys } from './queries';
import { PhotoField } from './PhotoField';

const FIELDS: {
  prop: 'fullName' | 'mobile' | 'email' | 'employeeId';
  field: string;
  label: string;
}[] = [
  { prop: 'fullName', field: 'fullName', label: 'Full name' },
  { prop: 'mobile', field: 'mobile', label: 'Mobile number' },
  { prop: 'email', field: 'email', label: 'Email' },
  { prop: 'employeeId', field: 'employeeId', label: 'Employee ID' },
];

const valuesOf = (u: User): Record<string, string> => ({
  fullName: u.fullName ?? '',
  mobile: u.mobile ? formatMobile(u.mobile) : '',
  email: u.email ?? '',
  employeeId: u.employeeId ?? '',
});

function DetailsForm({
  user,
  onSaved,
}: {
  user: User;
  onSaved: (u: User, pending: string[]) => void;
}) {
  const { access, me } = useMeData();
  const [draft, setDraft] = useState(valuesOf(user));
  const facts = {
    subjectUserIds: [me.user.id],
    schoolIds: me.user.homeSchoolId ? [me.user.homeSchoolId] : [],
  };
  const state = (field: string) =>
    access.readOnly ? 'view' : access.fieldAccess('users', field, facts);

  const save = useMutation({
    mutationFn: () => {
      const before = valuesOf(user);
      const body: Record<string, string | null> = {};
      for (const f of FIELDS) {
        if (state(f.field) !== 'edit') continue;
        const value = draft[f.prop] ?? '';
        if (value !== before[f.prop]) body[f.prop] = value || null;
      }
      return api('/me/profile', profileResultSchema, { method: 'PUT', body });
    },
    onSuccess: (r) => {
      onSaved(r.user, r.pending);
      notify(r.pending.length > 0 ? 'Sent to your manager for approval' : 'Saved');
    },
  });

  const visible = FIELDS.filter((f) => state(f.field) !== 'hidden');
  const editable = visible.some((f) => state(f.field) === 'edit');
  return (
    <Stack>
      <ErrorAlert error={save.error} />
      {visible.map((f) => (
        <TextInput
          key={f.prop}
          label={f.label}
          value={draft[f.prop] ?? ''}
          onChange={(e) => {
            setDraft({ ...draft, [f.prop]: e.currentTarget.value });
          }}
          disabled={state(f.field) !== 'edit'}
          error={fieldError(save.error, f.prop)}
        />
      ))}
      {editable && (
        <Group>
          <Button
            onClick={() => {
              save.mutate();
            }}
            loading={save.isPending}
          >
            Save details
          </Button>
        </Group>
      )}
    </Stack>
  );
}

function Details() {
  const qc = useQueryClient();
  const { access, me } = useMeData();
  const profile = useQuery({
    queryKey: keys.profile,
    queryFn: () => api('/me/profile', userSchema),
    retry: false,
    // The form holds unsaved edits; don't refetch the record underneath it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [pending, setPending] = useState<string[]>([]);
  const [saves, setSaves] = useState(0);

  if (profile.error instanceof ApiError && profile.error.status !== 401) return null;
  // Show the form only with the record loaded, so nothing typed gets replaced.
  if (!profile.data) return null;
  return (
    <section className="panel" aria-labelledby="det-h">
      <div className="panel-h">
        <h2 id="det-h">Your details</h2>
      </div>
      <div className="panel-b">
        {pending.length > 0 && (
          <Alert color="yellow" variant="light" mb="md">
            Your manager needs to approve this change. It will show here once they do.
          </Alert>
        )}
        <PhotoField
          name={profile.data.fullName ?? me.user.fullName}
          photoUrl={profile.data.photoUrl ?? me.user.photoUrl}
          path="/me/photo"
          canEdit={!access.readOnly}
        />
        <DetailsForm
          key={saves}
          user={profile.data}
          onSaved={(u, p) => {
            qc.setQueryData(keys.profile, u);
            setPending(p);
            setSaves((n) => n + 1);
          }}
        />
      </div>
    </section>
  );
}

function Password() {
  const { access } = useMeData();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () =>
      api('/me/password', z.undefined(), {
        method: 'PUT',
        body: { currentPassword: current || null, newPassword: next },
      }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      notify('Password changed. Other devices have been signed out.');
    },
  });
  if (access.readOnly) return null;
  return (
    <section className="panel" aria-labelledby="pw-h">
      <div className="panel-h">
        <h2 id="pw-h">Password</h2>
      </div>
      <div className="panel-b">
        <ErrorAlert error={change.error} />
        <Stack>
          <PasswordInput
            label="Current password"
            description="Leave empty if you’ve never set one"
            autoComplete="current-password"
            value={current}
            onChange={(e) => {
              setCurrent(e.currentTarget.value);
            }}
            error={fieldError(change.error, 'currentPassword')}
          />
          <PasswordInput
            label="New password"
            description="At least 8 characters"
            autoComplete="new-password"
            value={next}
            onChange={(e) => {
              setNext(e.currentTarget.value);
            }}
            error={fieldError(change.error, 'newPassword')}
          />
          <Group>
            <Button
              onClick={() => {
                change.mutate();
              }}
              loading={change.isPending}
              disabled={next.length === 0}
            >
              Change password
            </Button>
          </Group>
        </Stack>
      </div>
    </section>
  );
}

export function ProfilePage() {
  return (
    <>
      <div className="pagehead">
        <h1>Your details</h1>
      </div>
      <div className="grid2">
        <Details />
        <Password />
      </div>
    </>
  );
}
