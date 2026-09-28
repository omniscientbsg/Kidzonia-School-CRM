import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWith, stubFetch } from '../test/render';
import { Avatar } from './Avatar';

const PHOTO = '/api/users/0190a8f4-1b2c-7d3e-8f40-000000000009/photo?v=photo-1.jpg';

describe('Avatar', () => {
  // jsdom has no object URLs; the app shows fetched photos through them.
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:photo'),
      configurable: true,
      writable: true,
    });
  });

  it('shows initials when the person has no photo, without fetching', () => {
    const asked: string[] = [];
    stubFetch((url) => {
      asked.push(url);
      return undefined;
    });
    const { container } = renderWith(<Avatar name="Priya Sharma" photoUrl={null} />);
    const av = container.querySelector('.av');
    expect(av).toHaveTextContent('PS');
    expect(av).toHaveAttribute('aria-hidden', 'true');
    expect(asked.some((u) => u.includes('/photo'))).toBe(false);
  });

  it('falls back to initials when the photo can’t be loaded', async () => {
    const asked: string[] = [];
    stubFetch((url) => {
      asked.push(url);
      return url.includes('/photo') ? new Response('{}', { status: 404 }) : undefined;
    });
    const { container } = renderWith(<Avatar name="Meera Iyer" photoUrl={PHOTO} size="sm" />);
    await waitFor(() => {
      expect(asked).toContain(PHOTO);
    });
    expect(container.querySelector('.av.sm')).toHaveTextContent('MI');
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows the photo once it has loaded, fetched with the session', async () => {
    stubFetch((url) =>
      url === PHOTO
        ? new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }))
        : undefined,
    );
    const { container } = renderWith(<Avatar name="Meera Iyer" photoUrl={PHOTO} size="lg" />);
    // Fetch, read the blob, then render: allow slower machines (CI) more than the 1 s default.
    await waitFor(
      () => {
        expect(container.querySelector('img')).toHaveAttribute('src', 'blob:photo');
      },
      { timeout: 5000 },
    );
    // Decorative: the name is always shown or announced next to it.
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
    expect(container.querySelector('.av.lg')).not.toHaveTextContent('MI');
  });
});
