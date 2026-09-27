import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { accessFromMe, registry } from '@kidzonia/shared';
import { describe, expect, it } from 'vitest';
import { RegisterPage } from '../auth/RegisterPage';
import { makeMe, renderWith, stubFetch } from '../test/render';
import type { MeData } from '../auth/use-me';
import { RoleEditorPage } from './RoleEditorPage';
import { UsersPage } from './UsersPage';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const person = {
  id: '0190a8f4-1b2c-7d3e-8f40-000000000009',
  fullName: 'Rohan Gupta',
  jobTitle: 'Teacher, KG 1',
  homeSchoolId: null,
  homeSchoolName: null,
  status: 'active',
  role: null,
  directReportsCount: 0,
};

/** A principal-like role that can view Users but whose role hides mobile numbers. */
function viewerHidingMobile(): MeData {
  const me = makeMe('teacher');
  me.role = {
    roleId: '0190a8f4-1b2c-7d3e-8f40-000000000003',
    roleName: 'Coordinator',
    isOwner: false,
    modules: { users: { actions: ['view'], reach: 'school' } },
    fields: { users: { mobile: { access: 'hidden', ownRecord: 'same', needsApproval: false } } },
  };
  const access = accessFromMe(me, registry);
  return { me, access, ctx: access.primary, nav: access.navigation() };
}

describe('Users page', () => {
  it('shows only the columns the role allows and flags people without a role', async () => {
    stubFetch((url) => {
      if (url.includes('/api/users/summary')) return json({ total: 1, waitingForRole: 1 });
      if (url.includes('/api/users')) return json({ items: [person], nextCursor: null });
      if (url.includes('/api/schools')) return json({ items: [], nextCursor: null });
      return undefined;
    });
    renderWith(<UsersPage />, { data: viewerHidingMobile() });
    expect(await screen.findByText('Rohan Gupta')).toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toContain('Name');
    expect(headers).not.toContain('Mobile');
    expect(screen.getByText('No access yet')).toBeInTheDocument();
    expect(await screen.findByText(/1 person is waiting for a role/)).toBeInTheDocument();
    // Viewing only: no Add user button.
    expect(screen.queryByRole('button', { name: 'Add user' })).toBeNull();
  });
});

describe('Registration', () => {
  it('won’t move on until the mobile number is verified', async () => {
    stubFetch();
    renderWith(<RegisterPage />, { path: '/register' });
    await userEvent.type(await screen.findByLabelText(/Full name/), 'Asha Kulkarni');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Verify your mobile number first.');
    const steps = screen.getByRole('list', { name: 'Sign-up steps' });
    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((s) => s.textContent),
    ).toEqual(['1About you', '2What you are setting up', '3Your organisation', '4Your schools']);
  });
});

describe('Role editor', () => {
  const roleId = '0190a8f4-1b2c-7d3e-8f40-000000000077';
  const role = {
    id: roleId,
    name: 'Coordinator',
    description: null,
    isOwner: false,
    peopleCount: 0,
    modulesOn: 0,
    modules: {},
    fields: {},
    canEdit: true,
  };

  it('ticks every action with "Select all" and clears them with "Clear"', async () => {
    stubFetch((url) => {
      if (url.endsWith(`/api/roles/${roleId}`)) return json(role);
      if (url.includes(`/api/roles/${roleId}/assignments`))
        return json({ items: [], nextCursor: null });
      return undefined;
    });
    const owner = makeMe('owner');
    const access = accessFromMe(owner, registry);
    renderWith(<RoleEditorPage />, {
      path: `/settings/roles/${roleId}`,
      route: 'settings/*',
      data: { me: owner, access, ctx: access.primary, nav: access.navigation() },
    });
    const actions = async () =>
      (await screen.findAllByRole('checkbox')).filter((c) =>
        ['View', 'Create', 'Edit', 'Delete', 'Assign to others', 'Approve work'].includes(
          c.getAttribute('aria-label') ?? '',
        ),
      );
    expect(await actions()).toHaveLength(6);
    expect((await actions()).every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect((await actions()).every((c) => (c as HTMLInputElement).checked)).toBe(true);
    expect(screen.getAllByText('6/6').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect((await actions()).every((c) => !(c as HTMLInputElement).checked)).toBe(true);
  });
});
