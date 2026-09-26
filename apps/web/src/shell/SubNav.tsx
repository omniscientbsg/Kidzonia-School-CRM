import type { AppNav } from '@kidzonia/shared';
import { NavLink } from 'react-router';
import { AppIcon } from './icons';

/** An app's left menu. On phones CSS turns it into a sideways strip under the top bar. */
export function SubNav({ app }: { app: AppNav }) {
  return (
    <nav className="subnav" aria-label={`${app.app.name} menu`}>
      {app.groups.map((g) => (
        <div key={g.label} className="subnav-group">
          <h4>{g.label}</h4>
          {g.pages.map((p) => (
            <NavLink key={p.key} to={p.path} end className="nav">
              <AppIcon name={p.icon} />
              <span>{p.label}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
