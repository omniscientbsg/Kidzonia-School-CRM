import type { Prisma, ScopedDb } from '../db/index.js';

/**
 * The demo's Updates feed and notifications (Phase 5), as the demo shows
 * them: who submitted, approved, assigned and missed what, a new holiday and
 * someone waiting for a role; and each persona's bell. Notifications are
 * written already delivered in the app (no SMS/WhatsApp for seed data).
 */

type Key = string;

interface FeedSeed {
  actor: Key | null;
  action: string;
  task?: Key;
  /** People the action is about (besides the actor). */
  to: Key[];
  minutesAgo: number;
  entity?: 'user' | 'holiday';
  about?: Key;
}

const TEACHERS_T2 = ['u8', 'u9', 'u10', 'u11', 'u12', 'u13', 'u17', 'u16', 'u18'];

const FEED: FeedSeed[] = [
  { actor: 'u9', action: 'submitted', task: 't3', to: ['u5'], minutesAgo: 10 },
  { actor: 'u11', action: 'submitted', task: 't7', to: ['u6'], minutesAgo: 25 },
  { actor: 'u5', action: 'approved', task: 't3', to: ['u10'], minutesAgo: 40 },
  { actor: 'u5', action: 'submitted', task: 't5', to: ['u3'], minutesAgo: 60 },
  { actor: 'u3', action: 'approved', task: 't5', to: ['u6'], minutesAgo: 65 },
  { actor: 'u2', action: 'assigned', task: 't2', to: TEACHERS_T2, minutesAgo: 120 },
  { actor: null, action: 'missed', task: 't1', to: ['u12'], minutesAgo: 180 },
  { actor: 'u5', action: 'assigned', task: 't4', to: ['u8'], minutesAgo: 60 * 20 },
  {
    actor: null,
    action: 'waiting_for_role',
    entity: 'user',
    about: 'u14',
    to: [],
    minutesAgo: 60 * 22,
  },
];

interface NotifSeed {
  to: Key;
  event: string;
  task?: Key;
  by?: Key;
  about?: Key;
  minutesAgo: number;
}

const NOTIFICATIONS: NotifSeed[] = [
  // Submitted for your approval.
  { to: 'u5', event: 'task_submitted', task: 't3', by: 'u9', minutesAgo: 10 },
  { to: 'u6', event: 'task_submitted', task: 't7', by: 'u11', minutesAgo: 25 },
  { to: 'u3', event: 'task_submitted', task: 't5', by: 'u5', minutesAgo: 60 },
  { to: 'u2', event: 'task_submitted', task: 't2', by: 'u9', minutesAgo: 90 },
  { to: 'u2', event: 'task_submitted', task: 't2', by: 'u11', minutesAgo: 85 },
  { to: 'u2', event: 'task_submitted', task: 't2', by: 'u17', minutesAgo: 80 },
  { to: 'u1', event: 'task_submitted', task: 't8', by: 'u5', minutesAgo: 50 },
  { to: 'u1', event: 'task_submitted', task: 't8', by: 'u7', minutesAgo: 45 },
  // Approved.
  { to: 'u10', event: 'task_approved', task: 't3', by: 'u5', minutesAgo: 40 },
  { to: 'u6', event: 'task_approved', task: 't5', by: 'u3', minutesAgo: 65 },
  // Assigned to you.
  { to: 'u8', event: 'task_assigned', task: 't4', by: 'u5', minutesAgo: 60 * 20 },
  { to: 'u8', event: 'task_assigned', task: 't2', by: 'u2', minutesAgo: 120 },
  { to: 'u12', event: 'task_assigned', task: 't7', by: 'u6', minutesAgo: 60 * 26 },
  { to: 'u15', event: 'task_assigned', task: 't6', by: 'u4', minutesAgo: 60 * 30 },
  // Watching.
  { to: 'u5', event: 'watcher_added', task: 't2', by: 'u2', minutesAgo: 121 },
  { to: 'u2', event: 'watcher_added', task: 't4', by: 'u5', minutesAgo: 60 * 20 },
  { to: 'u3', event: 'watcher_added', task: 't4', by: 'u5', minutesAgo: 60 * 20 },
  { to: 'u4', event: 'watcher_added', task: 't7', by: 'u6', minutesAgo: 60 * 26 },
  // Someone joined without a role.
  { to: 'u1', event: 'user_waiting_for_role', about: 'u14', minutesAgo: 60 * 22 },
];

