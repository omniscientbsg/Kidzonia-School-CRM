import { Badge, Button, Group, Modal, Stack, Tabs, Text, TextInput } from '@mantine/core';
import { fieldChangeSchema, pageSchema } from '@kidzonia/shared';
import type { FieldChange } from '@kidzonia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { api } from '../api/client';
import { ME_QUERY_KEY } from '../auth/use-me';
import { useMeData } from '../shell/AppLayout';
import { ErrorAlert } from '../ui/errors';
import { notify } from '../ui/notify';
import { keys } from './queries';

const changeWithHidden = fieldChangeSchema.extend({ valuesHidden: z.boolean() });
const changesPage = pageSchema(changeWithHidden);
type Change = z.infer<typeof changeWithHidden>;

/** Values are stored as { prop: value }; show them as plain text. */
const one = (x: unknown): string => {
  if (x === null || x === undefined || x === '') return 'empty';
  if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') return String(x);
  return JSON.stringify(x);
};
const show = (v: unknown): string =>
  v && typeof v === 'object'
    ? Object.values(v as Record<string, unknown>)
        .map(one)
        .join(', ')
    : one(v);

const STATUS: Record<FieldChange['status'], { label: string; color: string }> = {
  pending: { label: 'Waiting', color: 'amber' },
  approved: { label: 'Approved', color: 'green' },
  rejected: { label: 'Rejected', color: 'red' },
  superseded: { label: 'Replaced', color: 'gray' },
  out_of_date: { label: 'Out of date', color: 'gray' },
};

function Row({ c, decide }: { c: Change; decide: boolean }) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.changes });
    void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
  };
  const approve = useMutation({
    mutationFn: () =>
      api(`/field-changes/${c.id}/approve`, z.object({ status: z.string() }), { method: 'POST' }),
    onSuccess: (r) => {
      refresh();
      notify(
        r.status === 'out_of_date'
          ? 'This changed since it was requested, so it wasn’t applied.'
          : 'Approved',
      );
    },
  });
  const reject = useMutation({
    mutationFn: () =>
      api(`/field-changes/${c.id}/reject`, z.object({ status: z.string() }), {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: () => {
      refresh();
      setRejecting(false);
      notify('Rejected');
    },
  });
  return (
    <div className="role-row">
      <div className="t">
        <b>
          {c.subject.fullName}: {c.fieldLabel}
          <Badge size="sm" variant="light" color={STATUS[c.status].color}>
            {STATUS[c.status].label}
          </Badge>
        </b>
        <span>
          {c.valuesHidden
            ? 'Your role hides this field, so the values aren’t shown.'
            : `${show(c.oldValue)} → ${show(c.newValue)}`}
          {c.reason ? ` · “${c.reason}”` : ''}
        </span>
        <ErrorAlert error={approve.error ?? reject.error} />
      </div>
      {decide && c.status === 'pending' && (
        <Group gap="xs">
          <Button
            size="xs"
            variant="default"
            onClick={() => {
              setRejecting(true);
            }}
          >
            Reject
          </Button>
          <Button
            size="xs"
            onClick={() => {
              approve.mutate();
            }}
            loading={approve.isPending}
          >
            Approve
          </Button>
        </Group>
      )}
      <Modal
        opened={rejecting}
        onClose={() => {
          setRejecting(false);
        }}
        title="Reject this change"
        centered
        radius="lg"
      >
        <Stack>
          <TextInput
            label="Reason (optional)"
            value={reason}
            onChange={(e) => {
              setReason(e.currentTarget.value);
            }}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setRejecting(false);
              }}
            >
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => {
                reject.mutate();
              }}
              loading={reject.isPending}
            >
              Reject
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}

function List({ view }: { view: 'to_approve' | 'mine' }) {
  const list = useQuery({
    queryKey: [...keys.changes, view],
    queryFn: () => api(`/field-changes?view=${view}&limit=100`, changesPage),
  });
  const items = list.data?.items ?? [];
  return (
    <section className="panel">
      <ErrorAlert error={list.error} />
      {items.map((c) => (
        <Row key={c.id} c={c} decide={view === 'to_approve'} />
      ))}
      {items.length === 0 && !list.isLoading && (
        <p className="empty">
          {view === 'to_approve'
            ? 'Nothing is waiting for your approval.'
            : 'You haven’t asked for any changes.'}
        </p>
      )}
    </section>
  );
}

export function ChangesPage() {
  const { me } = useMeData();
  return (
    <>
      <div className="pagehead">
        <h1>Changes to approve</h1>
      </div>
      <Text c="dimmed" mb="md">
        Some details need a manager’s approval before they change.
      </Text>
      <Tabs defaultValue={me.changesToApprove > 0 ? 'to_approve' : 'mine'} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="to_approve">
            Waiting for you{me.changesToApprove > 0 ? ` (${me.changesToApprove})` : ''}
          </Tabs.Tab>
          <Tabs.Tab value="mine">Your requests</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="to_approve">
          <List view="to_approve" />
        </Tabs.Panel>
        <Tabs.Panel value="mine">
          <List view="mine" />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
