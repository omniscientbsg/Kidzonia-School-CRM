import { registry } from '@kidzonia/shared';
import { IconLock, IconTools } from '@tabler/icons-react';
import { useLocation } from 'react-router';
import { useMeData } from '../shell/AppLayout';
import { NotFoundPage } from './NotFoundPage';

/**
 * Every page an app declares in the registry. Access comes from the same
 * navigation the menus use, so a page missing from someone's menu can't be
 * opened by typing its address either (and the API checks again).
 * Pages whose features arrive in later phases say so plainly.
 */
export function ModulePage() {
  const { nav } = useMeData();
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, '') || '/';

  const page = nav.apps
    .flatMap((a) => a.groups.flatMap((g) => g.pages))
    .find((p) => p.path === path);
  if (!page) {
    const exists = registry.modules.some((m) => (m.pages ?? []).some((p) => p.path === path));
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
