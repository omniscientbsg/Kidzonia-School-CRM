import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PEOPLE, expectAccessible, expectAccessibleInBothSchemes, signIn } from './support';

/**
 * Phase 6 journeys: parent contacts come in from a CSV (checked row by row
 * before anything is saved), and a task with "Message parents" reaches the
 * parents who agreed when the work is done. The log shows counts only.
 */

const DEMO_ORG = 'Kidzonia Pre-schools';
const MEERA = '98480 33105';

async function choose(
  page: Page,
  scope: ReturnType<Page['getByRole']> | Page,
  label: string,
  option: string,
) {
  await scope.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('listbox').getByRole('option', { name: option, exact: true }).click();
}

test('an Owner uploads parent contacts: every row checked first, then the good ones saved', async ({
  page,
}) => {
  await signIn(page, PEOPLE.ananya);
  await page.goto('/settings/parent-contacts');
  await expect(page.getByRole('heading', { level: 1, name: 'Parent contacts' })).toBeVisible();
  await choose(page, page, 'School', 'Jubilee Hills');
  await expect(page.getByRole('cell', { name: 'Aarav Kumar' })).toBeVisible();
  await expectAccessibleInBothSchemes(page);

  await page.getByRole('button', { name: 'Upload a CSV' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload contacts for Jubilee Hills' });
  await dialog.getByLabel('CSV file').setInputFiles({
    name: 'contacts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'Class,Student name,Parent name,Parent mobile,Agreed to messages',
        'Nursery B,Tara Iyer,Anil Iyer,98480 66601,yes',
        'Nursery B,Om Das,Ravi Das,12345,yes',
      ].join('\n'),
    ),
  });
  await expect(dialog.getByText('The parent mobile isn’t a valid number.')).toBeVisible();
  await expect(dialog.getByText(/1 with problems/)).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Import 1 row' }).click();
  await expect(page.getByText('Imported 1 rows, skipped 1')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Tara Iyer' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Om Das' })).toHaveCount(0);
});

test('a task with "Message parents" reaches the parents who agreed, and the log shows counts only', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  // Meera gives Priya a task that messages Nursery A's parents when done.
  await signIn(page, MEERA);
  await page.goto('/tasks/assigned');
  await page.getByRole('main').getByRole('button', { name: 'New task' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Title').fill('Leaf printing');
  await drawer.getByLabel('Search people').fill('Priya');
  await drawer.getByRole('checkbox', { name: 'Priya Sharma' }).check();
  // Mantine draws the switch's track over its (visually hidden) input.
  await drawer.getByRole('switch', { name: 'Needs approval' }).setChecked(false, { force: true });
  await drawer
    .getByRole('switch', { name: 'Message parents when done' })
    .setChecked(true, { force: true });
  await choose(page, drawer, 'Template', 'Class activity done');
  await drawer.getByRole('combobox', { name: 'Send to parents of' }).fill('Nursery A');
  await expectAccessible(page);
  await drawer.getByRole('button', { name: 'Assign task' }).click();
  await expect(page.getByText(/Task assigned/)).toBeVisible();

  // Priya marks it done.
  await page.context().clearCookies();
  await signIn(page, PEOPLE.priya, DEMO_ORG);
  await page.goto('/tasks');
  await page
    .getByRole('button', { name: /Leaf printing/ })
    .first()
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark as done' }).click();
  await expect(page.getByText(/Marked as done|Done/).first()).toBeVisible();

  const delivered = await request.post('/api/__test/deliver-parent-messages');
  expect(delivered.ok()).toBe(true);

  // Meera sees it in the log and on the task: counts, never numbers or children's names.
  await page.context().clearCookies();
  await signIn(page, MEERA);
  await page.goto('/tasks/parent-messages');
  await expect(page.getByRole('heading', { level: 1, name: 'Parent messages' })).toBeVisible();
  const row = page.getByRole('row', { name: /Leaf printing/ });
  await expect(row.getByText('Sent to 3 of 3 parents')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('99999');
  await expect(page.locator('main')).not.toContainText('Aarav');
  await expectAccessibleInBothSchemes(page);
  await row.getByRole('button', { name: 'Leaf printing' }).click();
  await expect(
    page.getByRole('dialog').getByText('Message sent to 3 of 3 Nursery A parents'),
  ).toBeVisible();
});
