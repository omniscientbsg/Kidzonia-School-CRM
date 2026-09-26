import { Button, ColorInput, Group, Modal, Stack, TextInput } from '@mantine/core';
import { categorySchema, listValueSchema, prioritySchema } from '@kidzonia/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { ErrorAlert, fieldError } from '../ui/errors';
import { taskKeys } from './api';

export const SWATCHES = [
  '#2B5896',
  '#B42318',
  '#1C5A51',
  '#8A4FBF',
  '#6B6F2A',
  '#D9770A',
  '#5F6A67',
  '#0D7482',
];

export type MasterKind =
  { kind: 'category' } | { kind: 'priority' } | { kind: 'value'; listId: string; listName: string };

const TITLES = { category: 'New category', priority: 'New priority', value: 'New value' };

/**
 * The small "+ New" form (brief 9.9): the same one in Task setup and in the
 * task form's pickers, shown only to people with task_setup.create.
 */
export function MasterModal({
  what,
  onClose,
  onCreated,
}: {
  what: MasterKind | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  return (
    <Modal
      opened={what !== null}
      onClose={onClose}
      title={
        what
          ? what.kind === 'value'
            ? `New ${what.listName.toLowerCase()}`
            : TITLES[what.kind]
          : ''
      }
      centered
    >
      {what && <MasterForm key={JSON.stringify(what)} what={what} onDone={onCreated} />}
    </Modal>
  );
}

export function MasterForm({ what, onDone }: { what: MasterKind; onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[0] ?? '#2B5896');
  const save = useMutation({
    mutationFn: async () => {
      if (what.kind === 'value') {
        return api(`/task-setup/lists/${what.listId}/values`, listValueSchema, {
          method: 'POST',
          body: { value: name },
        });
      }
      const path = what.kind === 'category' ? 'categories' : 'priorities';
      return api(
        `/task-setup/${path}`,
        what.kind === 'category' ? categorySchema : prioritySchema,
        {
          method: 'POST',
          body: { name, color },
        },
      );
    },
    onSuccess: async (row) => {
      await qc.invalidateQueries({ queryKey: taskKeys.setup });
      setName('');
      onDone(row.id);
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Stack>
        <ErrorAlert error={save.error} />
        <TextInput
          label={what.kind === 'value' ? 'Value' : 'Name'}
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value);
          }}
          error={fieldError(save.error, what.kind === 'value' ? 'value' : 'name')}
          data-autofocus
          required
        />
        {what.kind !== 'value' && (
          <ColorInput
            label="Colour"
            value={color}
            onChange={setColor}
            swatches={SWATCHES}
            format="hex"
            error={fieldError(save.error, 'color')}
          />
        )}
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending} disabled={!name.trim()}>
            Add
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
