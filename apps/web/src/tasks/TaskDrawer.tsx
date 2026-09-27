import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Group,
  Loader,
  Modal,
  Progress,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { isOpen, listFieldKey, messageParts, REPEAT_LABEL } from '@kidzonia/shared';
import type { Attachment, CopyDetail, ListChoice, TaskDetail } from '@kidzonia/shared';
import {
  IconCalendarShare,
  IconCamera,
  IconFile,
  IconMessage,
  IconPaperclip,
  IconRefresh,
  IconX,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { z } from 'zod';
import { api, ApiError, fetchImage, uploadWithProgress } from '../api/client';
import { useMeData } from '../shell/AppLayout';
import { ErrorAlert, errorMessage, fieldError } from '../ui/errors';
import { Questions } from './Questions';
import { notify } from '../ui/notify';
import { copyDetailSchema, taskDetailSchema, taskKeys, useTaskSetup } from './api';
import {
  CategoryTag,
  copyDue,
  LockChip,
  PersonCell,
  PriorityTag,
  StatusChip,
  taskDue,
  todayIn,
} from './bits';
import { shrinkPhoto, uploadName } from './upload';

const FILE_TYPES = 'image/jpeg,image/png,image/webp,image/heic,.pdf,.docx,.xlsx';
/** A repeated submit that already went through answers 409 with one of these. */
const ALREADY_IN = ['submitted', 'done', 'approved'];

interface Props {
  taskId: string;
  copyId: string | null;
  onClose: () => void;
  onEdit: () => void;
}

export function TaskDrawer({ taskId, copyId, onClose, onEdit }: Props) {
  const phone = useMediaQuery('(max-width: 640px)');
  const detail = useQuery({
    queryKey: taskKeys.detail(taskId, copyId),
    queryFn: () => api(`/tasks/${taskId}${copyId ? `?copy=${copyId}` : ''}`, taskDetailSchema),
  });
  const t = detail.data;
  return (
    <Drawer
      opened
      onClose={onClose}
      position="right"
      size={phone ? '100%' : 600}
      padding={0}
      title={t?.title ?? 'Task'}
      classNames={{ header: 'drawer-h', title: 'drawer-title', body: 'drawer-body' }}
    >
      <ErrorAlert error={detail.error} />
      {!t && !detail.error && (
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      )}
      {t && <TaskBody t={t} onEdit={onEdit} onClose={onClose} />}
    </Drawer>
  );
}

/** Category, priority and badges above the details (the title is the drawer's heading). */
function Tags({ t }: { t: TaskDetail }) {
  return (
    <div className="tags">
      {t.category !== undefined && <CategoryTag category={t.category} />}
      {t.priority !== undefined && <PriorityTag priority={t.priority} />}
      {t.blocksLogout && <LockChip />}
      {t.cancelledAt && <span className="chip st-cancelled">Cancelled</span>}
    </div>
  );
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: taskKeys.all });
}

