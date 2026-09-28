import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { PEOPLE, expectAccessible, signIn } from './support';

/**
 * Phase 6 accessibility pass (audit D6): touch targets on a phone, and a
 * journey done with the keyboard alone.
 */

const DEMO_ORG = 'Kidzonia Pre-schools';
const MEERA = '98480 33105';

/** Brief 7.2: at least 44px. Half a pixel allowed for sub-pixel rounding. */
async function expectTouchSize(target: Locator, name: string, both = false) {
  await expect(target, name).toBeVisible();
  const box = await target.boundingBox();
  expect(box, name).not.toBeNull();
  expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(43.5);
  if (both) expect(box?.width ?? 0, `${name} width`).toBeGreaterThanOrEqual(43.5);
}

/**
 * Presses Tab until `target` has focus, proving it can be reached from the
 * keyboard. Fails if it takes more than `max` presses (a trap or a skipped control).
 */
async function tabTo(page: Page, target: Locator, max = 80) {
  await expect(target).toBeVisible();
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Couldn't reach ${target.toString()} with Tab`);
}

test.describe('touch targets on a phone', () => {
  test('the task drawer’s controls are at least 44px @phone', async ({ page }) => {
    await signIn(page, PEOPLE.priya, DEMO_ORG);
    await page.goto('/tasks');
    await page
      .getByRole('button', { name: /Classroom safety check/ })
      .first()
      .click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('heading', { name: 'Classroom safety check' })).toBeVisible();

    // Full screen on a phone, with the close button in view.
    const viewport = page.viewportSize();
    const box = await drawer.boundingBox();
    expect(box?.width).toBe(viewport?.width);
    await expectTouchSize(drawer.getByRole('button', { name: 'Close' }).first(), 'Close', true);
    await expectTouchSize(
      drawer.getByRole('button', { name: 'Submit for approval' }),
      'Submit for approval',
    );
    await expectTouchSize(
      drawer.locator('label.check', { hasText: 'First-aid kit is stocked' }),
      'Sub-task tick',
    );
    await expectAccessible(page);
  });

  test('the New task drawer’s controls are at least 44px @phone', async ({ page }) => {
    await signIn(page, MEERA);
    await page.getByRole('button', { name: 'New task' }).first().click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('heading', { name: 'New task' })).toBeVisible();

    await expectTouchSize(drawer.getByRole('button', { name: 'Close' }).first(), 'Close', true);
    await expectTouchSize(drawer.getByLabel('Title'), 'Title');
    await expectTouchSize(drawer.getByLabel('Search people'), 'Search people');
    const due = drawer.getByRole('group', { name: 'Due' });
    for (const name of ['End of day', 'At a time', 'On a date']) {
      await expectTouchSize(due.getByRole('button', { name }), name);
    }
    await expectTouchSize(
      drawer.getByRole('button', { name: 'Add', exact: true }).last(),
      'Add sub-task',
    );
    await expectTouchSize(drawer.getByRole('button', { name: 'Cancel' }), 'Cancel');
    await expectTouchSize(drawer.getByRole('button', { name: 'Assign task' }), 'Assign task');
    await expectAccessible(page);
  });
});

test('keyboard only: Meera gives Priya a task, Priya submits it, Meera approves', async ({
  page,
}) => {
  const title = `Check the reading corner ${String(Date.now()).slice(-5)}`;

  // Meera: the top bar's "New task", the form, and "Assign task", all by keyboard.
  await signIn(page, MEERA);
  const newTask = page.getByRole('button', { name: 'New task' }).first();
  await tabTo(page, newTask);
  await page.keyboard.press('Enter');
  const form = page.getByRole('dialog');
  await expect(form.getByRole('heading', { name: 'New task' })).toBeVisible();
  await tabTo(page, form.getByLabel('Title'));
  await page.keyboard.type(title);
  await tabTo(page, form.getByLabel('Search people'));
  await page.keyboard.type('Priya');
  const priya = form.getByRole('checkbox', { name: 'Priya Sharma' });
  await tabTo(page, priya);
  // Space is how a checkbox is ticked from the keyboard.
  await page.keyboard.press('Space');
  await expect(priya).toBeChecked();
  // The due choice is a group of buttons; Enter picks one.
  await tabTo(page, form.getByRole('button', { name: 'End of day' }));
  await page.keyboard.press('Enter');
  await expect(form.getByRole('button', { name: 'End of day' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await tabTo(page, form.getByRole('button', { name: 'Assign task' }));
  await page.keyboard.press('Enter');
  await expect(page.getByText('Task assigned to 1 person.')).toBeVisible();
  // The new task opens in its drawer; Escape closes it.
  await expect(page.getByRole('dialog').getByRole('heading', { name: title })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Priya: opens it from My tasks and submits.
  await page.context().clearCookies();
  await signIn(page, PEOPLE.priya, DEMO_ORG);
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { level: 1, name: 'My tasks' })).toBeVisible();
  const row = page.getByRole('button', { name: new RegExp(title) }).first();
  await tabTo(page, row, 120);
  await page.keyboard.press('Enter');
  const mine = page.getByRole('dialog');
  await expect(mine.getByRole('heading', { name: title })).toBeVisible();
  await tabTo(page, mine.getByRole('button', { name: 'Submit for approval' }));
  await page.keyboard.press('Enter');
  await expect(page.getByText('Submitted for approval.')).toBeVisible();
  await page.keyboard.press('Escape');
  // Focus goes back to the row that opened the drawer (D6).
  await expect(row).toBeFocused();

  // Meera: Approvals from the Tasks menu, then Approve on Priya's row.
  await page.context().clearCookies();
  await signIn(page, MEERA);
  await page.goto('/tasks');
  await tabTo(page, page.getByRole('link', { name: 'Approvals' }).first());
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Approvals' })).toBeVisible();
  const approve = page
    .locator('.trow', { hasText: title })
    .getByRole('button', { name: 'Approve' });
  await tabTo(page, approve, 120);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Approved Priya Sharma’s work.')).toBeVisible();
  await expect(page.locator('.trow', { hasText: title })).toHaveCount(0);
});
