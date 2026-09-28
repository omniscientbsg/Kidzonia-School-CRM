import { Button, Loader, Stack, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { IconEye } from '@tabler/icons-react';
import { useEffect } from 'react';
import { currentPreview, setPreview } from '../api/client';
import { Navigate, Outlet, useLocation, useOutletContext } from 'react-router';
import { useSession } from '../auth/session';
import { useMe } from '../auth/use-me';
import type { MeData } from '../auth/use-me';
import { LAST_ORGANISATION_KEY, writeLocal } from '../lib/storage';
import { AccountReadyPage } from '../pages/AccountReadyPage';
import { DemoBanner } from '../ui/DemoBanner';
import { SubNav } from './SubNav';
import { TopBar } from './TopBar';

export function FullPageLoader({ label }: { label: string }) {
  return (
    <div className="fullpage" role="status" aria-live="polite">
      <Loader />
      <Text c="dimmed">{label}</Text>
    </div>
  );
}

/** The signed-in frame: top bar, the current app's left menu, and the page. */
export function AppLayout() {
  const { state } = useSession();
  const location = useLocation();
  const me = useMe();

  const qc = useQueryClient();
  const organisationId = me.data?.me.organisation.id;
  const previewing = me.data?.me.preview ?? null;
  useEffect(() => {
    if (organisationId && !previewing) writeLocal(LAST_ORGANISATION_KEY, organisationId);
  }, [organisationId, previewing]);
  // A preview that stopped being allowed (e.g. the person was deactivated) ends quietly.
  useEffect(() => {
    if (me.isError && currentPreview()) {
      setPreview(null);
      void qc.resetQueries();
    }
  }, [me.isError, qc]);
  const exitPreview = () => {
    setPreview(null);
    void qc.resetQueries();
  };

  if (state === 'restoring') return <FullPageLoader label="Opening Kidzonia 360…" />;
  if (state === 'signed_out') {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login${next === '%2F' ? '' : `?next=${next}`}`} replace />;
  }
  if (me.isError && !me.data) {
    return (
      <div className="fullpage">
        <Stack align="center">
          <Text>We couldn’t load your account. Check your connection and try again.</Text>
          <Button onClick={() => void me.refetch()}>Try again</Button>
        </Stack>
      </div>
    );
  }
  if (!me.data) return <FullPageLoader label="Loading your account…" />;

  const data = me.data;
  const section = location.pathname.split('/')[1] ?? '';
  const appNav = data.nav.apps.find((a) => a.app.key === section && a.groups.length > 0);

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <DemoBanner />
      {data.me.preview && (
        <div className="preview-banner" role="status">
          <IconEye size={18} aria-hidden="true" />
          <span className="grow">
            Previewing as {data.me.user.fullName} ({data.me.role?.roleName ?? 'no role'}). You see
            only what you are both allowed to see. Nothing can be changed.
          </span>
          <Button size="xs" variant="white" onClick={exitPreview}>
            Exit preview
          </Button>
        </div>
      )}
      <TopBar data={data} />
      <div className={appNav ? 'body' : 'body full'}>
        {data.nav.hasAccess && appNav && <SubNav app={appNav} />}
        <main className="page" id="main" tabIndex={-1}>
          {data.nav.hasAccess ? <Outlet context={data} /> : <AccountReadyPage data={data} />}
        </main>
      </div>
    </>
  );
}

/** Pages read the signed-in data from the layout instead of fetching it again. */
export function useMeData(): MeData {
  return useOutletContext<MeData>();
}
