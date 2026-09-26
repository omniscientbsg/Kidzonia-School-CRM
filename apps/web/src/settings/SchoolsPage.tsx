import {
  Button,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { schoolSchema } from '@kidzonia/shared';
import type { School } from '@kidzonia/shared';
import { IconPlus } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { useMeData } from '../shell/AppLayout';
import { ErrorAlert, fieldError } from '../ui/errors';
import { notify } from '../ui/notify';
import { PersonSelect } from '../ui/PersonSelect';
import { keys, useAssignableRoles, useSchools } from './queries';

type SchoolType = 'coco' | 'franchise';

function SchoolModal({
  opened,
  onClose,
  school,
}: {
  opened: boolean;
  onClose: () => void;
  school: School | null;
}) {
  const qc = useQueryClient();
  const { access } = useMeData();
  const canInvite = access.can('users', 'create');
  const roles = useAssignableRoles(opened && !school && canInvite);
  const [name, setName] = useState(school?.name ?? '');
  const [city, setCity] = useState(school?.city ?? '');
  const [state, setState] = useState(school?.state ?? '');
  const [type, setType] = useState<SchoolType>(school?.type ?? 'coco');
  const [principal, setPrincipal] = useState<string | null>(school?.principalUserId ?? null);
  const [owner, setOwner] = useState<string | null>(school?.franchiseOwnerUserId ?? null);
  const [inviteName, setInviteName] = useState('');
  const [inviteMobile, setInviteMobile] = useState('');
  const [chosenRole, setInviteRole] = useState<string | null>(null);
  // Defaults to the starter franchise owner role when it's one this person may give.
  const inviteRole =
    chosenRole ?? roles.data?.items.find((r) => r.seedKey === 'franchise_owner')?.id ?? null;

  const save = useMutation({
    mutationFn: () => {
      const base = {
        name,
        city,
        state: state || null,
        type,
        principalUserId: principal,
        franchiseOwnerUserId: type === 'franchise' ? owner : null,
      };
      if (school) return api(`/schools/${school.id}`, schoolSchema, { method: 'PUT', body: base });
      const invite =
        type === 'franchise' && !owner && inviteName && inviteMobile && inviteRole
          ? { fullName: inviteName, mobile: inviteMobile, roleId: inviteRole }
          : null;
      return api('/schools', schoolSchema, {
        method: 'POST',
        body: { ...base, inviteOwner: invite },
      });
    },
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: keys.schools });
      notify(school ? `${s.name ?? 'School'} saved` : `${s.name ?? 'School'} added`);
      onClose();
    },
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={school ? 'Edit school' : 'Add school'}
      centered
      radius="lg"
    >
      <ErrorAlert error={save.error} />
      <Stack>
        <TextInput
          label="School name"
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value);
          }}
          error={fieldError(save.error, 'name')}
          data-autofocus
        />
        <div className="two">
          <TextInput
            label="City"
            value={city}
            onChange={(e) => {
              setCity(e.currentTarget.value);
            }}
            error={fieldError(save.error, 'city')}
          />
          <TextInput
            label="State"
            value={state}
            onChange={(e) => {
              setState(e.currentTarget.value);
            }}
          />
        </div>
        <div>
          <Text size="sm" fw={600} mb={6}>
            Type
          </Text>
          <SegmentedControl
            value={type}
            onChange={(v) => {
              setType(v);
            }}
            data={[
              { value: 'coco', label: 'COCO' },
              { value: 'franchise', label: 'Franchise' },
            ]}
          />
        </div>
        <PersonSelect
          label="Principal"
          value={principal}
          currentName={school?.principalName}
          onChange={setPrincipal}
          error={fieldError(save.error, 'principalUserId')}
        />
        {type === 'franchise' && (
          <>
            <PersonSelect
              label="Franchise owner"
              description={
                school ? undefined : 'Choose someone already added, or invite a new owner below.'
              }
              value={owner}
              currentName={school?.franchiseOwnerName}
              onChange={setOwner}
              error={fieldError(save.error, 'franchiseOwnerUserId')}
            />
            {!school && !owner && canInvite && (
              <>
                <div className="two">
                  <TextInput
                    label="New owner’s name"
                    value={inviteName}
                    onChange={(e) => {
                      setInviteName(e.currentTarget.value);
                    }}
                  />
                  <TextInput
                    label="Owner’s mobile"
                    inputMode="tel"
                    value={inviteMobile}
                    onChange={(e) => {
                      setInviteMobile(e.currentTarget.value);
                    }}
                    error={fieldError(save.error, 'inviteOwner.mobile')}
                  />
                </div>
                <Select
                  label="Their role"
                  data={(roles.data?.items ?? []).map((r) => ({ value: r.id, label: r.name }))}
                  value={inviteRole}
                  onChange={setInviteRole}
                />
                <Text size="sm" c="dimmed">
                  We’ll invite the owner with access to this school only.
                </Text>
              </>
            )}
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              save.mutate();
            }}
            loading={save.isPending}
          >
            {school ? 'Save school' : 'Add school'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function SchoolsPage() {
  const { access } = useMeData();
  const schools = useSchools();
  const [editing, setEditing] = useState<School | null>(null);
  const [open, setOpen] = useState(false);
  const canCreate = access.can('schools', 'create') && !access.readOnly;
  const canEdit = access.can('schools', 'edit') && !access.readOnly;
  const items = schools.data?.items ?? [];
  const show = (f: string) => access.fieldAccess('schools', f) !== 'hidden';

  return (
    <>
      <div className="pagehead">
        <h1>Schools</h1>
        {canCreate && (
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            Add school
          </Button>
        )}
      </div>
      <p className="muted lead">
        {items.length} {items.length === 1 ? 'school' : 'schools'}. Franchise owners manage their
        own school’s people.
      </p>
      <ErrorAlert error={schools.error} />
      <section className="panel">
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing="sm" highlightOnHover={canEdit}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>School</Table.Th>
                {show('city') && <Table.Th>City</Table.Th>}
                {show('type') && <Table.Th>Type</Table.Th>}
                {show('franchiseOwner') && <Table.Th>Franchise owner</Table.Th>}
                {show('principal') && <Table.Th>Principal</Table.Th>}
                <Table.Th>People</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((s) => (
                <Table.Tr key={s.id}>
                  <Table.Td>
                    {canEdit ? (
                      <button
                        type="button"
                        className="lnk"
                        onClick={() => {
                          setEditing(s);
                          setOpen(true);
                        }}
                      >
                        {s.name}
                      </button>
                    ) : (
                      <b>{s.name}</b>
                    )}
                  </Table.Td>
                  {show('city') && <Table.Td>{s.city}</Table.Td>}
                  {show('type') && (
                    <Table.Td>
                      <span className={s.type === 'coco' ? 'chip-coco' : 'chip-franchise'}>
                        {s.type === 'coco' ? 'COCO' : 'Franchise'}
                      </span>
                    </Table.Td>
                  )}
                  {show('franchiseOwner') && (
                    <Table.Td>
                      {s.franchiseOwnerName ?? (
                        <span className="muted">
                          {s.type === 'coco' ? 'Not needed' : 'Not set'}
                        </span>
                      )}
                    </Table.Td>
                  )}
                  {show('principal') && (
                    <Table.Td>{s.principalName ?? <span className="muted">Not set</span>}</Table.Td>
                  )}
                  <Table.Td>{s.peopleCount}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {items.length === 0 && !schools.isLoading && <p className="empty">No schools yet.</p>}
      </section>
      <SchoolModal
        key={`${String(open)}-${editing?.id ?? 'new'}`}
        opened={open}
        onClose={() => {
          setOpen(false);
        }}
        school={editing}
      />
    </>
  );
}
