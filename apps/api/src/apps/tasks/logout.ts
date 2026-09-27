import type { Request } from 'express';
import { z } from 'zod';
import {
  blocksLogoutNow,
  idSchema,
  localDate,
  OPEN_STATUSES,
  releaseInputSchema,
  releaseRequestInputSchema,
} from '@kidzonia/shared';
import type { Access, Blocking, IsoDate } from '@kidzonia/shared';
import { withUnitOfWork } from '../../db/index.js';
import type { ScopedTx } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import type { GuardSubject, Hooks, LogoutBlock } from '../../core/hooks.js';
import { emit } from '../../core/outbox.js';
import type { AuthInfo } from '../../http/types.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { AppError, businessRule, notAllowed, notFound } from '../../lib/errors.js';
import { requireWritable } from '../../core/guards.js';
import { userFacts } from '../../core/users/facts.js';
import { authOf } from '../../core/users/routes.js';
import { fromIsoDate, toIsoDate } from './calendars.js';
import { chainOf, canWork, loadPeople } from './people.js';
import { parseSnapshot } from './records.js';

/**
 * The logout block (brief 9.7, Phase 4 addition a). A blocking copy stops its
 * person logging out from `logoutBlockLeadMinutes` before its deadline (and
 * after it) until it's submitted. Blocking work left open from an earlier
 * day also refuses other writes outside Tasks. Three escape hatches: ask for
 * release, release for a date, cancel or defer the copy.
 */

/** Asking for release is limited per person per day (Phase 4 answer 4). */
export const RELEASE_REQUESTS_PER_DAY = 3;

interface OrgClock {
  timezone: string;
  lead: number;
}

async function orgClock(db: ScopedTx): Promise<OrgClock> {
  const o = await db.organisation.findFirstOrThrow({
    select: { timezone: true, logoutBlockLeadMinutes: true },
  });
  return { timezone: o.timezone, lead: o.logoutBlockLeadMinutes };
}

/** Dates with open blocking work for one person, oldest first, with what blocks each. */
export async function blockingFor(
  db: ScopedTx,
  userId: string,
  now: Date,
): Promise<{ date: IsoDate; tasks: { title: string; path: string }[] }[]> {
  const clock = await orgClock(db);
  const today = localDate(now, clock.timezone);
  const [copies, releases] = await Promise.all([
    db.taskAssignment.findMany({
      where: {
        userId,
        blocksLogout: true,
        status: { in: [...OPEN_STATUSES] },
        serviceDate: { lte: fromIsoDate(today) },
      },
      select: {
        id: true,
        taskId: true,
        serviceDate: true,
        dueAt: true,
        status: true,
        blocksLogout: true,
        snapshot: true,
      },
      orderBy: [{ serviceDate: 'asc' }, { dueAt: 'asc' }],
    }),
    db.logoutRelease.findMany({ where: { userId }, select: { serviceDate: true } }),
  ]);
  const released = new Set(releases.map((r) => toIsoDate(r.serviceDate)));
  const byDate = new Map<IsoDate, { title: string; path: string }[]>();
  for (const c of copies) {
    const serviceDate = toIsoDate(c.serviceDate);
    if (!blocksLogoutNow({ ...c, serviceDate }, today, now, clock.lead, released)) continue;
    const list = byDate.get(serviceDate) ?? [];
    list.push({
      title: parseSnapshot(c.snapshot).title,
      path: `/tasks?task=${c.taskId}&copy=${c.id}`,
    });
    byDate.set(serviceDate, list);
  }
  return [...byDate.entries()].map(([date, tasks]) => ({ date, tasks }));
}

/** Registered with Core: logout refuses (409) while any blocking work is open. */
function logoutGuard(deps: AppDeps) {
  return async (s: GuardSubject): Promise<LogoutBlock[]> => {
    const db = deps.data.forOrganisation(s.organisationId);
    const dates = await blockingFor(db, s.userId, s.now);
    return dates.flatMap((d) => d.tasks);
  };
}

/** Other writes refuse while blocking work from an earlier day is still open (they walked out). */
function writeGuard(deps: AppDeps) {
  return async (s: GuardSubject): Promise<string | null> => {
    const db = deps.data.forOrganisation(s.organisationId);
    const clock = await orgClock(db);
    const today = localDate(s.now, clock.timezone);
    const dates = await blockingFor(db, s.userId, s.now);
    const old = dates.filter((d) => d.date < today);
    if (old.length === 0) return null;
    const titles = old.flatMap((d) => d.tasks.map((t) => `“${t.title}”`)).join(', ');
    return `Please submit ${titles} from an earlier day first, or ask to be released.`;
  };
}

const registered = new WeakSet<Hooks>();
export function registerLogoutGuards(deps: AppDeps): void {
  if (registered.has(deps.hooks)) return;
  registered.add(deps.hooks);
  deps.hooks.logoutGuards.push(logoutGuard(deps));
  deps.hooks.writeGuards.push(writeGuard(deps));
}

/**
 * Who may release someone: reach over them with Tasks → Approve (release
 * comes with approve), or their reporting manager while the "can release
 * their team" switch is on. Never themselves.
 */
export function canRelease(
  access: Access,
  person: { id: string; homeSchoolId: string | null },
): boolean {
  return (
    !access.readOnly &&
    person.id !== access.userId &&
    access.can('tasks', 'release', userFacts(person))
  );
}

