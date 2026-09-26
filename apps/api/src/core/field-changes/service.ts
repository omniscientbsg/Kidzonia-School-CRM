import { isDeepStrictEqual } from 'node:util';
import { registry, toPage } from '@kidzonia/shared';
import type { Access, FieldChange, Page } from '@kidzonia/shared';
import type { DataAccess, Prisma, UnitOfWork } from '../../db/index.js';
import { withUnitOfWork } from '../../db/index.js';
import { conflict, notAllowed, notFound } from '../../lib/errors.js';
import type { AuthInfo } from '../../http/types.js';
import type { LoadedPermissions } from '../permission-context.js';
import { fieldChangeHandler } from './handlers.js';

const toJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;

export interface RequestedChange {
  fieldKey: string;
  oldValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
}

/**
 * Saves changes that need approval. Only one request per field per record is
 * open at a time (addition f): a new one supersedes the old. The approver is
 * told through the activity feed (notifications arrive in Phase 5).
 */
export async function requestFieldChanges(
  uow: UnitOfWork,
  args: {
    organisationId: string;
    moduleKey: string;
    recordId: string;
    subjectUserId: string;
    requestedBy: string;
    changes: RequestedChange[];
  },
): Promise<void> {
  for (const c of args.changes) {
    await uow.tx.pendingFieldChange.updateManyAndReturn({
      where: {
        moduleKey: args.moduleKey,
        recordId: args.recordId,
        fieldKey: c.fieldKey,
        status: 'pending',
      },
      data: { status: 'superseded' },
      select: { id: true, subjectUserId: true, requestedBy: true },
    });
    await uow.tx.pendingFieldChange.create({
      data: {
        organisationId: args.organisationId,
        moduleKey: args.moduleKey,
        recordId: args.recordId,
        subjectUserId: args.subjectUserId,
        fieldKey: c.fieldKey,
        oldValue: toJson(c.oldValue),
        newValue: toJson(c.newValue),
        requestedBy: args.requestedBy,
      },
      select: { id: true, subjectUserId: true, requestedBy: true },
    });
  }
}

/**
 * Who decides a change about `subjectUserId`: their nearest active manager,
 * walking up past anyone inactive (addition e). Null means an Owner decides.
 */
export async function approverFor(
  data: DataAccess,
  organisationId: string,
  subjectUserId: string,
): Promise<string | null> {
  const chain = await data.managerChain(organisationId, subjectUserId);
  return chain.find((c) => c.active)?.id ?? null;
}

async function canDecide(
  data: DataAccess,
  self: LoadedPermissions,
  organisationId: string,
  subjectUserId: string,
): Promise<boolean> {
  if (subjectUserId === self.ctx.userId) return false;
  if (self.ctx.role?.isOwner) return true;
  return (await approverFor(data, organisationId, subjectUserId)) === self.ctx.userId;
}

const SELECT = {
  id: true,
  moduleKey: true,
  recordId: true,
  fieldKey: true,
  oldValue: true,
  newValue: true,
  status: true,
  reason: true,
  createdAt: true,
  subjectUserId: true,
  subject: { select: { id: true, fullName: true, homeSchoolId: true } },
  requester: { select: { id: true, fullName: true } },
} as const;

type Row = Prisma.PendingFieldChangeGetPayload<{ select: typeof SELECT }>;

