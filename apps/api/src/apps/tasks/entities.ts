import { fieldView } from '@kidzonia/shared';
import type { DescribeHook, EntityDescription } from '../../core/hooks.js';
import { visibleTaskWhere } from './facts.js';

const REMOVED: EntityDescription = { title: 'This task was removed', href: null, removed: true };

/**
 * How a task reads in someone's notifications and feed: only if they can see
 * it now (checked in the query, in one batch), with its title trimmed by
 * their field permissions. Cancelled or no-longer-visible tasks read as
 * "This task was removed" and don't link anywhere (Phase 5 addition e).
 */
export const describeTasks: DescribeHook = async (db, access, ids) => {
  const unique = [...new Set(ids)];
  const out = new Map<string, EntityDescription>();
  if (unique.length === 0) return out;
  const rows = await db.task.findMany({
    where: {
      AND: [
        { id: { in: unique } },
        visibleTaskWhere(access.scopes('tasks', 'view', false), access.userId),
      ],
    },
    select: {
      id: true,
      title: true,
      cancelledAt: true,
      assignments: { where: { userId: access.userId }, select: { id: true }, take: 1 },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const own = { subjectUserIds: [access.userId], schoolIds: [] };
  const titleSeen = fieldView(access, 'tasks').sees('title');
  const titleSeenOwn = fieldView(access, 'tasks', own).sees('title');
  for (const id of unique) {
    const t = byId.get(id);
    if (!t || t.cancelledAt) {
      out.set(id, REMOVED);
      continue;
    }
    const mine = t.assignments.length > 0;
    out.set(id, {
      title: (mine ? titleSeenOwn : titleSeen) ? t.title : 'a task',
      href: `/tasks?task=${id}`,
      removed: false,
    });
  }
  return out;
};