const idParam = (req: Request) => parse(z.object({ id: idSchema }), req.params).id;

async function person(auth: AuthInfo, id: string) {
  const p = await auth.db.user.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, homeSchoolId: true, fullName: true },
  });
  if (!p) throw notFound('That person');
  return p;
}

export function logoutRoutes(deps: AppDeps): RouteDef[] {
  registerLogoutGuards(deps);
  const route = (
    method: RouteDef['method'],
    path: string,
    handler: RouteDef['handler'],
  ): RouteDef => ({
    method,
    path,
    access: 'authenticated',
    guardWrites: false,
    handler,
  });

  return [
    // What stops me logging out (the logout screen).
    route('get', '/me/blocking', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      const dates = await blockingFor(auth.db, access.userId, deps.now());
      res.json({ dates, canRelease: false } satisfies Blocking);
    }),

    // Ask for release: tells the reporting manager (or the next one up, or an Owner).
    route('post', '/release-requests', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      requireWritable(access);
      const { note } = parse(releaseRequestInputSchema, req.body ?? {});
      const now = deps.now();
      const dates = await blockingFor(auth.db, auth.userId, now);
      if (dates.length === 0) throw businessRule('Nothing is stopping you logging out.');
      const clock = await orgClock(auth.db);
      const startOfDay = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const today = localDate(now, clock.timezone);
      const recent = await auth.db.releaseRequest.findMany({
        where: { userId: auth.userId, createdAt: { gte: startOfDay } },
        select: { createdAt: true },
      });
      const todays = recent.filter((r) => localDate(r.createdAt, clock.timezone) === today);
      if (todays.length >= RELEASE_REQUESTS_PER_DAY) {
        throw new AppError(
          'too_many_requests',
          `You can ask ${String(RELEASE_REQUESTS_PER_DAY)} times a day. Please speak to your manager.`,
        );
      }
      const people = await loadPeople(auth.db);
      const me = people.get(auth.userId);
      const managers = chainOf(people, auth.userId).filter((p) => canWork(p));
      const owners = [...people.values()].filter(
        (p) => p.isOwner && canWork(p) && p.id !== auth.userId,
      );
      const to = managers[0] ?? owners[0];
      if (!to || !me) throw businessRule('There’s no one to ask. Please speak to your school.');
      await withUnitOfWork(auth.db, auth.actor, async (uow) => {
        const row = await uow.tx.releaseRequest.create({
          data: { organisationId: auth.organisationId, userId: auth.userId, note, createdAt: now },
          select: { id: true },
        });
        await emit(uow.tx, auth.organisationId, [
          {
            event: 'logout_release_requested',
            recipientUserId: to.id,
            entityType: 'user',
            entityId: auth.userId,
            dedupeKey: `logout_release_requested:${row.id}`,
            payload: { note, dates: dates.map((d) => d.date), fullName: me.fullName },
          },
        ]);
        uow.audit({
          action: 'logout.release_requested',
          entityType: 'user',
          entityId: auth.userId,
          after: { note, askedOf: to.id, dates: dates.map((d) => d.date) },
        });
      });
      res.status(201).json({ askedOf: { id: to.id, fullName: to.fullName } });
    }),

    // Every date the person still has open blocking work (the release screen).
    route('get', '/users/:id/blocking', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      const p = await person(auth, idParam(req));
      if (!access.can('tasks', 'view', userFacts(p)) && !canRelease(access, p)) {
        throw notFound('That person');
      }
      const dates = await blockingFor(auth.db, p.id, deps.now());
      res.json({ dates, canRelease: canRelease(access, p) } satisfies Blocking);
    }),

    // Release for one or more dates: one release row and one audit entry per date.
    route('post', '/users/:id/release', async (req, res) => {
      const auth = authOf(req);
      const access = await auth.access();
      requireWritable(access);
      const p = await person(auth, idParam(req));
      if (!canRelease(access, p)) {
        if (!access.can('tasks', 'view', userFacts(p))) throw notFound('That person');
        throw notAllowed('You can’t release this person.');
      }
      const input = parse(releaseInputSchema, req.body);
      const now = deps.now();
      const open = new Set((await blockingFor(auth.db, p.id, now)).map((d) => d.date));
      const dates = [...new Set(input.dates)].filter((d) => open.has(d));
      if (dates.length === 0) {
        throw businessRule('Nothing is blocking on those dates any more.');
      }
      await withUnitOfWork(auth.db, auth.actor, async (uow) => {
        for (const date of dates) {
          const row = await uow.tx.logoutRelease.create({
            data: {
              organisationId: auth.organisationId,
              userId: p.id,
              serviceDate: fromIsoDate(date),
              releasedBy: access.userId,
              reason: input.reason,
            },
            select: { id: true },
          });
          uow.audit({
            action: 'logout.released',
            entityType: 'user',
            entityId: p.id,
            after: { date, reason: input.reason, releaseId: row.id },
          });
          await emit(uow.tx, auth.organisationId, [
            {
              event: 'released_for_today',
              recipientUserId: p.id,
              entityType: 'user',
              entityId: p.id,
              dedupeKey: `released_for_today:${p.id}:${date}`,
              payload: { date, by: access.userId },
            },
          ]);
        }
      });
      const left = await blockingFor(auth.db, p.id, now);
      res.json({ dates: left, canRelease: true } satisfies Blocking);
    }),
  ];
}
