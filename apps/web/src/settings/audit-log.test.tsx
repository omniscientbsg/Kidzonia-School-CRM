import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { meData, renderWith, stubFetch } from '../test/render';
import { AuditLogPage } from './AuditLogPage';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const id = (n: number) => `0190a8f4-1b2c-7d3e-8f40-${String(n).padStart(12, '0')}`;

const entries = [
  {
    id: id(21),
    createdAt: '2026-10-05T04:30:00.000Z',
    actor: { id: id(1), fullName: 'Ananya Rao' },
    action: 'user.updated',
    area: 'users',
    entityLabel: 'Rohan Gupta',
    summary: 'changed details for Rohan Gupta',
    changes: [{ field: 'Mobile number', before: '+91 ••••• ••108', after: '+91 ••••• ••199' }],
  },
  {
    id: id(20),
    createdAt: '2026-10-04T12:00:00.000Z',
    actor: null,
    action: 'role.created',
    area: 'roles',
    entityLabel: 'Owner',
    summary: 'created the role Owner',
    changes: [],
  },
];

describe('Audit log page', () => {
  it('shows who did what and when, and what changed on request', async () => {
    const asked: string[] = [];
    stubFetch((url) => {
      if (url.includes('/api/audit-log')) {
        asked.push(url);
        return json({ items: entries, nextCursor: id(20) });
      }
      if (url.includes('/api/users')) return json({ items: [], nextCursor: null });
      return undefined;
    });
    renderWith(<AuditLogPage />, { data: meData('owner') });

    expect(await screen.findByText('Changed details for Rohan Gupta')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Audit log' })).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    // Header, then newest first; 04:30 UTC is 10:00 am in Asia/Kolkata.
    expect(within(rows[1] as HTMLElement).getByText('Ananya Rao')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText(/5 Oct 2026, 10:00\s?am/i)).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('The app')).toBeInTheDocument();
    // Nothing to expand when nothing changed field by field.
    expect(within(rows[2] as HTMLElement).queryByText('What changed')).toBeNull();

    const toggle = within(rows[1] as HTMLElement).getByText('What changed');
    await userEvent.click(toggle);
    const details = toggle.closest('details');
    expect(details).toHaveAttribute('open');
    expect(within(details as HTMLElement).getByText('Mobile number:')).toBeInTheDocument();
    expect(details).toHaveTextContent('+91 ••••• ••108');
    expect(details).toHaveTextContent('+91 ••••• ••199');

    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Area' })).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(asked[0]).toContain('limit=50');
  });
});
