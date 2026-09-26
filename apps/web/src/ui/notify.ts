import { notifications } from '@mantine/notifications';

/** A short confirmation at the bottom of the screen, like the demo's toasts. */
export function notify(message: string): void {
  notifications.show({ message, autoClose: 2600, withCloseButton: false });
}
