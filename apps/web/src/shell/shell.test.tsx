import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { AccountReadyPage } from '../pages/AccountReadyPage';
import { ModulePage } from '../pages/ModulePage';
import { meData, renderWith, stubFetch } from '../test/render';
import { SubNav } from './SubNav';
import { TopBar } from './TopBar';

beforeEach(() => {
  stubFetch();
});

const tabNames = () =>
  within(screen.getByRole('navigation', { name: 'Apps' }))
    .getAllByRole('link')
    .map((l) => l.textContent);

describe('top bar', () => {
  it('shows the Owner every app tab', () => {
    renderWith(<TopBar data={meData('owner')} />);
    expect(tabNames()).toEqual(['Home', 'Tasks', 'HRMS', 'Settings']);
  });

  it('shows a teacher only the tabs their role allows', () => {
    renderWith(<TopBar data={meData('teacher')} />);
    expect(tabNames()).toEqual(['Home', 'Tasks', 'HRMS']);
  });

  it('shows no app tabs or launcher to someone without a role', () => {
    renderWith(<TopBar data={meData('none')} />);
    expect(screen.queryByRole('navigation', { name: 'Apps' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'All apps' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Your profile' })).toBeInTheDocument();
  });

  it('opens the profile menu with name, role and log out', async () => {
    renderWith(<TopBar data={meData('teacher')} />);
    await userEvent.click(screen.getByRole('button', { name: 'Your profile' }));
    expect(await screen.findByText('Teacher, Jubilee Hills')).toBeInTheDocument();
    expect(await screen.findByRole('menuitem', { name: 'Log out' })).toBeInTheDocument();
  });

  it('lists every app in the launcher, marking the ones not built yet', async () => {
    renderWith(<TopBar data={meData('owner')} />);
    await userEvent.click(screen.getByRole('button', { name: 'All apps' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Tasks',
      'HRMSComing soon',
      'AdmissionsComing soon',
      'FeesComing soon',
      'Parent communicationComing soon',
      'AttendanceComing soon',
      'Settings',
    ]);
  });
});

describe('left menu', () => {
  it('groups a teacher’s task pages', () => {
    const data = meData('teacher');
    const tasks = data.nav.apps.find((a) => a.app.key === 'tasks');
    if (!tasks) throw new Error('no tasks app');
    renderWith(<SubNav app={tasks} />, { path: '/tasks' });
    const links = within(screen.getByRole('navigation', { name: 'Tasks menu' })).getAllByRole(
      'link',
    );
    expect(links.map((l) => l.textContent)).toEqual(['My tasks', 'Watching', 'Reports']);
    expect(links[0]).toHaveAttribute('aria-current', 'page');
  });
});

describe('pages', () => {
  it('tells someone without a role who to ask', () => {
    renderWith(<AccountReadyPage data={meData('none')} />);
    expect(screen.getByRole('heading', { name: 'Your account is ready' })).toBeInTheDocument();
    expect(screen.getByText('Ask Meera to give you a role')).toBeInTheDocument();
  });

  it('refuses a page missing from the person’s menu, even by address', () => {
    renderWith(<ModulePage />, { path: '/tasks/approvals', data: meData('teacher') });
    expect(
      screen.getByRole('heading', { name: 'You don’t have access to this page' }),
    ).toBeInTheDocument();
  });

  it('opens a page that is in the menu', () => {
    renderWith(<ModulePage />, { path: '/tasks/approvals', data: meData('owner') });
    expect(screen.getByRole('heading', { name: 'Approvals' })).toBeInTheDocument();
  });

  it('says not found for addresses no app declares', () => {
    renderWith(<ModulePage />, { path: '/tasks/nonsense', data: meData('owner') });
    expect(screen.getByRole('heading', { name: 'We can’t find that page' })).toBeInTheDocument();
  });
});