function TaskBody({
  t,
  onEdit,
  onClose,
}: {
  t: TaskDetail;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { me } = useMeData();
  const setup = useTaskSetup();
  const tz = me.organisation.timezone;
  const copy = t.myCopy;
  const mine = copy?.person.id === me.user.id;
  const due = copy ? copyDue(copy, tz) : taskDue(t, tz);
  const lists = (setup.data?.lists ?? [])
    .map((l) => ({ name: l.name, choice: t[listFieldKey(l.id)] as ListChoice | undefined }))
    .filter((l) => l.choice);
  const [cancelling, setCancelling] = useState(false);
  const invalidate = useInvalidate();
  const cancelTask = useMutation({
    mutationFn: () => api(`/tasks/${t.id}`, undefinedSchema, { method: 'DELETE' }),
    onSuccess: () => {
      notify('The task was cancelled.');
      void invalidate();
      onClose();
    },
  });

  return (
    <>
      <div className="drawer-scroll">
        <Tags t={t} />
        <dl className="kv">
          {due && (
            <>
              <dt>Due</dt>
              <dd>{due}</dd>
            </>
          )}
          <dt>Repeats</dt>
          <dd>{t.repeat === 'none' ? 'One time' : REPEAT_LABEL[t.repeat]}</dd>
          <dt>Assigned by</dt>
          <dd>{t.creator.fullName}</dd>
          <dt>Approval</dt>
          <dd>
            {!t.needsApproval
              ? 'No approval needed'
              : t.approverMode === 'reporting_manager'
                ? 'Needs approval from each person’s manager'
                : `Needs approval from ${t.approver?.fullName ?? t.creator.fullName}`}
          </dd>
          {t.can.seePeople && (
            <>
              <dt>For</dt>
              <dd>{t.targetSummary}</dd>
            </>
          )}
          {lists.map((l) => (
            <FragmentKV key={l.name} label={l.name} value={l.choice?.value ?? ''} />
          ))}
        </dl>
        {t.description && <p className="desc">{t.description}</p>}

        {copy && <Work copy={copy} mine={mine} />}
        {t.can.seePeople && t.people.length > 0 && (t.people.length > 1 || !mine) && (
          <People t={t} />
        )}
        {t.watchers && t.watchers.length > 0 && (
          <section className="sec">
            <h3>Watchers</h3>
            {t.watchers.map((w) => (
              <div className="check" key={w.person.id}>
                <PersonCell person={w.person} />
                <span className="grow" />
                <span className="chip">{w.access === 'edit' ? 'Can edit' : 'Can view'}</span>
              </div>
            ))}
          </section>
        )}
        {t.parentMessage && (
          <section className="sec">
            <h3>Message to parents</h3>
            <p className="small muted">
              Sent to parents of {t.parentMessage.className} when this task is{' '}
              {t.needsApproval ? 'approved' : 'done'}. Sending starts in a later update.
            </p>
            <div className="tpl">
              <b>{t.parentMessage.templateName}</b>
              <MessagePreview body={t.parentMessage.body} />
            </div>
          </section>
        )}
        {t.subtasks.some((s) => s.assignee) && !copy && (
          <section className="sec">
            <h3>Sub-tasks</h3>
            {t.subtasks.map((s) => (
              <div className="check" key={s.id}>
                <span className="grow">{s.title}</span>
                {s.assignee && <span className="small muted">{s.assignee.fullName}</span>}
              </div>
            ))}
          </section>
        )}
        <ErrorAlert error={cancelTask.error} />
      </div>
      {(t.can.edit || t.can.cancel) && (
        <div className="drawer-f">
          {t.can.cancel && (
            <Button
              variant="subtle"
              color="red"
              mr="auto"
              onClick={() => {
                setCancelling(true);
              }}
            >
              Cancel task
            </Button>
          )}
          {t.can.edit && (
            <Button variant="default" onClick={onEdit}>
              Edit task
            </Button>
          )}
        </div>
      )}
      {copy && mine && <SubmitBar copy={copy} />}
      <Modal
        opened={cancelling}
        onClose={() => {
          setCancelling(false);
        }}
        title="Cancel this task?"
        centered
      >
        <Stack>
          <Text>Everyone’s copy that isn’t finished will be cancelled. This can’t be undone.</Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setCancelling(false);
              }}
            >
              Keep it
            </Button>
            <Button
              color="red"
              loading={cancelTask.isPending}
              onClick={() => {
                cancelTask.mutate();
              }}
            >
              Cancel task
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

const undefinedSchema = z.undefined();

function FragmentKV({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

export function MessagePreview({ body }: { body: string }) {
  return (
    <p>
      {messageParts(body).map((p, i) =>
        p.word ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>,
      )}
    </p>
  );
}

/** Ticks, files and the decision for one copy (yours, or the one you're reviewing). */
function Work({ copy, mine }: { copy: CopyDetail; mine: boolean }) {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  // Ticks show at once and are saved in the background (weak networks, addition b);
  // a failed save puts the box back and says so.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const tick = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      api(`/assignments/${copy.id}/subtasks/${id}`, copyDetailSchema, {
        method: 'PUT',
        body: { done },
      }),
    onSuccess: () => void invalidate(),
    onError: (_err, v) => {
      setTicked((x) => {
        const { [v.id]: _drop, ...rest } = x;
        return rest;
      });
    },
  });
  const [remarks, setRemarks] = useState('');
  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      api(`/assignments/${copy.id}/${approve ? 'approve' : 'send-back'}`, copyDetailSchema, {
        method: 'POST',
        body: { remarks: remarks.trim() || null },
      }),
    onSuccess: (c) => {
      notify(c.status === 'approved' ? 'Approved.' : 'Sent back with your remarks.');
      void qc.invalidateQueries({ queryKey: taskKeys.all });
    },
  });

  return (
    <section className="sec work">
      <Group justify="space-between">
        <h3>{mine ? 'Your work' : `${copy.person.fullName}’s work`}</h3>
        <StatusChip status={copy.status} />
      </Group>
      {copy.status === 'sent_back' && copy.remarks && (
        <div className="banner" role="status">
          <IconMessage size={18} aria-hidden="true" />
          <span>
            <b>Sent back:</b> {copy.remarks}
          </span>
        </div>
      )}
      {copy.status === 'cancelled' && copy.cancelReason && (
        <Alert color="gray" variant="light" mt="sm">
          Cancelled: {copy.cancelReason}
        </Alert>
      )}
      <ErrorAlert error={tick.error} />
      {copy.subtasks.length > 0 && (
        <div className="checks">
          {copy.subtasks.map((s) => (
            <label key={s.id} className={(ticked[s.id] ?? s.done) ? 'check done' : 'check'}>
              <Checkbox
                checked={ticked[s.id] ?? s.done}
                disabled={!s.canTick}
                onChange={(e) => {
                  const done = e.currentTarget.checked;
                  setTicked((x) => ({ ...x, [s.id]: done }));
                  tick.mutate({ id: s.id, done });
                }}
                aria-label={s.title}
              />
              <span className="grow">{s.title}</span>
              {s.assignee && (
                <span className="small muted">{s.assignee.fullName.split(' ')[0]}</span>
              )}
            </label>
          ))}
        </div>
      )}
      {copy.questions && copy.questions.length > 0 && <Questions copy={copy} />}
      {copy.attachments !== undefined && copy.kind === 'task' && <Files copy={copy} />}
      {copy.submittedAt && copy.status === 'submitted' && mine && (
        <p className="small muted">Waiting for approval. You’re free to log out.</p>
      )}
      {copy.remarks && copy.status !== 'sent_back' && (
        <div className="sec">
          <h3>Approver remarks</h3>
          <p className="tpl">{copy.remarks}</p>
        </div>
      )}
      {copy.can.decide && (
        <div className="decide">
          <ErrorAlert error={decide.error} />
          {copy.can.writeRemarks && (
            <TextInput
              label="Remarks"
              placeholder="Sent along when you approve or send back"
              value={remarks}
              onChange={(e) => {
                setRemarks(e.currentTarget.value);
              }}
            />
          )}
          <Group justify="flex-end" mt="sm">
            <Button
              variant="default"
              loading={decide.isPending && !decide.variables}
              onClick={() => {
                decide.mutate(false);
              }}
            >
              Send back
            </Button>
            <Button
              loading={decide.isPending && decide.variables}
              onClick={() => {
                decide.mutate(true);
              }}
            >
              Approve
            </Button>
          </Group>
        </div>
      )}
    </section>
  );
}

