import { registry } from '@kidzonia/shared';
import { Button } from '@mantine/core';
import { IconShieldCheck } from '@tabler/icons-react';
import { Link, Navigate, useParams } from 'react-router';
import { useMeData } from '../shell/AppLayout';
import { AppIcon } from '../shell/icons';
import { NotFoundPage } from './NotFoundPage';

/** An app that isn't built yet explains it will reuse the same people and roles. */
export function ComingSoonPage() {
  const { key } = useParams();
  const { nav } = useMeData();
  const app = registry.apps.find((a) => a.key === key);
  if (!app) return <NotFoundPage />;
  if (!app.comingSoon) {
    const live = nav.apps.find((a) => a.app.key === app.key);
    return live ? <Navigate to={live.path} replace /> : <NotFoundPage />;
  }
  const canSeeRoles = nav.apps.some((a) =>
    a.groups.some((g) => g.pages.some((p) => p.path === '/settings/roles')),
  );
  return (
    <div className="noaccess">
      <div className="big brand" aria-hidden="true">
        <AppIcon name={app.icon} size={30} />
      </div>
      <h1>{app.name} is coming next</h1>
      <p>
        {app.description}. It will use the same users, roles and field permissions you set up in
        Settings, so nothing needs to be set up twice.
      </p>
      {canSeeRoles && (
        <Button
          component={Link}
          to="/settings/roles"
          variant="default"
          mt="lg"
          leftSection={<IconShieldCheck size={16} />}
        >
          See how roles will control it
        </Button>
      )}
    </div>
  );
}
