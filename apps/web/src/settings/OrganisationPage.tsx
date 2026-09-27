import {
  Alert,
  Button,
  Chip,
  FileButton,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  createHolidaySchema,
  holidayImpactSchema,
  holidaySchema,
  jobStatusSchema,
  organisationSchema,
} from '@kidzonia/shared';
import type { Holiday, Organisation } from '@kidzonia/shared';
import { IconPlus, IconTrash, IconUpload } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { api, fetchImage, upload } from '../api/client';
import { ME_QUERY_KEY } from '../auth/use-me';
import { useMeData } from '../shell/AppLayout';
import { ErrorAlert, fieldError } from '../ui/errors';
import { notify } from '../ui/notify';
import { holidayPage, keys, useOrganisation, useSchools } from './queries';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ZONES = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Asia/Kolkata'];
  }
})();

const prettyDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

function OrganisationForm({ org, canEdit }: { org: Organisation; canEdit: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(org);
  // The logo needs the access token, so it's fetched and shown as an object URL.
  const logoQuery = useQuery({
    queryKey: ['logo', org.logoUrl],
    queryFn: () => (org.logoUrl ? fetchImage(org.logoUrl) : Promise.resolve(null)),
    enabled: org.logoUrl !== null,
    staleTime: Infinity,
  });
  const logo = org.logoUrl ? (logoQuery.data ?? null) : null;

  const save = useMutation({
    mutationFn: () =>
      api('/organisation', organisationSchema, {
        method: 'PUT',
        body: {
          name: draft.name,
          timezone: draft.timezone,
          workingDays: draft.workingDays,
          opensAt: draft.opensAt,
          closesAt: draft.closesAt,
          logoutBlockLeadMinutes: draft.logoutBlockLeadMinutes,
        },
      }),
    onSuccess: (o) => {
      qc.setQueryData(keys.organisation, o);
      void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
      notify('Organisation saved');
    },
  });
  const uploadLogo = useMutation({
    mutationFn: (file: File) => upload('/organisation/logo', file, organisationSchema),
    onSuccess: (o) => {
      qc.setQueryData(keys.organisation, o);
      notify('Logo updated');
    },
  });
  const removeLogo = useMutation({
    mutationFn: () => api('/organisation/logo', z.undefined(), { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.organisation });
      notify('Logo removed');
    },
  });

  return (
    <section className="panel" aria-labelledby="org-h">
      <div className="panel-h">
        <h2 id="org-h">Organisation</h2>
      </div>
      <div className="panel-b">
        <ErrorAlert error={save.error ?? uploadLogo.error ?? removeLogo.error} />
        <Stack gap="md">
          <Group gap="md" align="center">
            <div className="logo-box" aria-hidden={!logo}>
              {logo ? (
                <img src={logo} alt={`${org.name} logo`} />
              ) : (
                <span>{org.name.slice(0, 1)}</span>
              )}
            </div>
            {canEdit && (
              <Group gap="xs">
                <FileButton
                  onChange={(f) => {
                    if (f) uploadLogo.mutate(f);
                  }}
                  accept="image/png,image/jpeg,image/webp"
                >
                  {(p) => (
                    <Button
                      {...p}
                      variant="default"
                      size="sm"
                      leftSection={<IconUpload size={16} />}
                      loading={uploadLogo.isPending}
                    >
                      Upload logo
                    </Button>
                  )}
                </FileButton>
                {org.logoUrl && (
                  <Button
                    variant="subtle"
                    color="red"
                    size="sm"
                    onClick={() => {
                      removeLogo.mutate();
                    }}
                  >
                    Remove
                  </Button>
                )}
              </Group>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            PNG, JPEG or WebP, up to 2 MB.
          </Text>
          <TextInput
            label="Name"
            value={draft.name}
            onChange={(e) => {
              setDraft({ ...draft, name: e.currentTarget.value });
            }}
            disabled={!canEdit}
            error={fieldError(save.error, 'name')}
          />
          <div className="two">
            <div>
              <Text size="sm" fw={600}>
                Set up as
              </Text>
              <Text>{org.setupType === 'head_office' ? 'Head office' : 'Single school'}</Text>
            </div>
            <div>
              <Text size="sm" fw={600}>
                Runs
              </Text>
              <Text>
                {
                  { coco: 'COCO', franchise: 'Franchise', both: 'COCO and franchise' }[
                    org.schoolModel
                  ]
                }{' '}
                schools
              </Text>
            </div>
          </div>
          <Select
            label="Time zone"
            data={ZONES}
            searchable
            value={draft.timezone}
            onChange={(v) => {
              if (v) setDraft({ ...draft, timezone: v });
            }}
            disabled={!canEdit}
            error={fieldError(save.error, 'timezone')}
          />
          <div>
            <Text size="sm" fw={600} mb={6} id="days-l">
              Working days
            </Text>
            <Chip.Group
              multiple
              value={draft.workingDays.map(String)}
              onChange={(v) => {
                setDraft({ ...draft, workingDays: v.map(Number).sort((a, b) => a - b) });
              }}
            >
              <Group gap="xs" role="group" aria-labelledby="days-l">
                {DAYS.map((d, i) => (
                  <Chip key={d} value={String(i)} disabled={!canEdit}>
                    {d}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
            {fieldError(save.error, 'workingDays') && (
              <Text c="red" size="sm">
                {fieldError(save.error, 'workingDays')}
              </Text>
            )}
          </div>
          <div className="two">
            <TextInput
              type="time"
              label="School opens"
              value={draft.opensAt}
              onChange={(e) => {
                setDraft({ ...draft, opensAt: e.currentTarget.value });
              }}
              disabled={!canEdit}
              error={fieldError(save.error, 'opensAt')}
            />
            <TextInput
              type="time"
              label="School closes"
              value={draft.closesAt}
              onChange={(e) => {
                setDraft({ ...draft, closesAt: e.currentTarget.value });
              }}
              disabled={!canEdit}
              error={fieldError(save.error, 'closesAt')}
            />
          </div>
          <Text size="sm" c="dimmed">
            “End of day” tasks are due when school closes. Schools can have their own hours.
          </Text>
          <NumberInput
            label="Logout block starts"
            description="Minutes before a “must submit before logging out” task is due. 0 blocks only once it’s due."
            suffix=" minutes"
            min={0}
            max={720}
            step={15}
            w={260}
            value={draft.logoutBlockLeadMinutes}
            onChange={(v) => {
              setDraft({ ...draft, logoutBlockLeadMinutes: typeof v === 'number' ? v : 0 });
            }}
            disabled={!canEdit}
            error={fieldError(save.error, 'logoutBlockLeadMinutes')}
          />
          <ScheduleStatus />
          {canEdit && (
            <Group>
              <Button
                onClick={() => {
                  save.mutate();
                }}
                loading={save.isPending}
              >
                Save changes
              </Button>
            </Group>
          )}
        </Stack>
      </div>
    </section>
  );
}

/** Owners only: when the task schedule last ran (Phase 4). */
function ScheduleStatus() {
  const { me } = useMeData();
  const status = useQuery({
    queryKey: ['organisation', 'schedule'],
    queryFn: () => api('/organisation/schedule', jobStatusSchema),
    enabled: me.role?.isOwner === true,
    refetchInterval: 60_000,
  });
  if (me.role?.isOwner !== true || !status.data) return null;
  const last = status.data.lastSuccessAt;
  const when = last
    ? new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: me.organisation.timezone,
      }).format(new Date(last))
    : null;
  const stale = status.data.stale;
  return (
    <Text size="sm" c={stale ? 'red' : 'dimmed'} role="status">
      {when
        ? `The task schedule last ran at ${when}. It runs every 15 minutes.`
        : 'The task schedule hasn’t run yet.'}
      {stale && last ? ' It is overdue; check the server logs.' : ''}
    </Text>
  );
}

function HolidayModal({
  opened,
  onClose,
  holiday,
}: {
  opened: boolean;
  onClose: () => void;
  holiday: Holiday | null;
}) {
  const qc = useQueryClient();
  const schools = useSchools(opened);
  const [name, setName] = useState(holiday?.name ?? '');
  const [start, setStart] = useState(holiday?.startDate ?? '');
  const [end, setEnd] = useState(
    holiday && holiday.endDate !== holiday.startDate ? holiday.endDate : '',
  );
  const [which, setWhich] = useState<'all' | 'some'>(
    holiday && holiday.schoolIds.length > 0 ? 'some' : 'all',
  );
  const [schoolIds, setSchoolIds] = useState<string[]>(holiday?.schoolIds ?? []);
  const [localError, setLocalError] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        startDate: start,
        endDate: end || null,
        schoolIds: which === 'all' ? [] : schoolIds,
      };
      // The same schema the server uses, so mistakes show before sending.
      const check = createHolidaySchema.safeParse(body);
      if (!check.success) {
        setLocalError(
          Object.fromEntries(check.error.issues.map((i) => [String(i.path[0]), i.message])),
        );
        return Promise.reject(new Error('invalid'));
      }
      return holiday
        ? api(`/holidays/${holiday.id}`, holidaySchema, { method: 'PUT', body })
        : api('/holidays', holidaySchema, { method: 'POST', body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.holidays });
      notify(holiday ? 'Holiday saved' : 'Holiday added');
      onClose();
    },
  });
  const err = save.error instanceof Error && save.error.message === 'invalid' ? null : save.error;
  // Phase 4 answer 1: one-time tasks keep their date, so say how many fall on it.
  const impact = useQuery({
    queryKey: ['holidays', 'impact', start, end, which, schoolIds.join(',')],
    queryFn: () =>
      api('/holidays/impact', holidayImpactSchema, {
        method: 'POST',
        body: {
          startDate: start,
          endDate: end || null,
          schoolIds: which === 'all' ? [] : schoolIds,
        },
      }),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(start) && !holiday,
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={holiday ? 'Edit holiday' : 'Add holiday'}
      centered
      radius="lg"
    >
      <ErrorAlert error={err} />
      <Stack>
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value);
          }}
          error={localError.name ?? fieldError(err, 'name')}
          data-autofocus
        />
        <div className="two">
          <TextInput
            type="date"
            label="First day"
            value={start}
            onChange={(e) => {
              setStart(e.currentTarget.value);
            }}
            error={localError.startDate ?? fieldError(err, 'startDate')}
          />
          <TextInput
            type="date"
            label="Last day"
            description="Leave empty for one day"
            value={end}
            onChange={(e) => {
              setEnd(e.currentTarget.value);
            }}
            error={localError.endDate ?? fieldError(err, 'endDate')}
          />
        </div>
        <div>
          <Text size="sm" fw={600} mb={6}>
            Applies to
          </Text>
          <SegmentedControl
            value={which}
            onChange={(v) => {
              setWhich(v);
            }}
            data={[
              { value: 'all', label: 'All schools' },
              { value: 'some', label: 'Chosen schools' },
            ]}
          />
        </div>
        {(impact.data?.oneTimeTasks ?? 0) > 0 && (
          <Alert color="yellow" variant="light" role="status">
            {impact.data?.oneTimeTasks} one-time{' '}
            {impact.data?.oneTimeTasks === 1 ? 'task falls' : 'tasks fall'} on this date (
            {impact.data?.titles.join(', ')}). They stay on this date; open them to move or cancel
            them. Repeating tasks skip the holiday on their own.
          </Alert>
        )}
        {which === 'some' && (
          <Chip.Group multiple value={schoolIds} onChange={setSchoolIds}>
            <Group gap="xs">
              {(schools.data?.items ?? []).map((s) => (
                <Chip key={s.id} value={s.id}>
                  {s.name ?? 'School'}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
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
            {holiday ? 'Save holiday' : 'Add holiday'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function Holidays({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const year = new Date().getFullYear();
  const holidays = useQuery({
    queryKey: [...keys.holidays, year],
    queryFn: () => api(`/holidays?limit=200&year=${year}`, holidayPage),
  });
  const schools = useSchools();
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/holidays/${id}`, z.undefined(), { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.holidays });
      notify('Holiday removed');
    },
  });
  const schoolName = useMemo(
    () => new Map((schools.data?.items ?? []).map((s) => [s.id, s.name])),
    [schools.data],
  );

  return (
    <section className="panel" aria-labelledby="hol-h">
      <div className="panel-h">
        <h2 id="hol-h">Holidays</h2>
        {canEdit && (
          <Button
            size="xs"
            variant="default"
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            Add holiday
          </Button>
        )}
      </div>
      <ErrorAlert error={remove.error} />
      {(holidays.data?.items ?? []).map((h) => (
        <div key={h.id} className="role-row">
          <div className="t">
            <b>{h.name}</b>
            <span>
              {h.startDate === h.endDate
                ? prettyDate(h.startDate)
                : `${prettyDate(h.startDate)} to ${prettyDate(h.endDate)}`}
              ,{' '}
              {h.schoolIds.length === 0
                ? 'all schools'
                : h.schoolIds.map((id) => schoolName.get(id) ?? 'a school').join(', ')}
            </span>
          </div>
          {canEdit && (
            <Group gap={4}>
              <Button
                size="xs"
                variant="default"
                onClick={() => {
                  setEditing(h);
                  setOpen(true);
                }}
              >
                Edit
              </Button>
              <Button
                size="xs"
                variant="subtle"
                color="red"
                aria-label={`Remove ${h.name}`}
                onClick={() => {
                  remove.mutate(h.id);
                }}
              >
                <IconTrash size={16} />
              </Button>
            </Group>
          )}
        </div>
      ))}
      {holidays.data?.items.length === 0 && <p className="empty">No holidays yet this year.</p>}
      <p className="small muted pad">No tasks are created on holidays.</p>
      <HolidayModal
        key={`${String(open)}-${editing?.id ?? 'new'}`}
        opened={open}
        onClose={() => {
          setOpen(false);
        }}
        holiday={editing}
      />
    </section>
  );
}

export function OrganisationPage() {
  const { access } = useMeData();
  const org = useOrganisation();
  const canEdit = access.can('organisation', 'edit') && !access.readOnly;
  return (
    <>
      <div className="pagehead">
        <h1>Organisation</h1>
      </div>
      <ErrorAlert error={org.error} />
      <div className="grid2">
        {org.data && (
          // Refilled from the server after each save.
          <OrganisationForm key={org.dataUpdatedAt} org={org.data} canEdit={canEdit} />
        )}
        <Holidays canEdit={canEdit} />
      </div>
    </>
  );
}
