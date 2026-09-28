import { Button, Group, Menu, Modal, Select, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  CONSENT_LABEL,
  CONSENTS,
  CSV_HEADER,
  contactRowSchema,
  importPreviewSchema,
  importResultSchema,
  schoolClassListSchema,
  schoolClassSchema,
} from '@kidzonia/shared';
import type { Consent, ContactRow, ImportPreview } from '@kidzonia/shared';
import { IconDots, IconPlus, IconSearch, IconUpload } from '@tabler/icons-react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { api, ApiError, upload } from '../api/client';
import { useMeData } from '../shell/AppLayout';
import { NarrowedChip } from '../shell/SchoolSwitcher';
import { ErrorAlert, errorMessage } from '../ui/errors';
import { notify } from '../ui/notify';

const MODULE = 'parent_contacts';
const keys = {
  schools: ['parent-contacts', 'schools'] as const,
  classes: (schoolId: string) => ['parent-contacts', 'classes', schoolId] as const,
  list: (schoolId: string) => ['parent-contacts', 'list', schoolId] as const,
};
const contactPage = z.object({
  items: z.array(contactRowSchema),
  nextOffset: z.number().nullable(),
});
const schoolList = z.object({ items: z.array(z.object({ id: z.string(), name: z.string() })) });

/** A downloadable empty sheet with the right columns. */
function templateHref(): string {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(`${CSV_HEADER}\nNursery A,Aarav Kumar,Neha Kumar,98480 11111,yes\n`)}`;
}

/**
 * Parent contacts (Phase 6, open decision 13.1): classes per school, and the
 * children and parents in them, filled from a CSV. Only parents marked as
 * agreed are messaged; opting a parent out sticks until someone re-marks them.
 * Deleting a parent removes their number completely.
 */
export function ParentContactsPage() {
  const { access } = useMeData();
  const qc = useQueryClient();
  const schools = useQuery({
    queryKey: keys.schools,
    queryFn: () => api('/parent-contacts/schools', schoolList),
  });
  const [picked, setPicked] = useState<string | null>(null);
  const schoolId = picked ?? schools.data?.items[0]?.id ?? null;
  const [classId, setClassId] = useState<string | null>(null);
  const [consent, setConsent] = useState<Consent | null>(null);
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search.trim(), 300);
  const [uploading, setUploading] = useState(false);
  const [newClass, setNewClass] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ContactRow | null>(null);
  const writable = !access.readOnly;
  const can = (a: string) => access.can(MODULE, a) && writable;

  const classes = useQuery({
    queryKey: keys.classes(schoolId ?? ''),
    queryFn: () =>
      api(`/parent-contacts/classes?schoolId=${schoolId ?? ''}`, schoolClassListSchema),
    enabled: schoolId !== null,
  });
  const params = new URLSearchParams({ schoolId: schoolId ?? '', limit: '50' });
  if (classId) params.set('classId', classId);
  if (consent) params.set('consent', consent);
  if (q) params.set('q', q);
  const list = useInfiniteQuery({
    queryKey: [...keys.list(schoolId ?? ''), params.toString()],
    queryFn: ({ pageParam }) =>
      api(`/parent-contacts?${params.toString()}&offset=${String(pageParam)}`, contactPage),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: schoolId !== null,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['parent-contacts'] });
  };

  const setConsentFor = useMutation({
    mutationFn: (v: { guardianId: string; consent: Consent }) =>
      api(`/parent-contacts/guardians/${v.guardianId}/consent`, z.undefined(), {
        method: 'PUT',
        body: { consent: v.consent },
      }),
    onSuccess: (_d, v) => {
      notify(v.consent === 'opted_out' ? 'Opted out. They won’t be messaged.' : 'Saved');
      refresh();
    },
    onError: (err) => {
      notify(errorMessage(err));
    },
  });
  const remove = useMutation({
    mutationFn: (guardianId: string) =>
      api(`/parent-contacts/guardians/${guardianId}`, z.undefined(), { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(null);
      notify('Parent deleted, with their number');
      refresh();
    },
  });
  const addClass = useMutation({
    mutationFn: (name: string) =>
      api(
        '/parent-contacts/classes',
        schoolClassSchema.omit({ students: true, agreedParents: true }),
        {
          method: 'POST',
          body: { schoolId, name },
        },
      ),
    onSuccess: () => {
      setNewClass(null);
      refresh();
    },
  });

  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <NarrowedChip />
      <div className="pagehead">
        <h1>Parent contacts</h1>
        {can('create') && can('edit') && schoolId && (
          <Button
            leftSection={<IconUpload size={16} />}
            onClick={() => {
              setUploading(true);
            }}
          >
            Upload a CSV
          </Button>
        )}
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>
        Only parents marked as agreed are sent messages. Numbers are shown only here.
      </p>
      <ErrorAlert error={schools.error ?? classes.error ?? list.error} />

      <section className="panel filters">
        <Group align="flex-end" gap="sm" wrap="wrap">
          <Select
            label="School"
            data={(schools.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }))}
            value={schoolId}
            onChange={(v) => {
              setPicked(v);
              setClassId(null);
            }}
            allowDeselect={false}
            w={200}
          />
          <Select
            label="Class"
            data={[
              { value: '', label: 'All classes' },
              ...(classes.data?.items ?? []).map((c) => ({ value: c.id, label: c.name })),
            ]}
            value={classId ?? ''}
            onChange={(v) => {
              setClassId(v || null);
            }}
            allowDeselect={false}
            w={180}
          />
          <Select
            label="Agreed to messages"
            data={[
              { value: '', label: 'Anyone' },
              ...CONSENTS.map((c) => ({ value: c, label: CONSENT_LABEL[c] })),
            ]}
            value={consent ?? ''}
            onChange={(v) => {
              setConsent((v as Consent | '') || null);
            }}
            allowDeselect={false}
            w={170}
          />
          <TextInput
            label="Search"
            leftSection={<IconSearch size={16} />}
            placeholder="Child, parent or number"
            value={search}
            onChange={(e) => {
              setSearch(e.currentTarget.value);
            }}
            w={220}
          />
        </Group>
      </section>

      <div className="grid2">
        <section className="panel" aria-labelledby="h-contacts">
          <div className="panel-h">
            <h2 id="h-contacts">Children and parents</h2>
          </div>
          <div className="tbl-wrap">
            <table className="plain">
              <thead>
                <tr>
                  <th scope="col">Child</th>
                  <th scope="col">Class</th>
                  <th scope="col">Parent</th>
                  <th scope="col">Mobile</th>
                  <th scope="col">Messages</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.studentName ?? '—'}</td>
                    <td>{r.className}</td>
                    <td>{r.parentName ?? '—'}</td>
                    <td>{r.parentMobile ?? <span className="muted">Hidden</span>}</td>
                    <td>
                      {r.consent && (
                        <span className={`chip consent-${r.consent}`}>
                          {CONSENT_LABEL[r.consent]}
                        </span>
                      )}
                    </td>
                    <td>
                      {(can('edit') || can('delete')) && (
                        <Menu position="bottom-end">
                          <Menu.Target>
                            <Button
                              size="compact-sm"
                              variant="subtle"
                              aria-label={`Change ${r.parentName ?? 'this parent'}`}
                            >
                              <IconDots size={16} />
                            </Button>
                          </Menu.Target>
                          <Menu.Dropdown>
                            {can('edit') &&
                              CONSENTS.filter((c) => c !== r.consent).map((c) => (
                                <Menu.Item
                                  key={c}
                                  onClick={() => {
                                    setConsentFor.mutate({ guardianId: r.guardianId, consent: c });
                                  }}
                                >
                                  {c === 'agreed'
                                    ? 'Mark as agreed'
                                    : c === 'opted_out'
                                      ? 'Opt out of messages'
                                      : 'Mark as not agreed'}
                                </Menu.Item>
                              ))}
                            {can('delete') && (
                              <Menu.Item
                                color="red"
                                onClick={() => {
                                  setDeleting(r);
                                }}
                              >
                                Delete parent and number
                              </Menu.Item>
                            )}
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && !list.isLoading && (
                  <tr>
                    <td colSpan={6} className="empty">
                      No children or parents here yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {list.hasNextPage && (
            <Group justify="center" p="md">
              <Button variant="default" onClick={() => void list.fetchNextPage()}>
                Show more
              </Button>
            </Group>
          )}
        </section>

        <section className="panel" aria-labelledby="h-classes">
          <div className="panel-h">
            <h2 id="h-classes">Classes</h2>
            {can('create') && (
              <Button
                size="compact-sm"
                variant="subtle"
                leftSection={<IconPlus size={14} />}
                onClick={() => {
                  setNewClass('');
                }}
              >
                Add class
              </Button>
            )}
          </div>
          <div className="tlist">
            {(classes.data?.items ?? []).map((c) => (
              <div key={c.id} className="check">
                <span className="grow">{c.name}</span>
                <span className="small muted">
                  {c.students} {c.students === 1 ? 'child' : 'children'}, {c.agreedParents} agreed
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <Modal
        opened={newClass !== null}
        onClose={() => {
          setNewClass(null);
        }}
        title="Add a class"
        centered
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addClass.mutate(newClass ?? '');
          }}
        >
          <Stack>
            <TextInput
              label="Class name"
              data-autofocus
              value={newClass ?? ''}
              onChange={(e) => {
                setNewClass(e.currentTarget.value);
              }}
              error={addClass.error ? errorMessage(addClass.error) : undefined}
            />
            <Group justify="flex-end">
              <Button type="submit" loading={addClass.isPending}>
                Add class
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={deleting !== null}
        onClose={() => {
          setDeleting(null);
        }}
        title="Delete this parent?"
        centered
      >
        <Stack>
          <Text>
            {deleting?.parentName ?? 'This parent'} and their number will be removed completely. A
            child with no other parent listed is removed too. This can’t be undone.
          </Text>
          <ErrorAlert error={remove.error} />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setDeleting(null);
              }}
            >
              Keep
            </Button>
            <Button
              color="red"
              loading={remove.isPending}
              onClick={() => {
                if (deleting) remove.mutate(deleting.guardianId);
              }}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>

      {uploading && schoolId && (
        <UploadCsv
          schoolId={schoolId}
          schoolName={schools.data?.items.find((s) => s.id === schoolId)?.name ?? ''}
          onClose={() => {
            setUploading(false);
          }}
          onDone={() => {
            setUploading(false);
            refresh();
          }}
        />
      )}
    </>
  );
}

const ACTION_LABEL: Record<string, string> = {
  new: 'New',
  update: 'Updates',
  unchanged: 'No change',
  keeps_opt_out: 'Stays opted out',
};

/** Upload: pick a file, see every row checked, then import the good ones (answer 1). */
function UploadCsv({
  schoolId,
  schoolName,
  onClose,
  onDone,
}: {
  schoolId: string;
  schoolName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const check = useMutation({
    mutationFn: (f: File) =>
      upload(
        `/parent-contacts/import/preview?schoolId=${schoolId}`,
        new Blob([f], { type: 'text/csv' }),
        importPreviewSchema,
      ),
    onSuccess: setPreview,
  });
  const run = useMutation({
    mutationFn: (f: File) =>
      upload(
        `/parent-contacts/import?schoolId=${schoolId}`,
        new Blob([f], { type: 'text/csv' }),
        importResultSchema,
      ),
    onSuccess: (r) => {
      notify(
        `Imported ${String(r.imported)} rows${r.skipped ? `, skipped ${String(r.skipped)}` : ''}`,
      );
      onDone();
    },
  });
  const valid = preview?.summary.valid ?? 0;
  return (
    <Modal opened onClose={onClose} title={`Upload contacts for ${schoolName}`} size="xl" centered>
      <Stack>
        <Text size="sm">
          One row per child and parent, with the columns: {CSV_HEADER}.{' '}
          <a href={templateHref()} download="parent-contacts.csv">
            Download a blank sheet
          </a>
          . Nothing is saved until you press Import.
        </Text>
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV file"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0] ?? null;
            setFile(f);
            setPreview(null);
            if (f) check.mutate(f);
          }}
        />
        <ErrorAlert
          error={check.error instanceof ApiError ? check.error : (check.error ?? run.error)}
        />
        {preview && preview.problems.length > 0 && (
          <div className="banner" role="alert">
            {preview.problems.join(' ')}
          </div>
        )}
        {preview && preview.rows.length > 0 && (
          <>
            <Text size="sm" role="status">
              {preview.summary.rows} rows: {preview.summary.new} new, {preview.summary.updated}{' '}
              changing, {preview.summary.unchanged} unchanged, {preview.summary.withErrors} with
              problems (these are skipped).
            </Text>
            <div className="tbl-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
              <table className="plain">
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Class</th>
                    <th scope="col">Child</th>
                    <th scope="col">Parent</th>
                    <th scope="col">Mobile</th>
                    <th scope="col">Agreed</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line} className={r.errors.length ? 'row-error' : undefined}>
                      <td>{r.line}</td>
                      <td>{r.className}</td>
                      <td>{r.studentName}</td>
                      <td>{r.parentName}</td>
                      <td>{r.parentMobile ?? '—'}</td>
                      <td>{r.agreed ? 'Yes' : 'No'}</td>
                      <td>
                        {r.errors.length > 0 ? (
                          <span className="error-text">{r.errors.join(' ')}</span>
                        ) : (
                          <>
                            <b>{ACTION_LABEL[r.action ?? ''] ?? ''}</b>
                            {r.notes.length > 0 && (
                              <span className="small muted"> {r.notes.join(' ')}</span>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!file || valid === 0 || (preview?.problems.length ?? 0) > 0}
            loading={run.isPending || check.isPending}
            onClick={() => {
              if (file) run.mutate(file);
            }}
          >
            {valid > 0 ? `Import ${String(valid)} ${valid === 1 ? 'row' : 'rows'}` : 'Import'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
