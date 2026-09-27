import { isNotificationEvent } from '@kidzonia/shared';
import type { NotificationEvent } from '@kidzonia/shared';
import type { Prisma, ScopedTx } from '../db/index.js';

/**
 * Notification events (brief 10.1, Phase 4 item f). Phase 4 only records
 * them; Phase 5 delivers them and builds the screens. One row per person
 * told, because delivery and muting are per person. The dedupe key makes
 * writing the same event twice (a job that runs again) a no-op.
 */
export interface OutboxEvent {
  event: NotificationEvent;
  recipientUserId: string;
  entityType: string;
  entityId: string;
  /** Unique per organisation, e.g. `task_due_soon:<copy id>`. */
  dedupeKey: string;
  payload?: Record<string, unknown>;
}

const CHUNK = 1000;

export async function emit(
  tx: ScopedTx,
  organisationId: string,
  events: readonly OutboxEvent[],
): Promise<number> {
  for (const e of events) {
    // An event missing from the one list is a programming error (brief 10.1).
    const name: string = e.event;
    if (!isNotificationEvent(name)) throw new Error(`Unknown notification event "${name}"`);
  }
  let written = 0;
  for (let i = 0; i < events.length; i += CHUNK) {
    const res = await tx.notificationOutbox.createMany({
      data: events.slice(i, i + CHUNK).map((e) => ({
        organisationId,
        event: e.event,
        recipientUserId: e.recipientUserId,
        entityType: e.entityType,
        entityId: e.entityId,
        dedupeKey: e.dedupeKey,
        payload: (e.payload ?? {}) as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
    written += res.count;
  }
  return written;
}

/** People who may give roles: Owners, and roles with Roles & permissions → Edit. */
export async function roleEditorIds(tx: ScopedTx): Promise<string[]> {
  const rows = await tx.roleAssignment.findMany({
    where: {
      user: { deletedAt: null, status: { not: 'inactive' } },
      role: {
        deletedAt: null,
        OR: [
          { isOwner: true },
          { permissions: { some: { moduleKey: 'roles', actions: { has: 'edit' } } } },
        ],
      },
    },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}
