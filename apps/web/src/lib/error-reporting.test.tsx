import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { RouteErrorPage } from '../pages/RouteErrorPage';
import { theme } from '../theme';
import {
  errorReportingEnabled,
  installErrorReporting,
  reportError,
  resetErrorReportingForTests,
  scrubEvent,
} from './error-reporting';
import type { ErrorReporter } from './error-reporting';

function recorder() {
  const seen: { error: unknown; context?: Record<string, string> }[] = [];
  const reporter: ErrorReporter = {
    capture: (error, context) => {
      seen.push({ error, ...(context ? { context } : {}) });
    },
  };
  resetErrorReportingForTests(reporter);
  return seen;
}

afterEach(() => {
  resetErrorReportingForTests();
});

describe('web error reporting', () => {
  it('is off without a DSN and always off in unit tests', () => {
    expect(errorReportingEnabled({ MODE: 'production' })).toBe(false);
    expect(errorReportingEnabled({ MODE: 'test', VITE_ERROR_TRACKING_DSN: 'https://k@x/1' })).toBe(
      false,
    );
    expect(
      errorReportingEnabled({ MODE: 'production', VITE_ERROR_TRACKING_DSN: 'https://k@x/1' }),
    ).toBe(true);
    expect(errorReportingEnabled(import.meta.env)).toBe(false);
  });

  it('installs no handlers when off', () => {
    const listen = vi.spyOn(window, 'addEventListener');
    installErrorReporting({ MODE: 'test', VITE_ERROR_TRACKING_DSN: 'https://k@x/1' });
    installErrorReporting({ MODE: 'production' });
    expect(listen).not.toHaveBeenCalled();
  });

  it('leaves API errors to the server and reports the rest with the page path', () => {
    const seen = recorder();
    reportError(new ApiError(422, 'invalid_input', 'Bad'));
    reportError(new ApiError(500, 'internal', 'Oops'));
    reportError(new Error('render failed'), { source: 'route' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.context).toEqual({ path: '/', source: 'route' });
  });

  it('strips request data, breadcrumbs, tokens and phone numbers from events', () => {
    const event = scrubEvent({
      message: 'Could not save 98480 11201',
      request: { url: 'https://app.example.com/users?search=9848011201' },
      breadcrumbs: [{ message: 'fetch /api/users?search=9848011201' }],
      user: { id: 'u1', username: 'Priya Sharma' },
      extra: { accessToken: 'eyJa.eyJb.c', note: 'Bearer abc.def' },
    });
    expect(event.request).toBeUndefined();
    expect(event.breadcrumbs).toBeUndefined();
    expect(event.user).toEqual({ id: 'u1' });
    expect(event.message).toBe('Could not save [phone]');
    expect(JSON.stringify(event)).not.toMatch(/98480|eyJa|abc\.def|Priya/);
  });

  it('reports a page that crashes while rendering and shows a friendly page', async () => {
    const seen = recorder();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    function Broken(): never {
      throw new Error('boom');
    }
    const router = createMemoryRouter([
      { path: '/', element: <Broken />, errorElement: <RouteErrorPage /> },
    ]);
    render(
      <MantineProvider theme={theme}>
        <RouterProvider router={router} />
      </MantineProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    expect(seen).toHaveLength(1);
    expect((seen[0]!.error as Error).message).toBe('boom');
  });
});
