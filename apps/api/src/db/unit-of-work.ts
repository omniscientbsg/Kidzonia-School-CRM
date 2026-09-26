import type { Prisma } from '../generated/prisma/client.js';
import type { ScopedDb, ScopedTx } from './scoped.js';
import { uowStorage } from './tracking.js';
import type { AuditEntry, UnitOfWorkState } from './tracking.js';

export interface Actor {
  organisationId: string;
  userId: string | null;
  requestId: string | null;
}

export interface UnitOfWork {
  tx: ScopedTx;
  /** Deliberate audit record (brief 10.4), stored in the same transaction. */
  audit: (entry: AuditEntry) => void;
}

const toJson = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/**
 * Runs `fn` in one database transaction. Every multi-row write goes through
 * here: activity from tracked writes and audit entries are written in the
 * same transaction, so they can never disagree with the data.
 */
export async function withUnitOfWork<T>(
  db: ScopedDb,
  actor: Actor,
  fn: (uow: UnitOfWork) => Promise<T>,
  /** Long-running work (seeding, bulk imports) may need more than the 10 s default. */
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const outer = uowStorage.getStore();
  if (outer) {
    throw new Error('withUnitOfWork() is not re-entrant; pass the existing unit of work down');
  }
  const state: UnitOfWorkState = {
    actorUserId: actor.userId,
    requestId: actor.requestId,
    activity: [],
    audit: [],
  };
  return db.$transaction(
    async (tx) =>
      uowStorage.run(state, async () => {
        const result = await fn({ tx, audit: (entry) => state.audit.push(entry) });
        if (state.activity.length > 0) {
          await tx.activity.createMany({
            data: state.activity.map((e) => ({
              organisationId: actor.organisationId,
              actorUserId: state.actorUserId,
              action: e.action,
              entityType: e.entityType,
              entityId: e.entityId,
              subjectUserIds: e.subjectUserIds,
              schoolId: e.schoolId,
              orgWide: e.orgWide,
            })),
          });
        }
        if (state.audit.length > 0) {
          await tx.auditLog.createMany({
            data: state.audit.map((a) => {
              const before = toJson(a.before);
              const after = toJson(a.after);
              return {
                organisationId: actor.organisationId,
                actorUserId: state.actorUserId,
                action: a.action,
                entityType: a.entityType,
                entityId: a.entityId,
                requestId: state.requestId,
                ...(before === undefined ? {} : { before }),
                ...(after === undefined ? {} : { after }),
              };
            }),
          });
        }
        return result;
      }),
    { timeout: options.timeoutMs ?? 10_000, maxWait: 5_000 },
  );
}
