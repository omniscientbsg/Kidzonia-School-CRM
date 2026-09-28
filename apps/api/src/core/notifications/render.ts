import { peopleNames } from '@kidzonia/shared';
import type { Access, NotificationGroup } from '@kidzonia/shared';
import type { Prisma, ScopedTx } from '../../db/index.js';
import type { EntityDescription, Hooks } from '../hooks.js';

/**
 * Notification text, written when read and for the reader (Phase 5 b, e):
 * a task they can no longer see, or one that was cancelled, reads "This task
 * was removed"; a hidden title reads "a task". Nothing about a record is ever
 * stored in the notification itself beyond ids.
 */

/**
 * How a task notification reads; shared by the bell and SMS/WhatsApp.
 * `about` is set when the reader is watching someone else's work (brief 9.8):
 * the name of the person whose work was approved or sent back.
 */
export function taskText(
  event: string,
  title: string,
  by: string | null,
  count = 1,
  about: string | null = null,
): string {
  const who = by ?? 'Someone';
  if (about !== null && event === 'task_approved') {
    return count > 1
      ? `Work on “${title}” was approved for ${String(count)} people`
      : `${who} approved ${about}’s work on “${title}”`;
  }
  if (about !== null && event === 'task_sent_back') {
    return count > 1
      ? `Work on “${title}” was sent back to ${String(count)} people`
      : `${who} sent back ${about}’s work on “${title}”`;
  }
  const text: Record<string, string> = {
    task_assigned: by ? `${by} gave you “${title}”` : `You have a new task: “${title}”`,
    task_submitted:
      count > 1 ? `${String(count)} people submitted “${title}”` : `${who} submitted “${title}”`,
    task_approved: `Your work on “${title}” was approved`,
    task_sent_back: `“${title}” was sent back to you`,
    task_due_soon: `“${title}” is due soon`,
    task_overdue: `“${title}” is overdue`,
    watcher_added: `You were added as a watcher on “${title}”`,
  };
  return text[event] ?? `An update on “${title}”`;
}

export interface GroupRow {
  key: string;
  event: string;
  entityType: string;
  entityId: string;
  count: number;
  unread: number;
  createdAt: Date;
  payload: Prisma.JsonValue;
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const payloadOf = (p: Prisma.JsonValue) =>
  p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};

export async function renderGroups(
  db: ScopedTx,
  hooks: Hooks,
  access: Access,
  groups: readonly GroupRow[],
): Promise<NotificationGroup[]> {
  const taskIds = groups.filter((g) => g.entityType === 'task').map((g) => g.entityId);
  const describeTask = hooks.describe.task;
  const tasks = describeTask
    ? await describeTask(db, access, taskIds)
    : new Map<string, EntityDescription>();
  // People named in notifications: who acted, who asked, who joined.
  const personIds = new Set<string>();
  const changeIds: string[] = [];
  for (const g of groups) {
    const by = str(payloadOf(g.payload).by);
    if (by) personIds.add(by);
    const about = str(payloadOf(g.payload).personId);
    if (about) personIds.add(about);
    if (g.entityType === 'user') personIds.add(g.entityId);
    if (g.entityType === 'field_change') changeIds.push(g.entityId);
  }
  const changes = changeIds.length
    ? await db.pendingFieldChange.findMany({
        where: { id: { in: changeIds } },
        select: { id: true, subjectUserId: true },
      })
    : [];
  changes.forEach((c) => personIds.add(c.subjectUserId));
  const people = personIds.size
    ? await db.user.findMany({
        where: { id: { in: [...personIds] } },
        select: { id: true, fullName: true },
      })
    : [];
  // Names follow the reader's Users field permissions too (the shared rule for composed screens).
  const names = peopleNames(access);
  const nameOf = (id: string | null) =>
    names.show(id ? people.find((p) => p.id === id)?.fullName : null);

  return groups.map((g) => {
    const p = payloadOf(g.payload);
    const base = {
      key: g.key,
      event: g.event,
      count: g.count,
      unread: g.unread,
      createdAt: g.createdAt.toISOString(),
      removed: false,
    };
    if (g.entityType === 'task') {
      const t = tasks.get(g.entityId);
      if (!t || t.removed)
        return { ...base, text: 'This task was removed', href: null, removed: true };
      const title = t.title;
      const copy = str(p.copyId);
      const href = copy ? `${t.href ?? ''}&copy=${copy}` : t.href;
      const by = str(p.by) ? nameOf(str(p.by)) : null;
      const personId = str(p.personId);
      const about = personId && personId !== access.userId ? nameOf(personId) : null;
      return { ...base, text: taskText(g.event, title, by, g.count, about), href };
    }
    if (g.event === 'logout_release_requested') {
      return {
        ...base,
        text:
          g.count > 1
            ? `${String(g.count)} people ask to be released from the logout block`
            : `${nameOf(g.entityId)} asks to be released from the logout block`,
        href: '/tasks/day-end',
      };
    }
    if (g.event === 'released_for_today') {
      return { ...base, text: 'You were released from the logout block', href: null };
    }
    if (g.event === 'user_waiting_for_role') {
      return {
        ...base,
        text:
          g.count > 1
            ? `${String(g.count)} people are waiting for a role`
            : `${nameOf(g.entityId)} joined and is waiting for a role`,
        href: '/settings/users',
      };
    }
    if (g.event === 'field_change_needs_approval') {
      const subject = changes.find((c) => c.id === g.entityId)?.subjectUserId ?? null;
      return {
        ...base,
        text: `A change to ${nameOf(subject)}’s details needs your approval`,
        href: '/changes',
      };
    }
    return { ...base, text: 'You have an update', href: null };
  });
}

/** The latest notification groups for one person (offset paging over groups). */
export async function groupsFor(
  db: ScopedTx,
  userId: string,
  offset: number,
  limit: number,
): Promise<{ rows: GroupRow[]; more: boolean }> {
  const grouped = await db.notification.groupBy({
    by: ['groupKey'],
    where: { recipientUserId: userId },
    _max: { createdAt: true },
    _count: { _all: true },
    orderBy: { _max: { createdAt: 'desc' } },
    skip: offset,
    take: limit + 1,
  });
  const page = grouped.slice(0, limit);
  const keys = page.map((g) => g.groupKey);
  if (keys.length === 0) return { rows: [], more: false };
  const [latest, unread] = await Promise.all([
    db.notification.findMany({
      where: { recipientUserId: userId, groupKey: { in: keys } },
      orderBy: { createdAt: 'desc' },
      distinct: ['groupKey'],
      select: { groupKey: true, event: true, entityType: true, entityId: true, payload: true },
    }),
    db.notification.groupBy({
      by: ['groupKey'],
      where: { recipientUserId: userId, groupKey: { in: keys }, readAt: null },
      _count: { _all: true },
    }),
  ]);
  const rows = page.map((g) => {
    const l = latest.find((x) => x.groupKey === g.groupKey);
    return {
      key: g.groupKey,
      event: l?.event ?? '',
      entityType: l?.entityType ?? '',
      entityId: l?.entityId ?? '',
      count: g._count._all,
      unread: unread.find((u) => u.groupKey === g.groupKey)?._count._all ?? 0,
      createdAt: g._max.createdAt ?? new Date(0),
      payload: l?.payload ?? {},
    };
  });
  return { rows, more: grouped.length > limit };
}