const SEED_KEY = 'seed:home';

export async function seedHome(
  db: ScopedDb,
  organisationId: string,
  users: Readonly<Record<string, string>>,
  tasks: Readonly<Record<string, string>>,
  now: Date,
): Promise<void> {
  const org = await db.organisation.findFirstOrThrow({ select: { timezone: true } });
  const u = (k: Key) => {
    const id = users[k];
    if (!id) throw new Error(`No demo person ${k}`);
    return id;
  };
  const t = (k: Key) => {
    const id = tasks[k];
    if (!id) throw new Error(`No demo task ${k}`);
    return id;
  };
  const people = await db.user.findMany({
    where: { id: { in: Object.values(users) } },
    select: { id: true, homeSchoolId: true },
  });
  const schoolOf = new Map(people.map((p) => [p.id, p.homeSchoolId]));
  const ago = (m: number) => new Date(now.getTime() - m * 60_000);
  const localDate = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: org.timezone }).format(d);

  const activity: Prisma.ActivityCreateManyInput[] = FEED.map((f) => {
    const actor = f.actor ? u(f.actor) : null;
    const subjects = [...(actor ? [actor] : []), ...f.to.map(u)];
    const about = f.about ? u(f.about) : null;
    return {
      organisationId,
      actorUserId: actor,
      action: f.action,
      entityType: f.entity ?? 'task',
      entityId: f.task ? t(f.task) : (about ?? ''),
      taskId: f.task ? t(f.task) : null,
      subjectUserIds: about ? [about] : subjects,
      schoolId: schoolOf.get(actor ?? about ?? subjects[0] ?? '') ?? null,
      createdAt: ago(f.minutesAgo),
    };
  });
  // A holiday the Owner added yesterday, if the calendar has one coming up.
  const holiday = await db.holiday.findFirst({
    where: { startDate: { gte: now } },
    orderBy: { startDate: 'asc' },
    select: { id: true },
  });
  if (holiday) {
    activity.push({
      organisationId,
      actorUserId: u('u1'),
      action: 'created',
      entityType: 'holiday',
      entityId: holiday.id,
      subjectUserIds: [],
      orgWide: true,
      createdAt: ago(60 * 21),
    });
  }
  await db.activity.createMany({ data: activity });

  for (const [i, n] of NOTIFICATIONS.entries()) {
    const createdAt = ago(n.minutesAgo);
    const entityType = n.task ? 'task' : 'user';
    const entityId = n.task ? t(n.task) : u(n.about ?? '');
    const payload = n.by ? { by: u(n.by) } : {};
    const event = await db.notificationOutbox.create({
      data: {
        organisationId,
        event: n.event,
        recipientUserId: u(n.to),
        entityType,
        entityId,
        payload,
        dedupeKey: `${SEED_KEY}:${String(i)}`,
        createdAt,
        deliveredAt: createdAt,
      },
      select: { id: true },
    });
    await db.notificationDelivery.create({
      data: {
        organisationId,
        outboxId: event.id,
        channel: 'in_app',
        status: 'sent',
        attempts: 1,
        sentAt: createdAt,
      },
    });
    await db.notification.create({
      data: {
        organisationId,
        recipientUserId: u(n.to),
        outboxId: event.id,
        event: n.event,
        entityType,
        entityId,
        payload,
        groupKey: `${n.event}:${entityId}:${localDate(createdAt)}`,
        createdAt,
      },
    });
  }
}

/** Whether the demo's feed and notifications are already in (the flag for grafting). */
export async function hasHomeSeed(db: ScopedDb): Promise<boolean> {
  return (
    (await db.notificationOutbox.count({ where: { dedupeKey: { startsWith: SEED_KEY } } })) > 0
  );
}
