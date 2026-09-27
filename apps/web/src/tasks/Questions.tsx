import { Checkbox, NumberInput, Select, Stack, TextInput } from '@mantine/core';
import type { CopyDetail } from '@kidzonia/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '../api/client';
import { ErrorAlert } from '../ui/errors';
import { copyDetailSchema, taskKeys } from './api';

type Value = boolean | number | string | string[] | null;

/**
 * A day-end report's questions (brief 9.11), with the questions this copy was
 * given. Answers save as they're given (typed ones after a short pause), so
 * nothing is lost on a weak connection before "Submit".
 */
export function Questions({ copy }: { copy: CopyDetail }) {
  const qc = useQueryClient();
  const questions = copy.questions ?? [];
  const [values, setValues] = useState<Record<string, Value>>(() => ({ ...(copy.answers ?? {}) }));
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const editable = copy.can.answer === true;
  const save = useMutation({
    mutationFn: (answers: Record<string, Value>) =>
      api(`/assignments/${copy.id}/answers`, copyDetailSchema, {
        method: 'POST',
        body: { answers },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskKeys.all }),
  });
  const set = (id: string, v: Value, wait = 0) => {
    setValues((x) => ({ ...x, [id]: v }));
    const old = timers.current.get(id);
    if (old) clearTimeout(old);
    timers.current.set(
      id,
      setTimeout(() => {
        save.mutate({ [id]: v });
      }, wait),
    );
  };

  return (
    <Stack gap="sm" mt="sm">
      {questions.map((q) => {
        const label = q.text;
        const v = values[q.id] ?? null;
        switch (q.type) {
          case 'yes_no':
            return (
              <div key={q.id}>
                <span className="lbl">
                  {label} {q.required && <span className="req">*</span>}
                </span>
                <div className="seg" role="group" aria-label={label}>
                  {[true, false].map((b) => (
                    <button
                      key={String(b)}
                      type="button"
                      aria-pressed={v === b}
                      disabled={!editable}
                      onClick={() => {
                        set(q.id, b);
                      }}
                    >
                      {b ? 'Yes' : 'No'}
                    </button>
                  ))}
                </div>
              </div>
            );
          case 'number':
            return (
              <NumberInput
                key={q.id}
                label={label}
                required={q.required}
                inputMode="numeric"
                disabled={!editable}
                value={typeof v === 'number' ? v : ''}
                onChange={(n) => {
                  set(q.id, typeof n === 'number' ? n : null, 600);
                }}
              />
            );
          case 'short_text':
            return (
              <TextInput
                key={q.id}
                label={label}
                required={q.required}
                disabled={!editable}
                value={typeof v === 'string' ? v : ''}
                onChange={(e) => {
                  set(q.id, e.currentTarget.value, 600);
                }}
              />
            );
          case 'pick_one':
            return (
              <Select
                key={q.id}
                label={label}
                required={q.required}
                disabled={!editable}
                data={q.options}
                value={typeof v === 'string' ? v : null}
                onChange={(s) => {
                  set(q.id, s);
                }}
              />
            );
          case 'checklist':
            return (
              <Checkbox.Group
                key={q.id}
                label={label}
                required={q.required}
                value={Array.isArray(v) ? v : []}
                onChange={(list) => {
                  set(q.id, list);
                }}
              >
                <Stack gap={6} mt={6}>
                  {q.options.map((o) => (
                    <Checkbox key={o} value={o} label={o} disabled={!editable} />
                  ))}
                </Stack>
              </Checkbox.Group>
            );
        }
        return null;
      })}
      <ErrorAlert error={save.error} />
    </Stack>
  );
}
