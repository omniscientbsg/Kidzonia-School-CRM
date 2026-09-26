import { MantineProvider } from '@mantine/core';
import { accessFromMe, registry } from '@kidzonia/shared';
import type { Me } from '@kidzonia/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import { SessionProvider } from '../auth/session';
import type { MeData } from '../auth/use-me';
import { theme } from '../theme';

const id = (n: number) => `0190a8f4-1b2c-7d3e-8f40-${String(n).padStart(12, '0')}`;

const teacherModules = {
  tasks: { actions: ['view', 'edit'], reach: 'own' },
  task_reports: { actions: ['view'], reach: 'own' },
  hrms_staff: { actions: ['view'], reach: 'own' },
} satisfies NonNullable<Me['role']>['modules'];

export function makeMe(kind: 'owner' | 'teacher' | 'none'): Me {
  return {
    user: {
      id: id(1),
      fullName: kind === 'owner' ? 'Ananya Rao' : 'Priya Sharma',
      jobTitle: null,
      photoUrl: null,
      homeSchoolId: null,
      homeSchoolName: kind === 'owner' ? null : 'Jubilee Hills',
    },
    organisation: {
      id: id(2),
      name: 'Kidzonia Pre-schools',
      logoUrl: null,
      setupType: 'head_office',
      timezone: 'Asia/Kolkata',
    },
    role:
      kind === 'none'
        ? null
        : {
            roleId: id(3),
            roleName: kind === 'owner' ? 'Owner' : 'Teacher',
            isOwner: kind === 'owner',
            modules: kind === 'owner' ? {} : teacherModules,
            fields: {},
          },
    scope: { allSchools: kind === 'owner', schoolIds: [] },
    teamUserIds: [],
    managerSwitches: {},
    askForAccess:
      kind === 'none' ? { id: id(4), fullName: 'Meera Iyer', jobTitle: 'Principal' } : null,
    changesToApprove: 0,
    customLists: [],
    preview: null,
  };
}

export function meData(kind: 'owner' | 'teacher' | 'none'): MeData {
  const me = makeMe(kind);
  const access = accessFromMe(me, registry);
  return { me, access, ctx: access.primary, nav: access.navigation() };
}

/** Pretends the refresh cookie is missing, so the session starts signed out. */
export function stubFetch(handler?: (url: string, init?: RequestInit) => Response | undefined) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const custom = handler?.(url, init);
    return Promise.resolve(
      custom ??
        new Response(JSON.stringify({ error: { code: 'not_logged_in', message: 'x' } }), {
          status: 401,
        }),
    );
  });
}

export function renderWith(
  ui: ReactElement,
  opts: { path?: string; route?: string; data?: MeData } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const path = opts.path ?? '/';
  return render(
    // env="test" turns off transitions and portals, which jsdom can't lay out.
    <MantineProvider theme={theme} env="test">
      <QueryClientProvider client={client}>
        <SessionProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route element={<Outlet context={opts.data} />}>
                <Route path={opts.route ?? '*'} element={ui} />
              </Route>
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>
    </MantineProvider>,
  );
}
