import { Button, FileButton, Group } from '@mantine/core';
import { photoResultSchema } from '@kidzonia/shared';
import { IconTrash, IconUpload } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { api, upload } from '../api/client';
import { ME_QUERY_KEY } from '../auth/use-me';
import { Avatar } from '../ui/Avatar';
import { ErrorAlert } from '../ui/errors';
import { notify } from '../ui/notify';
import { keys } from './queries';

/**
 * A person's photo with Upload / Remove (brief audit D2). `path` is
 * `/me/photo` for yourself or `/users/:id/photo` for someone you can edit;
 * the server checks the file and the permission either way.
 */
export function PhotoField({
  name,
  photoUrl,
  path,
  canEdit,
}: {
  name: string;
  photoUrl: string | null | undefined;
  path: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  // The drawer's record is a snapshot; show the new photo straight away.
  const [current, setCurrent] = useState(photoUrl ?? null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
    void qc.invalidateQueries({ queryKey: keys.users });
    void qc.invalidateQueries({ queryKey: keys.profile });
  };
  const put = useMutation({
    mutationFn: (file: File) => upload(path, file, photoResultSchema, 'PUT'),
    onSuccess: (r) => {
      setCurrent(r.photoUrl);
      refresh();
      notify('Photo updated');
    },
  });
  const remove = useMutation({
    mutationFn: () => api(path, z.undefined(), { method: 'DELETE' }),
    onSuccess: () => {
      setCurrent(null);
      refresh();
      notify('Photo removed');
    },
  });

  return (
    <div>
      <ErrorAlert error={put.error ?? remove.error} />
      <Group gap="md" align="center">
        <Avatar name={name} photoUrl={current} size="lg" />
        {canEdit && (
          <Group gap="xs">
            <FileButton
              onChange={(f) => {
                if (f) put.mutate(f);
              }}
              accept="image/png,image/jpeg,image/webp"
            >
              {(p) => (
                <Button
                  {...p}
                  variant="default"
                  size="sm"
                  leftSection={<IconUpload size={16} />}
                  loading={put.isPending}
                >
                  Upload photo
                </Button>
              )}
            </FileButton>
            {current && (
              <Button
                variant="subtle"
                color="red"
                size="sm"
                leftSection={<IconTrash size={16} />}
                loading={remove.isPending}
                onClick={() => {
                  remove.mutate();
                }}
              >
                Remove photo
              </Button>
            )}
          </Group>
        )}
      </Group>
    </div>
  );
}
