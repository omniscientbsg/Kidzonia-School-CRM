import { peopleNames } from '@kidzonia/shared';
import type { Access, FeedItem, ReachScope } from '@kidzonia/shared';
import type { Prisma, ScopedTx } from '../../db/index.js';
import type { EntityDescription, Hooks } from '../../core/hooks.js';
import { visibleTaskWhere } from './facts.js';

/**
 * The Updates feed (brief 10.3). Everything about who sees what is in the
 * query, before the limit (Phase 5 addition a): a task item only appears if
 * the reader can see that task now, so pages are never short and never hint
 * at hidden items. Text is written for the reader, with hidden titles and
 * names left out; the tasks, people and holidays it mentions are loaded in
 * batches.
 */

export const FEED_TASK_VERBS = [
  'assigned',
  'submitted',
  'completed',
  'approved',
  'sent_back',
  'cancelled',
  'cancelled_copy',
  'deferred',
  'missed',
] as const;

/** Actions by people in someone's reach: for team reach or wider (10.3). */
function byPeopleInReach(scope: ReachScope): Prisma.ActivityWhereInput | null {
  if (scope.kind === 'all') return {};
  if (scope.kind === 'none') return null;
  const or: Prisma.ActivityWhereInput[] = [];
  if (scope.userIds.length > 0) or.push({ actorUserId: { in: [...scope.userIds] } });
  if (scope.schoolIds === 'any') or.push({ schoolId: { not: null } });
  else if (scope.schoolIds.length > 0) or.push({ schoolId: { in: [...scope.schoolIds] } });
  return or.length > 0 ? { OR: or } : null;
}

export function feedWhere(access: Access): Prisma.ActivityWhereInput {
  const me = access.userId;
  const taskScopes = access.scopes('tasks');
  const reach = taskScopes.map(byPeopleInReach);
  const audience: Prisma.ActivityWhereInput[] = [
    { subjectUserIds: { has: me } },
    { actorUserId: me },
    { orgWide: true },
  ];
  if (reach.every((r) => r !== null)) audience.push({ AND: reach });
  const seesPeople = access.can('users', 'view');
  const userScopes = access.scopes('users').map(byPeopleInReach);
  const kinds: Prisma.ActivityWhereInput[] = [
    { entityType: 'task', action: { in: [...FEED_TASK_VERBS] } },
    { entityType: 'holiday', action: 'created', orgWide: true },
  ];
  // Admin items (someone waiting for a role) only for people with Users.
  if (seesPeople && userScopes.every((s) => s !== null)) {
    kinds.push({ entityType: 'user', action: 'waiting_for_role', AND: userScopes });
  }
  return {
    AND: [
      { OR: audience },
      { OR: kinds },
      { OR: [{ taskId: null }, { task: visibleTaskWhere(taskScopes, me) }] },
    ],
  };
}

export async function feedFor(
  db: ScopedTx,
  hooks: Hooks,
  access: Access,
  limit: number,
  timezone: string,
): Promise<FeedItem[]> {
  const rows = await db.activity.findMany({
    where: feedWhere(access),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      actorUserId: true,
      subjectUserIds: true,
      createdAt: true,
    },
  });
  const me = access.userId;
  const taskIds = rows.filter((r) => r.entityType === 'task').map((r) => r.entityId);
  const holidayIds = rows.filter((r) => r.entityType === 'holiday').map((r) => r.entityId);
  const personIds = new Set<string>();
  for (const r of rows) {
    if (r.actorUserId) personIds.add(r.actorUserId);
    if (r.entityType === 'user') personIds.add(r.entityId);
  }
  const [tasks, holidays, people] = await Promise.all([
    hooks.describe.task
      ? hooks.describe.task(db, access, taskIds)
      : Promise.resolve(new Map<string, EntityDescription>()),
    holidayIds.length
      ? db.holiday.findMany({
          where: { id: { in: holidayIds } },
          select: { id: true, name: true, startDate: true },
        })
      : Promise.resolve([]),
    personIds.size
      ? db.user.findMany({
          where: { id: { in: [...personIds] } },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
  ]);
  const names = peopleNames(access);
  const name = (id: string | null) =>
    id === me ? 'You' : names.show(id ? people.find((p) => p.id === id)?.fullName : null);
  const day = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  });

  return rows.map((r) => {
    const actor = r.actorUserId ? { id: r.actorUserId, fullName: name(r.actorUserId) } : null;
    const who = name(r.actorUserId);
    let text = '';
    let href: string | null = null;
    if (r.entityType === 'task') {
      const t = tasks.get(r.entityId);
      const title = t && !t.removed ? `“${t.title}”` : 'a task';
      href = t && !t.removed ? t.href : null;
      const others = r.subjectUserIds.filter((id) => id !== r.actorUserId);
      const toWhom =
        others.length === 1 && others[0] === me
          ? 'you'
          : `${String(others.length)} ${others.length === 1 ? 'person' : 'people'}`;
      switch (r.action) {
        case 'assigned':
          text = `${who} assigned ${title} to ${toWhom}`;
          break;
        case 'submitted':
          text = `${who} submitted ${title}`;
          break;
        case 'completed':
          text = `${who} finished ${title}`;
          break;
        case 'approved':
          text = `${who} approved work on ${title}`;
          break;
        case 'sent_back':
          text = `${who} sent back work on ${title}`;
          break;
        case 'cancelled':
          text = `${who} cancelled ${title}`;
          break;
        case 'cancelled_copy':
          text = `${who} cancelled one person’s copy of ${title}`;
          break;
        case 'deferred':
          text = `${who} moved ${title} to another day`;
          break;
        case 'missed':
          text = r.subjectUserIds.includes(me)
            ? `You missed the deadline for ${title}`
            : `${String(r.subjectUserIds.length)} ${r.subjectUserIds.length === 1 ? 'person' : 'people'} missed the deadline for ${title}`;
          break;
      }
    } else if (r.entityType === 'holiday') {
      const h = holidays.find((x) => x.id === r.entityId);
      text = h
        ? `${who} added a holiday: ${h.name} on ${day.format(h.startDate)}`
        : `${who} added a holiday`;
    } else if (r.entityType === 'user') {
      text = `${name(r.entityId)} joined and is waiting for a role`;
      href = '/settings/users';
    }
    return { id: r.id, text, href, actor, createdAt: r.createdAt.toISOString() };
  });
}
