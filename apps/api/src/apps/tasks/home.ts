import {
  addDays,
  completionOf,
  localDate,
  OPEN_STATUSES,
  reachOf,
  REPEAT_LABEL,
  snapshotSections,
} from '@kidzonia/shared';
import type { Access, Completion, Home, SnapshotSection, TaskStatus } from '@kidzonia/shared';
import type { AppDeps } from '../../deps.js';
import type { AuthInfo } from '../../http/types.js';
import type { RouteDef } from '../../http/routes.js';
import type { Prisma, ScopedTx } from '../../db/index.js';
import { groupsFor, renderGroups } from '../../core/notifications/render.js';
import { userScopeWhere } from '../../core/users/facts.js';
import { authOf } from '../../core/users/routes.js';
import { fromIsoDate } from './calendars.js';
import { factsOfCopy, presentCopy } from './copies-core.js';
import { copyScopeWhere } from './facts.js';
import { feedFor } from './feed.js';
import { blockingFor } from './logout.js';
import { COPY_SELECT, loadChoices } from './records.js';

/**
 * Home (brief 7.3) in one call. Everything is counted in SQL (group by
 * school, person, status) rather than by loading rows, so an Owner's Home
 * stays fast with 1,000+ people (budget: 400 ms; tested). The snapshot comes
 * from permissions and reach (snapshotSections), never from a role's name.
 */

type StatusCount = { status: TaskStatus; _count: { _all: number } };

function tally(rows: readonly StatusCount[]): Completion {
  return completionOf(
    rows.flatMap((r) => Array<{ status: TaskStatus }>(r._count._all).fill({ status: r.status })),
  );
}

const narrowed = (scopes: Prisma.TaskAssignmentWhereInput[]) =>
  scopes.filter((w) => Object.keys(w).length > 0);

export class HomeService {
  constructor(private readonly deps: AppDeps) {}

  async home(auth: AuthInfo): Promise<Home> {
    const access = await auth.access();
    const self = await auth.permissions();
    const db = auth.db;
    const now = this.deps.now();
    const me = access.userId;
    const [org, user] = await Promise.all([
      db.organisation.findFirstOrThrow({ select: { timezone: true } }),
      db.user.findFirstOrThrow({
        where: { id: me },
        select: { fullName: true, department: true, homeSchool: { select: { name: true } } },
      }),
    ]);
    const today = localDate(now, org.timezone);
    const todayDate = fromIsoDate(today);
    const [attention, schoolsInScope, setsAcross] = await Promise.all([
      this.attention(db, access, now, today),
      this.schoolsInScope(db, access),
      this.setsTasksAcrossSchools(db, me),
    ]);
    const team = [...self.ctx.teamUserIds];
    const sections = snapshotSections(access.primary, {
      scopeSchools: schoolsInScope.length,
      hasTeam: team.length > 0,
      setsTasksAcrossSchools: setsAcross,
    });

    const out: Home = {
      greeting: {
        firstName: user.fullName.split(' ')[0] ?? user.fullName,
        summary: '',
        date: today,
      },
      attention,
      sections,
      feed: [],
      notifications: [],
      myTasks: [],
    };
    const jobs: Promise<void>[] = [];
    if (sections.includes('schools')) {
      jobs.push(
        this.schools(db, schoolsInScope, todayDate).then((s) => {
          out.schools = s;
        }),
      );
    }
    if (sections.includes('set_tasks')) {
      jobs.push(
        this.setTasks(db, access, me, today).then((s) => {
          out.setTasks = s;
        }),
      );
    }
    if (sections.includes('team')) {
      jobs.push(
        this.team(db, access, team, todayDate).then((s) => {
          out.team = s;
        }),
      );
    }
    if (sections.includes('today')) {
      jobs.push(
        this.today(db, access, todayDate).then((s) => {
          out.today = s;
        }),
      );
    }
    jobs.push(
      feedFor(db, this.deps.hooks, access, 8, org.timezone).then((f) => {
        out.feed = f;
      }),
      // The bell's list is never narrowed by the school switcher.
      groupsFor(db, me, 0, 6).then(async ({ rows }) => {
        out.notifications = await renderGroups(db, this.deps.hooks, access, rows);
      }),
      this.myTasks(db, access, 4).then((t) => {
        out.myTasks = t;
      }),
    );
    await Promise.all(jobs);
    out.greeting.summary = this.summary(sections, schoolsInScope.length, access, user, out);
    return out;
  }

  private summary(
    sections: SnapshotSection[],
    schools: number,
    access: Access,
    user: { department: string | null; homeSchool: { name: string } | null },
    home: Home,
  ): string {
    if (sections.includes('schools')) {
      return access.primary.role?.isOwner || access.primary.scope.allSchools
        ? `Here’s what’s happening across your ${String(schools)} schools.`
        : `Here’s how your ${String(schools)} schools are doing today.`;
    }
    if (sections.includes('set_tasks')) {
      return user.department
        ? `${user.department} work across your schools.`
        : 'Your tasks across your schools.';
    }
    if (sections.includes('team')) {
      return user.homeSchool ? `Here’s ${user.homeSchool.name} today.` : 'Here’s your team today.';
    }
    const left = home.today
      ? home.today.progress.total - home.today.progress.done - home.today.progress.submitted
      : 0;
    return left > 0
      ? `${String(left)} ${left === 1 ? 'thing' : 'things'} left today.`
      : 'You’re done for today.';
  }

