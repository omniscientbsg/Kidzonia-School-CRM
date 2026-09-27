import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { E2E_START } from '../playwright.config';
import { PEOPLE, expectAccessible, signIn } from './support';

/**
 * Phase 4 journeys (item g): Priya is blocked at logout, asks for release,
 * Meera releases her, and a day-end report is filled in and submitted on a
 * phone. The server's clock starts on a fixed Monday (E2E_NOW) and tests
 * move it with the test-only clock route.
 */

const DEMO_ORG = 'Kidzonia Pre-schools';
const MEERA = '98480 33105';
const SNEHA = '98480 44110';

/** 15:00 on the e2e Monday in Kolkata: inside the 2-hour window before 16:00. */
const MONDAY_3PM = new Date(Date.parse(E2E_START) + 7.5 * 60 * 60 * 1000).toISOString();

async function setClock(request: APIRequestContext, now: string) {
  const res = await request.post('/api/__test/clock', { data: { now } });
  expect(res.ok()).toBe(true);
}

async function logOut(page: Page) {
  await page.getByRole('button', { name: 'Your profile' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
}

test('Priya is blocked at logout, asks for release, and Meera releases her', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await setClock(request, MONDAY_3PM);
  try {
    await signIn(page, PEOPLE.priya, DEMO_ORG);
    await logOut(page);
    const dialog = page.getByRole('dialog', { name: 'You can’t log out yet' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Teacher day-end report')).toBeVisible();
    await expect(dialog.getByText('Classroom safety check')).toBeVisible();
    await expectAccessible(page);
    await dialog.getByLabel('Need to leave? Ask for release').fill('My child is unwell');
    await dialog.getByRole('button', { name: 'Ask for release' }).click();
    await expect(dialog.getByText('We’ve asked Meera Iyer to release you.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Stay logged in' }).click();

    // Meera releases her from Day-end reports.
    await page.context().clearCookies();
    await signIn(page, MEERA);
    await page.goto('/tasks/day-end');
    await expect(page.getByRole('heading', { level: 1, name: 'Day-end reports' })).toBeVisible();
    const row = page.getByRole('row', { name: /Priya Sharma/ });
    await expect(row.getByText('Blocking logout')).toBeVisible();
    await expectAccessible(page);
    await row.getByRole('button', { name: 'Release for today' }).click();
    const release = page.getByRole('dialog', { name: 'Release Priya Sharma' });
    await expect(release.getByText('Today', { exact: true })).toBeVisible();
    await release.getByRole('button', { name: 'Release for today' }).click();
    await expect(page.getByText('Priya Sharma can log out now.')).toBeVisible();

    // Now Priya can go.
    await page.context().clearCookies();
    await signIn(page, PEOPLE.priya, DEMO_ORG);
    await logOut(page);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  } finally {
    await setClock(request, E2E_START);
  }
});

test('@phone Sneha fills in and submits her day-end report', async ({ page, request }) => {
  await setClock(request, MONDAY_3PM);
  try {
    await signIn(page, SNEHA);
    await page.goto('/tasks');
    // Today's report (the next one, tomorrow, is under Coming up).
    await page.getByRole('button', { name: /Teacher day-end report Today/ }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('heading', { name: 'Teacher day-end report' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Mark as done' })).toBeDisabled();
    await expectAccessible(page);

    await drawer
      .getByRole('group', { name: 'Did every child go home with a known guardian?' })
      .getByRole('button', { name: 'Yes' })
      .click();
    await drawer.getByLabel('How many children were present?').fill('16');
    await drawer
      .getByRole('group', { name: 'Was any child unwell or hurt today?' })
      .getByRole('button', { name: 'No' })
      .click();
    await drawer.getByLabel('Concerns raised by parents today').fill('None');

    const submit = drawer.getByRole('button', { name: 'Mark as done' });
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await submit.click();
    await expect(page.getByText('Marked as done.')).toBeVisible();
    await expect(drawer.getByText('Done').first()).toBeVisible();
  } finally {
    await setClock(request, E2E_START);
  }
});
