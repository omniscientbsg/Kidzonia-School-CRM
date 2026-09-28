import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PEOPLE, expectAccessible, expectAccessibleInBothSchemes, signIn, withDb } from './support';

/**
 * Phase 3 journeys, mirroring the demo (item j): a teacher completes
 * sub-tasks and submits (on a phone), a principal sends back and approves, a
 * department head assigns to every teacher across schools, and a template is
 * saved and reused.
 */

const DEMO_ORG = 'Kidzonia Pre-schools';
const MEERA = '98480 33105';
const VIKRAM = '98480 11202';
const IMRAN = '99590 44111';

/** A person's current mobile (earlier journeys may have changed it). */
async function mobileOf(name: string): Promise<string> {
  const res = await withDb((c) =>
    c.query<{ mobile: string }>(
      'SELECT mobile FROM users WHERE full_name = $1 AND deleted_at IS NULL LIMIT 1',
      [name],
    ),
  );
  return res.rows[0]?.mobile ?? '';
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('dialog').getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function openTasks(page: Page, menu: string) {
  await page.goto('/tasks');
  if (menu !== 'My tasks') await page.getByRole('link', { name: menu }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: menu })).toBeVisible();
}

test('@phone Priya ticks her sub-tasks, adds a photo and submits', async ({ page }) => {
  await signIn(page, PEOPLE.priya, DEMO_ORG);
  await openTasks(page, 'My tasks');
  // The safety check and today's day-end report both block logout.
  await expect(page.getByText(/tasks must be submitted before you log out/)).toBeVisible();
  await expectAccessibleInBothSchemes(page);

  await page
    .getByRole('button', { name: /Classroom safety check/ })
    .first()
    .click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: 'Classroom safety check' })).toBeVisible();
  const submit = drawer.getByRole('button', { name: 'Submit for approval' });
  await expect(submit).toBeDisabled();
  await expectAccessibleInBothSchemes(page);

  await drawer.getByRole('checkbox', { name: 'First-aid kit is stocked' }).check();
  await expect(drawer.getByRole('checkbox', { name: 'First-aid kit is stocked' })).toBeChecked();
  await drawer.getByRole('checkbox', { name: 'All sockets are covered' }).check();
  await expect(drawer.getByRole('checkbox', { name: 'All sockets are covered' })).toBeChecked();

  await drawer
    .locator('input[type="file"][capture]')
    .setInputFiles(path.resolve(import.meta.dirname, 'fixtures', 'classroom.jpg'));
  await expect(drawer.getByRole('button', { name: 'classroom.jpg', exact: true })).toBeVisible();

  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText('Submitted for approval.')).toBeVisible();
  await expect(drawer.getByText('Waiting for approval').first()).toBeVisible();
  await expect(drawer.getByText('You’re free to log out.')).toBeVisible();
});

test('a principal sends work back with remarks, then approves it', async ({ page }) => {
  await signIn(page, MEERA);
  await openTasks(page, 'Approvals');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Review' }).first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: 'Rohan Gupta’s work' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /Room_KG1\.jpg/ })).toBeVisible();
  await drawer.getByLabel('Remarks').fill('Please add a photo of the fire exit');
  await drawer.getByRole('button', { name: 'Send back' }).click();
  await expect(page.getByText('Sent back with your remarks.')).toBeVisible();

  // Rohan sees why, fixes it and submits again.
  await page.context().clearCookies();
  await signIn(page, await mobileOf('Rohan Gupta'));
  await openTasks(page, 'My tasks');
  await page
    .getByRole('button', { name: /Classroom safety check/ })
    .first()
    .click();
  const his = page.getByRole('dialog');
  await expect(his.getByText('Please add a photo of the fire exit')).toBeVisible();
  await his.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByText('Submitted for approval.')).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, MEERA);
  await openTasks(page, 'Approvals');
  await page.getByRole('button', { name: 'Approve' }).first().click();
  await expect(page.getByText(/Approved Rohan Gupta’s work/)).toBeVisible();
  await expect(page.getByText('Nothing is waiting for your approval.')).toBeVisible();
});

test('a department head gives a task to every teacher across schools', async ({ page }) => {
  await signIn(page, VIKRAM);
  await openTasks(page, 'Assigned by me');
  await page.getByRole('main').getByRole('button', { name: 'New task' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: 'New task' })).toBeVisible();
  await drawer.getByLabel('Title').fill('Update the parent notice board');
  await choose(page, 'Role', 'All teachers');
  await drawer.getByRole('button', { name: 'Add', exact: true }).first().click();
  // Every teacher with a role, in every school (9 in the demo; earlier journeys may add one).
  const summary = drawer.getByText(/\d+ people\. Each person gets their own copy/);
  await expect(summary).toBeVisible();
  const n = /(\d+) people/.exec((await summary.textContent()) ?? '')?.[1] ?? '';
  expect(Number(n)).toBeGreaterThanOrEqual(9);
  await expectAccessible(page);
  await drawer.getByRole('button', { name: 'Assign task' }).click();
  await expect(page.getByText(`Task assigned to ${n} people.`)).toBeVisible();

  // The new task's drawer opens; the list shows "0 of n".
  await page.keyboard.press('Escape');
  const row = page.getByRole('button', { name: /Update the parent notice board/ });
  await expect(row).toContainText(`0 of ${n}`);

  // A franchise school's teacher has it too.
  await page.context().clearCookies();
  await signIn(page, IMRAN);
  await openTasks(page, 'My tasks');
  await expect(page.getByRole('button', { name: /Update the parent notice board/ })).toBeVisible();
});

test('a template is saved from a task and reused', async ({ page }) => {
  await signIn(page, PEOPLE.ananya);
  await openTasks(page, 'Assigned by me');
  await page.getByRole('main').getByRole('button', { name: 'New task' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Title').fill('Morning circle check');
  await drawer.getByLabel('Add a sub-task').fill('Mats are out');
  await drawer.getByRole('button', { name: 'Add', exact: true }).last().click();
  await drawer.getByRole('button', { name: 'Save as template' }).click();
  const modal = page.getByRole('dialog', { name: 'Save as template' });
  await modal.getByLabel('Template name').fill('Morning circle');
  await modal.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText('Saved as a template. People and dates aren’t kept.')).toBeVisible();
  await drawer.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('link', { name: 'Task setup' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Task setup' })).toBeVisible();
  await expectAccessible(page);
  const tpl = page.locator('.role-row', { hasText: 'Morning circle' });
  await tpl.getByRole('button', { name: 'Use' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByLabel('Title')).toHaveValue('Morning circle check');
  await expect(form.getByText('Mats are out')).toBeVisible();
  await form.getByLabel('Search people').fill('Priya');
  await form.getByRole('checkbox', { name: 'Priya Sharma' }).check();
  await form.getByRole('button', { name: 'Assign task' }).click();
  await expect(page.getByText('Task assigned to 1 person.')).toBeVisible();
});
