import { describe, expect, it } from 'vitest';
import { navigationFor } from '../src/permissions/index.js';
import type { Navigation } from '../src/permissions/index.js';
import {
  ctx,
  deptHeadRole,
  grant,
  ids,
  ownerRole,
  principalCtx,
  role,
  teacherCtx,
  teacherRole,
} from './fixtures.js';

const tabs = (n: Navigation) => n.apps.map((a) => a.app.key);
const menu = (n: Navigation, app: string) =>
  n.apps.find((a) => a.app.key === app)?.groups.flatMap((g) => g.pages.map((p) => p.label)) ?? [];

describe('navigation is built from permissions', () => {
  it('shows nothing to someone with no role', () => {
    const n = navigationFor(ctx({ role: null }));
    expect(n.hasAccess).toBe(false);
    expect(n.apps).toEqual([]);
  });

  it('shows nothing to a role that can view nothing', () => {
    expect(navigationFor(teacherCtx({ role: role({}) })).hasAccess).toBe(false);
  });

  it('gives the Owner every app with modules, HRMS as coming soon', () => {
    const n = navigationFor(ctx({ role: ownerRole }));
    expect(tabs(n)).toEqual(['tasks', 'hrms', 'settings']);
    expect(n.apps.find((a) => a.app.key === 'hrms')?.path).toBe('/apps/hrms');
    expect(menu(n, 'settings')).toEqual([
      'Organisation',
      'Audit log',
      'Schools',
      'Users',
      'Roles & permissions',
      'Parent contacts',
    ]);
    expect(n.apps[0]?.groups.map((g) => g.label)).toEqual(['Tasks', 'Track', 'Setup']);
  });

  it('shows the audit log only to Owners, whatever else a role can do (brief 10.4)', () => {
    const admin = navigationFor(
      ctx({
        role: {
          roleId: 'r',
          roleName: 'Everything but Owner',
          isOwner: false,
          modules: { organisation: { actions: ['view', 'edit'], reach: null } },
          fields: {},
        },
      }),
    );
    expect(menu(admin, 'settings')).toEqual(['Organisation']);
  });

  it('gives a teacher only their own task pages', () => {
    const n = navigationFor(teacherCtx());
    expect(tabs(n)).toEqual(['tasks', 'hrms']);
    expect(menu(n, 'tasks')).toEqual(['My tasks', 'Watching', 'Reports']);
    expect(n.apps[0]?.path).toBe('/tasks');
  });

  it('gives a principal team pages and approvals', () => {
    const n = navigationFor(principalCtx());
    expect(menu(n, 'tasks')).toEqual([
      'My tasks',
      'Assigned by me',
      'My team',
      'Watching',
      'Approvals',
      'Day-end reports',
      'Reports',
    ]);
    expect(menu(n, 'settings')).toEqual(['Users']);
  });

  it('changes when permissions change', () => {
    const before = navigationFor(teacherCtx());
    const after = navigationFor(
      teacherCtx({
        role: role({
          ...teacherRole.modules,
          roles: grant(['view']),
          dayend: grant(['view'], 'own'),
        }),
      }),
    );
    expect(tabs(before)).not.toContain('settings');
    expect(tabs(after)).toContain('settings');
    expect(menu(after, 'tasks')).toContain('Day-end reports');
  });

  it('shows team pages to reporting managers through automatic roles', () => {
    const n = navigationFor(teacherCtx({ teamUserIds: new Set([ids.teacherB]) }));
    expect(menu(n, 'tasks')).toEqual(['My tasks', 'My team', 'Watching', 'Approvals', 'Reports']);
  });

  it('never refers to a role by name', () => {
    const renamed = { ...deptHeadRole, roleName: 'Something else' };
    expect(navigationFor(ctx({ role: renamed }))).toEqual(
      navigationFor(ctx({ role: deptHeadRole })),
    );
  });
});
