import { accessFromMe, meSchema, registry } from '@kidzonia/shared';
import type { Access, Me, Navigation, PermissionContext } from '@kidzonia/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '../api/client';
import { useSession } from './session';

export const ME_QUERY_KEY = ['me'] as const;

export interface MeData {
  me: Me;
  /** What this person may see and do; during a preview, limited to both people. */
  access: Access;
  ctx: PermissionContext;
  nav: Navigation;
}

/**
 * Who is signed in and what they may see. Menus and buttons are computed with
 * the same shared permission functions the server uses; the server still
 * checks every request.
 */
export function useMe() {
  const { state } = useSession();
  const query = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => api('/me', meSchema),
    enabled: state === 'signed_in',
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const data = useMemo<MeData | undefined>(() => {
    if (!query.data) return undefined;
    const access = accessFromMe(query.data, registry);
    return { me: query.data, access, ctx: access.primary, nav: access.navigation() };
  }, [query.data]);
  return { ...query, data };
}