  private async attention(
    db: ScopedTx,
    access: Access,
    now: Date,
    today: string,
  ): Promise<Home['attention']> {
    const me = access.userId;
    const todayDate = fromIsoDate(today);
    const cards: Home['attention'] = [];
    const blocking = (await blockingFor(db, me, now)).reduce((n, d) => n + d.tasks.length, 0);
    if (blocking) {
      cards.push({
        key: 'blocking',
        count: blocking,
        label: 'to submit before you log out',
        path: '/tasks',
        hot: true,
      });
    }
    // Your own approvals are never narrowed by the school switcher (answer 5).
    const approvals = await db.taskAssignment.count({
      where: { approverUserId: me, status: 'submitted' },
    });
    if (approvals) {
      cards.push({
        key: 'approvals',
        count: approvals,
        label: 'waiting for your approval',
        path: '/tasks/approvals',
        hot: false,
      });
    }
    const taskScopes = narrowed(access.scopes('tasks').map(copyScopeWhere));
    // Team reach or wider, or the "sees their team" automatic role with people under them.
    const ctx = access.primary;
    const seesTeam =
      (reachOf(ctx, 'tasks') ?? 'own') !== 'own' ||
      (ctx.teamUserIds.size > 0 && (ctx.managerSwitches.manager_sees_team_tasks ?? true));
    if (seesTeam) {
      const overdue = await db.taskAssignment.count({
        where: {
          AND: [{ status: 'overdue', userId: { not: me }, task: { kind: 'task' } }, ...taskScopes],
        },
      });
      if (overdue) {
        cards.push({
          key: 'team_overdue',
          count: overdue,
          label: 'overdue in your team',
          path: '/tasks/team',
          hot: true,
        });
      }
    }
    if (access.can('dayend', 'view')) {
      const dayScopes = narrowed(access.scopes('dayend').map(copyScopeWhere));
      const missing = await db.taskAssignment.count({
        where: {
          AND: [
            {
              task: { kind: 'day_end' },
              serviceDate: todayDate,
              userId: { not: me },
              status: { in: [...OPEN_STATUSES] },
            },
            ...dayScopes,
          ],
        },
      });
      if (missing) {
        cards.push({
          key: 'day_end',
          count: missing,
          label: 'day-end reports not in yet',
          path: '/tasks/day-end',
          hot: false,
        });
      }
    }
    if (access.can('users', 'view')) {
      const waiting = await db.user.count({
        where: {
          AND: [
            { deletedAt: null, status: { not: 'inactive' }, roleAssignment: null },
            ...access.scopes('users').map(userScopeWhere),
          ],
        },
      });
      if (waiting) {
        cards.push({
          key: 'waiting_for_role',
          count: waiting,
          label: waiting === 1 ? 'person waiting for a role' : 'people waiting for a role',
          path: '/settings/users',
          hot: false,
        });
      }
    }
    return cards.slice(0, 4);
  }

