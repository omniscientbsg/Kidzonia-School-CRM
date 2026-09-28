import { expect, test } from '@playwright/test';
import { PEOPLE, expectAccessible, signIn } from './support';

/** Meera Iyer, principal of Jubilee Hills: not an Owner. */
const MEERA = '98480 33105';

test.describe('Phase 6: audit log (brief 10.4)', () => {
  test('an Owner reads the audit log, filters it and sees what changed', async ({ page }) => {
    await signIn(page, PEOPLE.ananya);
    await page
      .getByRole('navigation', { name: 'Apps' })
      .getByRole('link')
      .filter({ hasText: 'Settings' })
      .click();
    await page
      .getByRole('navigation', { name: 'Settings menu' })
      .getByRole('link', { name: 'Audit log' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();

    const rows = page.getByRole('table').getByRole('row');
    // The header plus at least one entry (the starter roles are always recorded).
    await expect(rows.nth(1)).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('combobox', { name: 'Area' }).click();
    await page
      .getByRole('listbox')
      .getByRole('option', { name: 'Roles and permissions', exact: true })
      .click();
    await expect(
      page
        .getByRole('table')
        .getByText(/the role|permissions|automatic roles/i)
        .first(),
    ).toBeVisible();
    for (const text of await rows.allInnerTexts()) {
      if (text.startsWith('When')) continue;
      // Roles given and taken away read "gave Teacher to …" / "took … away from …".
      expect(text).toMatch(/role|permissions|gave|took/i);
    }

    await page.getByRole('table').getByText('What changed').first().click();
    const opened = page.locator('details[open]').first();
    await expect(opened).toBeVisible();
    await expect(opened.getByRole('listitem').first()).toContainText(':');
    // Raw stored values never reach the screen.
    await expect(opened).not.toContainText('{');
    await expectAccessible(page);
  });

  test('a principal has no audit log', async ({ page }) => {
    await signIn(page, MEERA);
    await expect(page.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
    await page.goto('/settings/audit-log');
    await expect(
      page.getByRole('heading', { name: 'You don’t have access to this page' }),
    ).toBeVisible();
    await expectAccessible(page);
  });
});
