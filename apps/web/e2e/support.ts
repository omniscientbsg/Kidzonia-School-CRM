import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import pg from 'pg';

export const PEOPLE = {
  ananya: '98480 11201', // Owner, head office
  priya: '98480 44108', // Teacher at Jubilee Hills, also in a second organisation
  rohan: '98480 44109', // Teacher at Jubilee Hills
  rahul: '98480 44114', // Joined, no role yet
} as const;

/** Signs in through the real screens with the development code. */
export async function signIn(page: Page, mobile: string, organisation?: string) {
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
  await page.locator('input').first().click();
  await page.keyboard.type('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (organisation) {
    await expect(page.getByRole('heading', { name: 'Choose an organisation' })).toBeVisible();
    await page.getByRole('radio', { name: organisation }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  // Signed in once the shell is up (the refresh cookie is set by then).
  await expect(page.getByRole('button', { name: 'Your profile' })).toBeVisible();
}

/** Fails on serious or critical WCAG 2.1 A/AA problems. */
export async function expectAccessible(page: Page) {
  // Let fades finish first: a toast half-way through fading in reads as low contrast.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running'),
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map(
      (v) =>
        `${v.id}: ${v.help} (${v.nodes.map((n) => `${n.target.join(' ')} ${n.html.slice(0, 120)}`).join(', ')})`,
    ),
  ).toEqual([]);
}

const schemeIs = (page: Page, scheme: 'light' | 'dark') =>
  page.waitForFunction(
    (s) => document.documentElement.getAttribute('data-mantine-color-scheme') === s,
    scheme,
  );

/**
 * Runs axe in light mode, then again in dark mode (audit D5), then goes back
 * to light. It switches by emulating the device setting, which the app follows
 * while the person's choice is "Device" (the default), so open drawers and
 * typed text stay as they are. If a test picked Light or Dark in the profile
 * menu, the attribute is set directly instead; the CSS only reads that.
 */
export async function expectAccessibleInBothSchemes(page: Page) {
  await expectAccessible(page);
  const setDirectly = (s: 'light' | 'dark') =>
    page.evaluate((v) => {
      document.documentElement.setAttribute('data-mantine-color-scheme', v);
    }, s);
  const stored = await page.evaluate(() => {
    try {
      return window.localStorage.getItem('kz.colorScheme');
    } catch {
      return null;
    }
  });
  const followsDevice = stored === null || stored === 'auto';

  if (followsDevice) await page.emulateMedia({ colorScheme: 'dark' });
  else await setDirectly('dark');
  await schemeIs(page, 'dark');
  try {
    await expectAccessible(page);
  } finally {
    if (followsDevice) await page.emulateMedia({ colorScheme: 'light' });
    else await setDirectly(stored === 'dark' ? 'dark' : 'light');
  }
}

/** Direct database access for arranging a test, e.g. changing a role. */
export async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    connectionString:
      process.env.E2E_DATABASE_URL ?? 'postgresql://kidzonia:kidzonia@localhost:55432/kidzonia_e2e',
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