  /** Schools in scope, after the school switcher. */
  private async schoolsInScope(db: ScopedTx, access: Access) {
    const ctx = access.primary;
    const all = ctx.role?.isOwner === true || ctx.scope.allSchools;
    const filter = access.schoolFilter;
    return db.school.findMany({
      where: {
        deletedAt: null,
        ...(filter ? { id: filter } : all ? {} : { id: { in: [...ctx.scope.schoolIds] } }),
      },
      select: { id: true, name: true, type: true, principal: { select: { fullName: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  private async setsTasksAcrossSchools(db: ScopedTx, me: string): Promise<boolean> {
    const rows = await db.taskAssignment.groupBy({
      by: ['schoolId'],
      where: { task: { createdBy: me, cancelledAt: null, kind: 'task' }, schoolId: { not: null } },
      orderBy: { schoolId: 'asc' },
      take: 2,
    });
    return rows.length > 1;
  }

  private async schools(
    db: ScopedTx,
    schools: Awaited<ReturnType<HomeService['schoolsInScope']>>,
    day: Date,
  ) {
    const ids = schools.map((s) => s.id);
    const [tasks, dayEnd] = await Promise.all([
      db.taskAssignment.groupBy({
        by: ['schoolId', 'status'],
        where: { schoolId: { in: ids }, serviceDate: day, task: { kind: 'task' } },
        _count: { _all: true },
      }),
      db.taskAssignment.groupBy({
        by: ['schoolId', 'status'],
        where: { schoolId: { in: ids }, serviceDate: day, task: { kind: 'day_end' } },
        _count: { _all: true },
      }),
    ]);
    return schools
      .map((s) => {
        const d = tally(dayEnd.filter((r) => r.schoolId === s.id));
        return {
          id: s.id,
          name: s.name,
          type: s.type,
          principal: s.principal?.fullName ?? null,
          progress: tally(tasks.filter((r) => r.schoolId === s.id)),
          dayEnd: { done: d.done + d.submitted, total: d.total },
        };
      })
      .sort((a, b) => pct(a.progress) - pct(b.progress));
  }

  /** "Tasks you've set": each live task's current copies, by school. */
  private async setTasks(db: ScopedTx, access: Access, me: string, today: string) {
    const tasks = await db.task.findMany({
      where: { createdBy: me, cancelledAt: null, kind: 'task' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 6,
      select: { id: true, title: true, repeat: true },
    });
    const scopes = narrowed(access.scopes('tasks').map(copyScopeWhere));
    const rows = await db.taskAssignment.groupBy({
      by: ['taskId', 'schoolId', 'serviceDate', 'status'],
      where: {
        AND: [
          { taskId: { in: tasks.map((t) => t.id) } },
          {
            serviceDate: {
              gte: fromIsoDate(addDays(today, -6)),
              lte: fromIsoDate(addDays(today, 6)),
            },
          },
          ...scopes,
        ],
      },
      _count: { _all: true },
    });
    const schoolIds = [
      ...new Set(rows.map((r) => r.schoolId).filter((x): x is string => x !== null)),
    ];
    const schools = await db.school.findMany({
      where: { id: { in: schoolIds } },
      select: { id: true, name: true },
    });
    const todayMs = fromIsoDate(today).getTime();
    return tasks.map((t) => {
      const own = rows.filter((r) => r.taskId === t.id);
      // The date that represents "now": the latest up to today, else the next one.
      const dates = [...new Set(own.map((r) => r.serviceDate.getTime()))].sort((a, b) => a - b);
      const past = dates.filter((d) => d <= todayMs);
      const at = past.length ? past[past.length - 1] : dates[0];
      const current = own.filter((r) => r.serviceDate.getTime() === at);
      const bySchool = [...new Set(current.map((r) => r.schoolId))].map((sid) => {
        const c = tally(current.filter((r) => r.schoolId === sid));
        return {
          schoolName: schools.find((s) => s.id === sid)?.name ?? 'Head office',
          done: c.done + c.submitted,
          total: c.total,
        };
      });
      return { taskId: t.id, title: t.title, repeat: REPEAT_LABEL[t.repeat], bySchool };
    });
  }

  private async team(db: ScopedTx, access: Access, team: string[], day: Date) {
    const people = await db.user.findMany({
      where: {
        id: { in: team },
        deletedAt: null,
        status: { not: 'inactive' },
        ...(access.schoolFilter ? { homeSchoolId: access.schoolFilter } : {}),
      },
      select: { id: true, fullName: true, jobTitle: true, homeSchool: { select: { name: true } } },
      orderBy: [{ fullName: 'asc' }],
    });
    const ids = people.map((p) => p.id);
    const [tasks, dayEnd] = await Promise.all([
      db.taskAssignment.groupBy({
        by: ['userId', 'status'],
        where: { userId: { in: ids }, serviceDate: day, task: { kind: 'task' } },
        _count: { _all: true },
      }),
      db.taskAssignment.findMany({
        where: { userId: { in: ids }, serviceDate: day, task: { kind: 'day_end' } },
        select: { userId: true, status: true },
      }),
    ]);
    return people.map((p) => {
      const d = dayEnd.find((x) => x.userId === p.id);
      return {
        person: {
          id: p.id,
          fullName: p.fullName,
          jobTitle: p.jobTitle,
          schoolName: p.homeSchool?.name ?? null,
        },
        progress: tally(tasks.filter((r) => r.userId === p.id)),
        dayEnd: d
          ? ['done', 'approved', 'submitted'].includes(d.status)
            ? ('in' as const)
            : ('due' as const)
          : null,
      };
    });
  }

  private async today(db: ScopedTx, access: Access, day: Date) {
    const rows = await db.taskAssignment.findMany({
      where: { userId: access.userId, serviceDate: day },
      select: COPY_SELECT,
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: 50,
    });
    const choices = await loadChoices(
      db,
      rows.map((r) => r.task.customValues),
    );
    const visible = rows.filter((c) => access.can('tasks', 'view', factsOfCopy(c)));
    return {
      progress: completionOf(visible),
      items: visible.map((c) => presentCopy(access, c, choices)) as Home['myTasks'],
    };
  }

  private async myTasks(db: ScopedTx, access: Access, limit: number) {
    const rows = await db.taskAssignment.findMany({
      where: { userId: access.userId, status: { in: [...OPEN_STATUSES] } },
      select: COPY_SELECT,
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    const choices = await loadChoices(
      db,
      rows.map((r) => r.task.customValues),
    );
    return rows
      .filter((c) => access.can('tasks', 'view', factsOfCopy(c)))
      .map((c) => presentCopy(access, c, choices)) as Home['myTasks'];
  }
}

const pct = (c: Completion) => (c.total ? (c.done + c.submitted) / c.total : 1);

export function homeRoutes(deps: AppDeps): RouteDef[] {
  const home = new HomeService(deps);
  return [
    {
      method: 'get',
      path: '/home',
      access: 'authenticated',
      handler: async (req, res) => {
        res.json(await home.home(authOf(req)));
      },
    },
  ];
}
