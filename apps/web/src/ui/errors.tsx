import { Alert } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { ApiError } from '../api/client';

/** The message to show for any failed request. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'We couldn’t reach Kidzonia 360. Check your connection and try again.';
}

/** A field's message from a failed request, for the input's `error` prop. */
export function fieldError(err: unknown, field: string): string | undefined {
  return err instanceof ApiError ? err.fields[field] : undefined;
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Alert color="red" icon={<IconAlertCircle size={18} />} role="alert" mb="md">
      {errorMessage(error)}
    </Alert>
  );
}
