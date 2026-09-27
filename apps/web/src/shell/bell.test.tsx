import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { meData, renderWith, stubFetch } from '../test/render';
import { Bell } from './Bell';

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status });

const item = (over: Record<string, unknown>) => ({
  key: 'k1',
  event: 'task_assigned',
  count: 1,
  unread: 1,
  createdAt: new Date().toISOString(),
  text: 'Meera Iyer gave you “Tidy the book corner”',
  href: '/tasks?task=0190a8f4-1b2c-7d3e-8f40-000000000009',
  removed: false,
  ...over,
});

describe('the bell', () => {
  it('shows the unread count, lists notifications, and leaves removed tasks unlinked', async () => {
    let unread = 2;
    stubFetch((url, init) => {
      if (url.endsWith('/api/notifications/count')) return json({ unread });
      if (url.includes('/api/notifications?')) {
        return json({
          items: [
            item({}),
            item({ key: 'k2', text: 'This task was removed', href: null, removed: true }),
          ],
          nextOffset: null,
        });
      }
      if (url.endsWith('/api/notifications/read-all') && init?.method === 'POST') {
        unread = 0;
        return json(null, 204);
      }
      return undefined;
    });
    renderWith(<Bell />, { data: meData('teacher') });

    const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    await userEvent.click(bell);
    expect(
      await screen.findByRole('button', { name: /Meera Iyer gave you “Tidy the book corner”/ }),
    ).toBeInTheDocument();
    // Removed: shown, but not something you can open (Phase 5 addition e).
    expect(screen.getByText('This task was removed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /This task was removed/ })).toBeNull();

    // Changing the count is announced politely to screen readers (addition d).
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('No unread notifications');
    });
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });
});
