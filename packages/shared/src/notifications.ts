/**
 * Every notification event (brief 10.1), declared once. Writing an event that
 * isn't here throws, and the Phase 5 settings screen reads this list, so new
 * events appear there automatically.
 */
export const NOTIFICATION_EVENTS = {
  task_assigned: 'A task is given to you',
  task_due_soon: 'A task is due within the hour',
  task_overdue: 'A task is past its deadline',
  task_submitted: 'Work you approve or watch was submitted',
  task_approved: 'Your work was approved',
  task_sent_back: 'Your work was sent back',
  logout_release_requested: 'Someone asks to be released from the logout block',
  released_for_today: 'You were released from the logout block',
  watcher_added: 'You were added as a watcher',
  user_waiting_for_role: 'Someone joined and is waiting for a role',
  field_change_needs_approval: 'A change to someone’s details needs your approval',
} as const;

export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;

export function isNotificationEvent(e: string): e is NotificationEvent {
  return Object.hasOwn(NOTIFICATION_EVENTS, e);
}