interface Upload {
  key: number;
  name: string;
  file: File;
  progress: number;
  error: string | null;
}

/**
 * Photos and files, with progress and retry (addition b). A failed upload
 * stays in the list with "Try again"; ticks and answers are already saved on
 * the server, so nothing else is lost.
 */
function Files({ copy }: { copy: CopyDetail }) {
  const invalidate = useInvalidate();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const photo = useRef<HTMLInputElement>(null);
  const other = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const attachments = copy.attachments ?? [];

  const patch = (key: number, p: Partial<Upload>) => {
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...p } : u)));
  };
  const send = async (u: Upload) => {
    patch(u.key, { error: null, progress: 0 });
    try {
      const blob = await shrinkPhoto(u.file);
      await uploadWithProgress(
        `/assignments/${copy.id}/attachments?name=${encodeURIComponent(uploadName(u.file, blob))}`,
        blob,
        copyDetailSchema,
        (f) => {
          patch(u.key, { progress: f });
        },
      );
      setUploads((list) => list.filter((x) => x.key !== u.key));
      void invalidate();
    } catch (err) {
      patch(u.key, {
        error:
          err instanceof ApiError
            ? err.message
            : 'The upload didn’t finish. Check your signal and try again.',
      });
    }
  };
  const add = (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      const u: Upload = { key: ++counter.current, name: file.name, file, progress: 0, error: null };
      setUploads((list) => [...list, u]);
      void send(u);
    }
  };
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/assignments/${copy.id}/attachments/${id}`, copyDetailSchema, { method: 'DELETE' }),
    onSuccess: () => void invalidate(),
  });

  return (
    <div className="files">
      <span className="lbl">Photos and files</span>
      <div className="pills">
        {attachments.map((a) => (
          <AttachmentPill
            key={a.id}
            a={a}
            onRemove={
              copy.can.attach
                ? () => {
                    remove.mutate(a.id);
                  }
                : null
            }
          />
        ))}
        {attachments.length === 0 && uploads.length === 0 && (
          <span className="small muted">Nothing attached yet.</span>
        )}
      </div>
      {uploads.map((u) => (
        <div key={u.key} className="upload" role="status">
          <span className="grow small">{u.name}</span>
          {u.error ? (
            <>
              <span className="small err">{u.error}</span>
              <Button
                size="compact-xs"
                variant="default"
                leftSection={<IconRefresh size={14} />}
                onClick={() => void send(u)}
              >
                Try again
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                aria-label={`Remove ${u.name}`}
                onClick={() => {
                  setUploads((list) => list.filter((x) => x.key !== u.key));
                }}
              >
                <IconX size={14} />
              </Button>
            </>
          ) : (
            <Progress value={u.progress * 100} w={120} aria-label={`Uploading ${u.name}`} />
          )}
        </div>
      ))}
      {copy.can.attach && (
        <Group gap="xs" mt="sm">
          <Button
            size="xs"
            variant="default"
            leftSection={<IconCamera size={16} />}
            onClick={() => photo.current?.click()}
          >
            Add photo
          </Button>
          <Button
            size="xs"
            variant="default"
            leftSection={<IconPaperclip size={16} />}
            onClick={() => other.current?.click()}
          >
            Add file
          </Button>
          <input
            ref={photo}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              add(e.currentTarget.files);
              e.currentTarget.value = '';
            }}
          />
          <input
            ref={other}
            type="file"
            accept={FILE_TYPES}
            multiple
            hidden
            onChange={(e) => {
              add(e.currentTarget.files);
              e.currentTarget.value = '';
            }}
          />
        </Group>
      )}
      <ErrorAlert error={remove.error} />
    </div>
  );
}

function AttachmentPill({ a, onRemove }: { a: Attachment; onRemove: (() => void) | null }) {
  const open = async () => {
    const url = await fetchImage(`/api/attachments/${a.id}`);
    if (!url) {
      notify('That file couldn’t be opened.');
      return;
    }
    const link = document.createElement('a');
    link.href = url;
    if (a.isImage) link.target = '_blank';
    else link.download = a.fileName;
    link.rel = 'noopener';
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  return (
    <span className="pill">
      <button type="button" className="pill-open" onClick={() => void open()}>
        {a.isImage ? (
          <IconCamera size={14} aria-hidden="true" />
        ) : (
          <IconFile size={14} aria-hidden="true" />
        )}
        {a.fileName}
      </button>
      {onRemove && (
        <button type="button" aria-label={`Remove ${a.fileName}`} onClick={onRemove}>
          <IconX size={12} />
        </button>
      )}
    </span>
  );
}

/** "Submit for approval" or "Mark as done". A repeat that already went through counts as done. */
function SubmitBar({ copy }: { copy: CopyDetail }) {
  const qc = useQueryClient();
  const submit = useMutation({
    mutationFn: () => api(`/assignments/${copy.id}/submit`, copyDetailSchema, { method: 'POST' }),
    onSuccess: (c) => {
      notify(c.status === 'submitted' ? 'Submitted for approval.' : 'Marked as done.');
      void qc.invalidateQueries({ queryKey: taskKeys.all });
    },
    onError: (err) => {
      // Addition b: on a weak network the first submit may have gone through.
      const status = err instanceof ApiError ? err.details.status : undefined;
      if (err instanceof ApiError && err.status === 409 && ALREADY_IN.includes(String(status))) {
        notify(status === 'submitted' ? 'Submitted for approval.' : 'Marked as done.');
        void qc.invalidateQueries({ queryKey: taskKeys.all });
      }
    },
  });
  if (!isOpen(copy.status)) return null;
  const alreadyIn =
    submit.error instanceof ApiError &&
    submit.error.status === 409 &&
    ALREADY_IN.includes(String(submit.error.details.status));
  return (
    <div className="drawer-f">
      {submit.error && !alreadyIn && (
        <span className="small err grow" role="alert">
          {errorMessage(submit.error)}
        </span>
      )}
      {!copy.can.submit && copy.subtaskCount > copy.subtasksDone && (
        <span className="small muted grow">Tick every sub-task to submit.</span>
      )}
      {!copy.can.submit && (copy.questions?.length ?? 0) > 0 && (
        <span className="small muted grow">Answer every question marked * to submit.</span>
      )}
      <Button
        disabled={!copy.can.submit}
        loading={submit.isPending}
        onClick={() => {
          submit.mutate();
        }}
      >
        {copy.needsApproval ? 'Submit for approval' : 'Mark as done'}
      </Button>
    </div>
  );
}

function People({ t }: { t: TaskDetail }) {
  const qc = useQueryClient();
  const { me } = useMeData();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [deferFor, setDeferFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const act = useMutation({
    mutationFn: ({ id, what }: { id: string; what: 'approve' | 'send-back' | 'cancel' }) =>
      api(`/assignments/${id}/${what}`, copyDetailSchema, {
        method: 'POST',
        body: what === 'cancel' ? { reason } : { remarks: null },
      }),
    onSuccess: (_c, v) => {
      notify(
        v.what === 'approve'
          ? 'Approved.'
          : v.what === 'cancel'
            ? 'Cancelled for that person.'
            : 'Sent back.',
      );
      setCancelFor(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
  const p = t.progress;
  const done = p.done + p.submitted;
  return (
    <section className="sec">
      <Group justify="space-between">
        <h3>People</h3>
        <span className="small muted">
          {done} of {p.total} done or submitted
        </span>
      </Group>
      <span className="bar wide" role="img" aria-label={`${String(done)} of ${String(p.total)}`}>
        <i style={{ width: `${String(p.total ? (done / p.total) * 100 : 0)}%` }} />
      </span>
      <ErrorAlert error={act.error} />
      {t.people.map((c) => (
        <div className="check wrap" key={c.id}>
          <PersonCell person={c.person} />
          <span className="grow" />
          <StatusChip status={c.status} />
          {c.status === 'submitted' && c.person.id !== me.user.id && c.id !== t.myCopy?.id && (
            <Button
              size="compact-sm"
              variant="default"
              onClick={() => {
                setReviewing(c.id);
              }}
            >
              Review
            </Button>
          )}
          {c.canDecide && c.id !== t.myCopy?.id && (
            <>
              <Button
                size="compact-sm"
                variant="default"
                onClick={() => {
                  act.mutate({ id: c.id, what: 'send-back' });
                }}
              >
                Send back
              </Button>
              <Button
                size="compact-sm"
                onClick={() => {
                  act.mutate({ id: c.id, what: 'approve' });
                }}
              >
                Approve
              </Button>
            </>
          )}
          {c.canDefer && (
            <Button
              size="compact-sm"
              variant="subtle"
              aria-label={`Move ${c.person.fullName}’s task to another day`}
              onClick={() => {
                setDeferFor(c.id);
              }}
            >
              <IconCalendarShare size={14} />
            </Button>
          )}
          {c.canCancel && (
            <Button
              size="compact-sm"
              variant="subtle"
              color="red"
              aria-label={`Cancel for ${c.person.fullName}`}
              onClick={() => {
                setCancelFor(c.id);
              }}
            >
              <IconX size={14} />
            </Button>
          )}
        </div>
      ))}
      {reviewing && (
        <ReviewModal
          taskId={t.id}
          copyId={reviewing}
          onClose={() => {
            setReviewing(null);
          }}
        />
      )}
      <Modal
        opened={cancelFor !== null}
        onClose={() => {
          setCancelFor(null);
        }}
        title="Cancel for this person?"
        centered
      >
        <Stack>
          <Textarea
            label="Why?"
            description="They’ll see this on their task."
            value={reason}
            onChange={(e) => {
              setReason(e.currentTarget.value);
            }}
            autosize
            minRows={2}
          />
          <ErrorAlert error={act.error} />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setCancelFor(null);
              }}
            >
              Keep it
            </Button>
            <Button
              color="red"
              disabled={reason.trim().length < 3}
              loading={act.isPending}
              onClick={() => {
                if (cancelFor) act.mutate({ id: cancelFor, what: 'cancel' });
              }}
            >
              Cancel for them
            </Button>
          </Group>
        </Stack>
      </Modal>
      {deferFor && (
        <DeferModal
          copyId={deferFor}
          onClose={() => {
            setDeferFor(null);
          }}
        />
      )}
    </section>
  );
}

/**
 * Defer (brief 9.7, answer 2): to a working day from tomorrow up to 14 days
 * ahead, with a reason. The server checks the school's calendar.
 */
function DeferModal({ copyId, onClose }: { copyId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { me } = useMeData();
  const today = todayIn(me.organisation.timezone);
  const plus = (n: number) =>
    new Date(Date.parse(`${today}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const [date, setDate] = useState(plus(1));
  const [why, setWhy] = useState('');
  const defer = useMutation({
    mutationFn: () =>
      api(`/assignments/${copyId}/defer`, copyDetailSchema, {
        method: 'POST',
        body: { toDate: date, reason: why },
      }),
    onSuccess: () => {
      notify('Moved to the new day.');
      void qc.invalidateQueries({ queryKey: taskKeys.all });
      onClose();
    },
  });
  return (
    <Modal opened onClose={onClose} title="Move to another day" centered>
      <Stack>
        <TextInput
          type="date"
          label="New day"
          min={plus(1)}
          max={plus(14)}
          value={date}
          onChange={(e) => {
            setDate(e.currentTarget.value);
          }}
          error={fieldError(defer.error, 'toDate')}
        />
        <Textarea
          label="Why?"
          description="Saved with the change."
          value={why}
          onChange={(e) => {
            setWhy(e.currentTarget.value);
          }}
          autosize
          minRows={2}
        />
        <ErrorAlert error={defer.error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Keep it
          </Button>
          <Button
            disabled={why.trim().length < 3}
            loading={defer.isPending}
            onClick={() => {
              defer.mutate();
            }}
          >
            Move
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Someone's submitted work, with files and the decision, over the task drawer. */
function ReviewModal({
  taskId,
  copyId,
  onClose,
}: {
  taskId: string;
  copyId: string;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: taskKeys.detail(taskId, copyId),
    queryFn: () => api(`/tasks/${taskId}?copy=${copyId}`, taskDetailSchema),
  });
  const copy = detail.data?.myCopy;
  return (
    <Modal opened onClose={onClose} title="Review" size="lg">
      <ErrorAlert error={detail.error} />
      {copy ? <Work copy={copy} mine={false} /> : <Loader />}
    </Modal>
  );
}
