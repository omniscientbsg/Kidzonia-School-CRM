import { Button, Popover, UnstyledButton } from '@mantine/core';
import type { NotificationGroup } from '@kidzonia/shared';
import {
  IconBell,
  IconChecks,
  IconClock,
  IconEye,
  IconHourglass,
  IconLock,
  IconMessage,
  IconSubtask,
} from '@tabler/icons-react';
import type { ComponentType } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMarkRead, useNotificationCount, useNotifications } from '../home/api';
import { ErrorAlert } from '../ui/errors';

const ICONS: Record<string, ComponentType<{ size?: number }>> = {
  task_assigned: IconSubtask,
  task_submitted: IconChecks,
  task_approved: IconChecks,
  task_sent_back: IconMessage,
  task_due_soon: IconClock,
  task_overdue: IconClock,
  watcher_added: IconEye,
  logout_release_requested: IconLock,
  released_for_today: IconLock,
  user_waiting_for_role: IconHourglass,
};
const HOT = new Set(['task_sent_back', 'task_overdue', 'logout_release_requested']);

const ago = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
/** "10 minutes ago", "yesterday", from the server's timestamps. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return 'Just now';
  if (abs < 3600) return ago.format(Math.round(s / 60), 'minute');
  if (abs < 86_400) return ago.format(Math.round(s / 3600), 'hour');
  const text = ago.format(Math.round(s / 86_400), 'day');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * One notification. A removed task (cancelled, or no longer visible) reads
 * "This task was removed" and is not a link (Phase 5 addition e).
 */
export function NotificationItem({
  n,
  onOpen,
}: {
  n: NotificationGroup;
  onOpen: (n: NotificationGroup) => void;
}) {
  const Icon = ICONS[n.event] ?? IconBell;
  const body = (
    <>
      <span className="notif-i" aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="notif-t">
        {n.text}
        <small>
          {timeAgo(n.createdAt)}
          {n.unread > 0 && <span className="unread-dot"> · New</span>}
        </small>
      </span>
    </>
  );
  const cls = `notif${HOT.has(n.event) ? ' hot' : ''}${n.unread > 0 ? ' unread' : ''}`;
  if (!n.href) return <div className={`${cls} removed`}>{body}</div>;
  return (
    <button
      type="button"
      className={cls}
      onClick={() => {
        onOpen(n);
      }}
    >
      {body}
    </button>
  );
}

/**
 * The bell (brief 10.2): an unread count that refreshes about every minute
 * and when the window regains focus, announced politely to screen readers
 * when it changes (Phase 5 addition d).
 */
export function Bell() {
  const [open, setOpen] = useState(false);
  const count = useNotificationCount();
  const list = useNotifications(open);
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const unread = count.data?.unread ?? 0;

  const [announcement, setAnnouncement] = useState('');
  const previous = useRef<number | null>(null);
  useEffect(() => {
    if (!count.data) return;
    if (previous.current !== null && previous.current !== unread) {
      setAnnouncement(
        unread === 0
          ? 'No unread notifications'
          : `${String(unread)} unread ${unread === 1 ? 'notification' : 'notifications'}`,
      );
    }
    previous.current = unread;
  }, [count.data, unread]);

  const openItem = (n: NotificationGroup) => {
    if (n.unread > 0) markRead.mutate([n.key]);
    setOpen(false);
    if (n.href) void navigate(n.href);
  };
  const items = list.data?.items ?? [];

  return (
    <>
      <Popover
        opened={open}
        onChange={setOpen}
        position="bottom-end"
        width={380}
        shadow="lg"
        radius="lg"
      >
        <Popover.Target>
          <UnstyledButton
            className="barbtn"
            aria-label={unread > 0 ? `Notifications, ${String(unread)} unread` : 'Notifications'}
            aria-expanded={open}
            onClick={() => {
              setOpen((o) => !o);
            }}
          >
            <IconBell size={20} stroke={1.8} />
            {unread > 0 && (
              <span className="badge" aria-hidden="true">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </UnstyledButton>
        </Popover.Target>
        <Popover.Dropdown p={8}>
          <div className="pop-h">
            <span>Notifications</span>
            {unread > 0 && (
              <Button
                size="compact-sm"
                variant="subtle"
                loading={markRead.isPending}
                onClick={() => {
                  markRead.mutate('all');
                }}
              >
                Mark all read
              </Button>
            )}
          </div>
          <ErrorAlert error={list.error} />
          <div className="notif-list">
            {items.map((n) => (
              <NotificationItem key={n.key} n={n} onOpen={openItem} />
            ))}
            {items.length === 0 && !list.isLoading && (
              <p className="empty">You’re all caught up.</p>
            )}
          </div>
          <div className="pop-f">
            <Link
              to="/notifications/settings"
              onClick={() => {
                setOpen(false);
              }}
            >
              Notification settings
            </Link>
          </div>
        </Popover.Dropdown>
      </Popover>
      <span className="visually-hidden" aria-live="polite" role="status">
        {announcement}
      </span>
    </>
  );
}
