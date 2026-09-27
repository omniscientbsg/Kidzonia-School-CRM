import { registry } from '@kidzonia/shared';
import { IconLock, IconTools } from '@tabler/icons-react';
import type { ComponentType } from 'react';
import { useLocation } from 'react-router';
import { OrganisationPage } from '../settings/OrganisationPage';
import { RoleEditorPage } from '../settings/RoleEditorPage';
import { RolesPage } from '../settings/RolesPage';
import { SchoolsPage } from '../settings/SchoolsPage';
import { UsersPage } from '../settings/UsersPage';
import { useMeData } from '../shell/AppLayout';
import { NotFoundPage } from './NotFoundPage';
import { DayEndPage } from '../tasks/DayEndPage';
import { TaskSetupPage } from '../tasks/TaskSetupPage';
import { TasksPage } from '../tasks/TasksPage';

/** Pages built so far; every other registry page shows "still building". */
const BUILT: Record<string, ComponentType> = {
  '/settings/organisation': OrganisationPage,
  '/settings/schools': SchoolsPage,
  '/settings/users': UsersPage,
  '/settings/roles': RolesPage,
  '/tasks': TasksPage,
  '/tasks/assigned': TasksPage,
  '/tasks/team': TasksPage,
  '/tasks/watching': TasksPage,
  '/tasks/approvals': TasksPage,
  '/tasks/setup': TaskSetupPage,
  '/tasks/day-end': DayEndPage,
};

/** Sub-pages that belong to a registry page (e.g. one role inside Roles). */
const SUB_PAGES: { pattern: RegExp; parent: string; component: ComponentType }[] = [
  {
    pattern: /^\/settings\/roles\/[0-9a-f-]{36}$/,
    parent: '/settings/roles',
    component: RoleEditorPage,
  },
];

/**
 * Every page an app declares in the registry. Access comes from the same
 * navigation the menus use, so a page missing from someone's menu can't be
 * opened by typing its address either (and the API checks again).
 */
export function ModulePage() {
  const { nav } = useMeData();
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, '') || '/';
  const sub = SUB_PAGES.find((s) => s.pattern.test(path));
  const lookup = sub?.parent ?? path;

  const page = nav.apps
    .flatMap((a) => a.groups.flatMap((g) => g.pages))
    .find((p) => p.path === lookup);
  if (!page) {
    const exists = registry.modules.some((m) => (m.pages ?? []).some((p) => p.path === lookup));
    if (!exists) return <NotFoundPage />;
    return (
      <div className="noaccess">
        <div className="big" aria-hidden="true">
          <IconLock size={30} stroke={1.8} />
        </div>
        <h1>You don’t have access to this page</h1>
        <p>Ask your admin if you think you should.</p>
      </div>
    );
  }

  const Built = sub?.component ?? BUILT[path];
  if (Built) return <Built />;
  return (
    <>
      <div className="pagehead">
        <h1>{page.label}</h1>
      </div>
      <section className="panel empty-state">
        <IconTools size={28} stroke={1.6} aria-hidden="true" />
        <p>We’re still building this page. It will appear here soon.</p>
      </section>
    </>
  );
}