function present(access: Access, row: Row): FieldChange & { valuesHidden: boolean } {
  const mod = registry.module(row.moduleKey);
  const field = (mod.fields ?? []).find((f) => f.key === row.fieldKey);
  const facts = {
    subjectUserIds: [row.subject.id],
    schoolIds: row.subject.homeSchoolId ? [row.subject.homeSchoolId] : [],
  };
  // An approver whose own role hides the field still decides, but never sees the values.
  const hidden = access.fieldAccess(row.moduleKey, row.fieldKey, facts) === 'hidden';
  return {
    id: row.id,
    moduleKey: row.moduleKey,
    moduleName: mod.name,
    recordId: row.recordId,
    fieldKey: row.fieldKey,
    fieldLabel: field?.label ?? row.fieldKey,
    subject: { id: row.subject.id, fullName: row.subject.fullName },
    requestedBy: { id: row.requester.id, fullName: row.requester.fullName },
    oldValue: hidden ? null : row.oldValue,
    newValue: hidden ? null : row.newValue,
    valuesHidden: hidden,
    status: row.status,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listFieldChanges(
  auth: AuthInfo,
  data: DataAccess,
  view: 'mine' | 'to_approve',
  page: { cursor?: string | undefined; limit: number },
): Promise<Page<ReturnType<typeof present>>> {
  const access = await auth.access();
  const self = await auth.permissions();
  const where: Prisma.PendingFieldChangeWhereInput =
    view === 'mine'
      ? { requestedBy: access.userId }
      : {
          status: 'pending',
          subjectUserId: self.ctx.role?.isOwner
            ? { not: access.userId }
            : { in: [...self.ctx.teamUserIds] },
        };
  // Decider filtering needs the manager chain, so read a generous batch and filter.
  const rows = await auth.db.pendingFieldChange.findMany({
    where,
    select: SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  });
  // Page over the rows read, then drop ones this person doesn't decide, so a
  // filtered-out row never hides the next page.
  const windowed = toPage(rows, page.limit);
  const kept: Row[] = [];
  for (const r of windowed.items) {
    if (view === 'mine' || (await canDecide(data, self, auth.organisationId, r.subjectUserId))) {
      kept.push(r);
    }
  }
  return { items: kept.map((r) => present(access, r)), nextCursor: windowed.nextCursor };
}

/** How many changes this person may decide right now (for badges). */
export async function countToApprove(auth: AuthInfo, data: DataAccess): Promise<number> {
  const self = await auth.permissions();
  if (!self.ctx.role) return 0;
  const rows = await auth.db.pendingFieldChange.findMany({
    where: {
      status: 'pending',
      subjectUserId: self.ctx.role.isOwner
        ? { not: self.ctx.userId }
        : { in: [...self.ctx.teamUserIds] },
    },
    select: { subjectUserId: true },
    take: 200,
  });
  let n = 0;
  for (const r of rows) if (await canDecide(data, self, auth.organisationId, r.subjectUserId)) n++;
  return n;
}

async function loadForDecision(auth: AuthInfo, data: DataAccess, id: string) {
  const self = await auth.permissions();
  const row = await auth.db.pendingFieldChange.findFirst({ where: { id }, select: SELECT });
  if (!row) throw notFound('That change');
  if (!(await canDecide(data, self, auth.organisationId, row.subjectUserId))) {
    // The requester can see it in "mine", but only the approver decides.
    if (row.requester.id === self.ctx.userId) throw notAllowed('Your manager decides this change.');
    throw notFound('That change');
  }
  if (row.status !== 'pending') throw conflict('This change has already been decided.');
  return row;
}

const pick = (values: Record<string, unknown>, props: readonly string[]) =>
  Object.fromEntries(props.map((p) => [p, values[p] ?? null]));

export async function approveFieldChange(auth: AuthInfo, data: DataAccess, id: string, now: Date) {
  const access = await auth.access();
  const row = await loadForDecision(auth, data, id);
  const handler = fieldChangeHandler(row.moduleKey);
  const newValue = (row.newValue ?? {}) as Record<string, unknown>;
  const oldValue = (row.oldValue ?? {}) as Record<string, unknown>;
  const props = Object.keys(newValue);

  return withUnitOfWork(auth.db, auth.actor, async (uow) => {
    const record = await handler.load(uow.tx, row.recordId);
    if (!record) throw notFound('That record');
    // Addition f: never overwrite a value that changed after the request.
    if (!isDeepStrictEqual(pick(record.values, props), pick(oldValue, props))) {
      await uow.tx.pendingFieldChange.update({
        where: { id: row.id },
        data: { status: 'out_of_date', decidedBy: access.userId, decidedAt: now },
        select: { id: true, subjectUserId: true, requestedBy: true },
      });
      return { status: 'out_of_date' as const };
    }
    await handler.apply(uow.tx, row.recordId, newValue);
    await uow.tx.pendingFieldChange.update({
      where: { id: row.id },
      data: { status: 'approved', decidedBy: access.userId, decidedAt: now },
      select: { id: true, subjectUserId: true, requestedBy: true },
    });
    uow.audit({
      action: 'field_change.approved',
      entityType: row.moduleKey,
      entityId: row.recordId,
      before: { [row.fieldKey]: oldValue },
      after: { [row.fieldKey]: newValue },
    });
    return { status: 'approved' as const };
  });
}

export async function rejectFieldChange(
  auth: AuthInfo,
  data: DataAccess,
  id: string,
  reason: string | null,
  now: Date,
) {
  const access = await auth.access();
  const row = await loadForDecision(auth, data, id);
  await withUnitOfWork(auth.db, auth.actor, async (uow) => {
    await uow.tx.pendingFieldChange.update({
      where: { id: row.id },
      data: { status: 'rejected', decidedBy: access.userId, decidedAt: now, reason },
      select: { id: true, subjectUserId: true, requestedBy: true },
    });
    uow.audit({
      action: 'field_change.rejected',
      entityType: row.moduleKey,
      entityId: row.recordId,
      after: { field: row.fieldKey, reason },
    });
  });
  return { status: 'rejected' as const };
}
