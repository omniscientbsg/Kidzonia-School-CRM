import { z } from 'zod';
import type { SearchResults } from '@kidzonia/shared';
import type { AppDeps } from '../../deps.js';
import type { RouteDef } from '../../http/routes.js';
import { parse } from '../../http/validate.js';
import { userScopeWhere } from '../../core/users/facts.js';
import { authOf } from '../../core/users/routes.js';
import { visibleTaskWhere } from './facts.js';

/**
 * Top-bar search (brief 7.5): pages, tasks and people the person may see.
 * Visibility and hidden fields are applied in the query, before the limit
 * (Phase 5 a): a hidden title or name is never searched, so it can't be
 * found by guessing. Trigram indexes on titles and names keep it fast.
 */

const LIMIT = 5;

export function searchRoutes(_deps: AppDeps): RouteDef[] {
  return [
    {
      method: 'get',
      path: '/search',
      access: 'authenticated',
      handler: async (req, res) => {
        const auth = authOf(req);
        const access = await auth.access();
        const q = parse(z.object({ q: z.string().trim().min(2).max(80) }), req.query).q;
        const needle = q.toLowerCase();

        const pages = access
          .navigation()
          .apps.flatMap((a) => a.groups.flatMap((g) => g.pages))
          .filter((p) => p.label.toLowerCase().includes(needle))
          .slice(0, LIMIT)
          .map((p) => ({ label: p.label, path: p.path }));

        const titleSeen =
          access.can('tasks', 'view') && access.fieldAccess('tasks', 'title') !== 'hidden';
        const nameSeen =
          access.can('users', 'view') && access.fieldAccess('users', 'fullName') !== 'hidden';
        const [tasks, people] = await Promise.all([
          titleSeen
            ? auth.db.task.findMany({
                where: {
                  AND: [
                    {
                      kind: 'task',
                      cancelledAt: null,
                      title: { contains: q, mode: 'insensitive' },
                    },
                    visibleTaskWhere(access.scopes('tasks'), access.userId),
                  ],
                },
                select: { id: true, title: true },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: LIMIT,
              })
            : Promise.resolve([]),
          nameSeen
            ? auth.db.user.findMany({
                where: {
                  AND: [
                    { deletedAt: null, fullName: { contains: q, mode: 'insensitive' } },
                    ...access.scopes('users').map(userScopeWhere),
                  ],
                },
                select: {
                  id: true,
                  fullName: true,
                  jobTitle: true,
                  homeSchool: { select: { name: true } },
                },
                orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
                take: LIMIT,
              })
            : Promise.resolve([]),
        ]);
        const out: SearchResults = {
          pages,
          tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: null })),
          people: people.map((p) => ({
            id: p.id,
            fullName: p.fullName,
            jobTitle: p.jobTitle,
            schoolName: p.homeSchool?.name ?? null,
          })),
        };
        res.json(out);
      },
    },
  ];
}
