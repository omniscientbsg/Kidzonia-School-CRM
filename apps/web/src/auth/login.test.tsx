import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWith, stubFetch } from '../test/render';
import { LoginPage } from './LoginPage';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('sign in', () => {
  it('checks the mobile number before calling the API', async () => {
    const fetch = stubFetch();
    renderWith(<LoginPage />, { path: '/login' });
    await userEvent.type(await screen.findByLabelText(/Mobile number/), '12345');
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('Enter a valid mobile number')).toBeInTheDocument();
    expect(
      fetch.mock.calls.filter(([u]) => typeof u === 'string' && u.includes('request-code')),
    ).toHaveLength(0);
  });

  it('moves to the code step after the code is sent', async () => {
    stubFetch((url) =>
      url.includes('request-code')
        ? json(
            { challengeId: '0190a8f4-1b2c-7d3e-8f40-123456789abc', expiresIn: 300, resendIn: 30 },
            201,
          )
        : undefined,
    );
    renderWith(<LoginPage />, { path: '/login' });
    await userEvent.type(await screen.findByLabelText(/Mobile number/), '98480 11201');
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByRole('heading', { name: 'Enter your code' })).toBeInTheDocument();
    expect(screen.getByText('We sent a code to 98480 11201.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resend code in \d+s/ })).toBeDisabled();
  });

  it('shows the server’s message when the code is wrong', async () => {
    stubFetch((url) => {
      if (url.includes('request-code')) {
        return json(
          { challengeId: '0190a8f4-1b2c-7d3e-8f40-123456789abc', expiresIn: 300, resendIn: 30 },
          201,
        );
      }
      if (url.includes('verify-code')) {
        return json(
          {
            error: {
              code: 'invalid_input',
              message: 'That code is wrong or has expired. Request a new one.',
              fields: { code: 'That code is wrong or has expired. Request a new one.' },
            },
          },
          400,
        );
      }
      return undefined;
    });
    renderWith(<LoginPage />, { path: '/login' });
    await userEvent.type(await screen.findByLabelText(/Mobile number/), '98480 11201');
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await screen.findByRole('heading', { name: 'Enter your code' });
    const [firstBox] = document.querySelectorAll<HTMLInputElement>(
      '.mantine-PinInput-pinInput input, .mantine-PinInput-input',
    );
    if (!firstBox) throw new Error('no code boxes');
    await userEvent.click(firstBox);
    await userEvent.keyboard('000000');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is wrong or has expired');
  });

  it('pre-selects the organisation last opened on this device', async () => {
    localStorage.setItem('kz.lastOrganisationId', '0190a8f4-1b2c-7d3e-8f40-000000000002');
    stubFetch((url) =>
      url.includes('/auth/login')
        ? json({
            status: 'choose_organisation',
            selectionToken: 'tok',
            organisations: [
              {
                id: '0190a8f4-1b2c-7d3e-8f40-000000000001',
                name: 'Kidzonia Pre-schools',
                logoUrl: null,
              },
              {
                id: '0190a8f4-1b2c-7d3e-8f40-000000000002',
                name: 'Sunrise Kids Academy',
                logoUrl: null,
              },
            ],
          })
        : undefined,
    );
    renderWith(<LoginPage />, { path: '/login' });
    await userEvent.click(await screen.findByRole('button', { name: /password instead/ }));
    await userEvent.type(screen.getByLabelText(/Mobile number/), '98480 44108');
    await userEvent.type(screen.getByLabelText(/Password/), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByRole('heading', { name: 'Choose an organisation' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Sunrise Kids Academy' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Kidzonia Pre-schools' })).not.toBeChecked();
  });
});
