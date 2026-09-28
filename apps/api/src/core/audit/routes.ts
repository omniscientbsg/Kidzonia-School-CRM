import {
  AUDIT_AREA_KEYS,
  addDays,
  auditLogQuerySchema,
  auditPrefixesOf,
  toPage,
  zonedInstant,
} from '@kidzonia/shared';
import type { AuditLogQuery } from '@kidzonia/shared';
import type { Prisma, ScopedTx } from '../../db/index.js';
import type { AppDeps } from '../../deps.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { notAllowed } from '../../lib/errors.js';
import { authOf } from '../users/routes.js';
import { idsIn, present } from './present.js';
import type { Names, StoredEntry } from './present.js';

/** SQL filters for the screen's choices; days are whole days in the organisation's zone. */
function whereOf(q: AuditLogQuery, timezone: string): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (q.actorUserId) and.push({ actorUserId: q.actorUserId });
  if (q.action) and.push({ action: q.action });
  if (q.area === 'other') {
    // Anything no named area claims, e.g. actions added after this screen.
    const claimed = AUDIT_AREA_KEYS.filter((a) => a !== 'other').flatMap(auditPrefixesOf);
    and.push(...claimed.map((p) => ({ NOT: { action: { startsWith: p } } })));
  } else if (q.area) {
    and.push({ OR: auditPrefixesOf(q.area).map((p) => ({ action: { startsWith: p } })) });
  }
  if (q.from) and.push({ createdAt: { gte: zonedInstant(q.from, '00:00', timezone) } });
  if (q.to) and.push({ createdAt: { lt: zonedInstant(addDays(q.to, 1), '00:00', timezone) } });
  return { AND: and };
}

/**
 * One query per table for every name a page of entries mentions, whatever
 * the page size. Deleted records are included: the log outlives them.
 */
async function loadNames(db: ScopedTx, rows: StoredEntry[], organisation: string): Promise<Names> {
  const set = new Set<string>();
  for (const r of rows) {
    set.add(r.entityId);
    idsIn(r.before, set);
    idsIn(r.after, set);
  }
  const ids = { in: [...set] };
  const [roles, users, schools, holidays, forms, tasks, copies] = await Promise.all([
    db.role.findMany({ where: { id: ids }, select: { id: true, name: true } }),
    db.user.findMany({ where: { id: ids }, select: { id: true, fullName: true } }),
    db.school.findMany({ where: { id: ids }, select: { id: true, name: true } }),
    db.holiday.findMany({ where: { id: ids }, select: { id: true, name: true } }),
    db.dayEndForm.findMany({ where: { id: ids }, select: { id: true, name: true } }),
    db.task.findMany({ where: { id: ids }, select: { id: true, title: true } }),
    db.taskAssignment.findMany({
      where: { id: ids },
      select: { id: true, task: { select: { title: true } }, user: { select: { fullName: true } } },
    }),
  ]);
  const map = <T extends { id: string }>(list: T[], name: (x: T) => string) =>
    new Map(list.map((x) => [x.id, name(x)]));
  return {
    organisation,
    roles: map(roles, (r) => r.name),
    users: map(users, (u) => u.fullName),
    schools: map(schools, (s) => s.name),
    holidays: map(holidays, (h) => h.name),
    forms: map(forms, (f) => f.name),
    tasks: map(tasks, (t) => t.title),
    copies: map(copies, (c) => `“${c.task.title}” for ${c.user.fullName}`),
  };
}

/**
 * The audit log (brief 10.4, Phase 6 section 2). Owners only: it spans every
 * school and person, so no role or reach can open it. Organisation scoping
 * comes from the scoped client like every other read.
 */
export function auditRoutes(_deps: AppDeps): RouteDef[] {
  return [
    {
      method: 'get',
      path: '/audit-log',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        const access = await auth.access();
        // `primary` is the previewed person during a preview, so an Owner
        // previewing a principal is refused too.
        if (access.primary.role?.isOwner !== true) throw notAllowed();
        const q = parse(auditLogQuerySchema, req.query);
        const org = await auth.db.organisation.findFirstOrThrow({
          select: { name: true, timezone: true },
        });
        const rows = await auth.db.auditLog.findMany({
          where: whereOf(q, org.timezone),
          select: {
            id: true,
            createdAt: true,
            action: true,
            entityType: true,
            entityId: true,
            before: true,
            after: true,
            actor: { select: { id: true, fullName: true } },
          },
          // UUIDv7 ids break ties between rows written in the same millisecond.
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: q.limit + 1,
          ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        });
        const page = toPage(rows, q.limit);
        const names = await loadNames(auth.db, page.items, org.name);
        res.json({
          items: page.items.map((r) => present(r, names)),
          nextCursor: page.nextCursor,
        });
      },
    },
  ];
}
