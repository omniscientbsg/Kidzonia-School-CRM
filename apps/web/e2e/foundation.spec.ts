import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PEOPLE, expectAccessible, signIn, withDb } from './support';

const appTabs = (page: Page) => page.getByRole('navigation', { name: 'Apps' }).getByRole('link');

test.describe('Phase 1 journeys', () => {
  test('the sign-in screens are accessible', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel('Mobile number').fill(PEOPLE.ananya);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
    await expectAccessible(page);
  });

  test('an Owner signs in with a code and sees every app', async ({ page }) => {
    await signIn(page, PEOPLE.ananya);
    await expect(page.getByRole('heading', { name: /, Ananya$/ })).toBeVisible();
    await expect(appTabs(page)).toHaveText(['Home', 'Tasks', 'HRMS', 'Settings']);
    await expectAccessible(page);

    await appTabs(page).filter({ hasText: 'Settings' }).click();
    await expect(
      page.getByRole('navigation', { name: 'Settings menu' }).getByRole('link'),
    ).toHaveText(['Organisation', 'Schools', 'Users', 'Roles & permissions']);
    await expectAccessible(page);

    await appTabs(page).filter({ hasText: 'HRMS' }).click();
    await expect(page.getByRole('heading', { name: 'HRMS is coming next' })).toBeVisible();
    await expectAccessible(page);
  });

  test('a teacher sees only what their role allows', async ({ page }) => {
    await signIn(page, PEOPLE.rohan);
    await expect(appTabs(page)).toHaveText(['Home', 'Tasks', 'HRMS']);
    await appTabs(page).filter({ hasText: 'Tasks' }).click();
    await expect(page.getByRole('navigation', { name: 'Tasks menu' }).getByRole('link')).toHaveText(
      ['My tasks', 'Watching', 'Reports'],
    );
    await expectAccessible(page);

    // Typing an address that isn't in the menu doesn't get round it.
    await page.goto('/settings/users');
    await expect(
      page.getByRole('heading', { name: 'You don’t have access to this page' }),
    ).toBeVisible();
  });

  test('someone without a role sees only the account-ready screen', async ({ page }) => {
    await signIn(page, PEOPLE.rahul);
    await expect(page.getByRole('heading', { name: 'Your account is ready' })).toBeVisible();
    await expect(page.getByText('Ask Meera to give you a role')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Apps' })).toHaveCount(0);
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: 'Your account is ready' })).toBeVisible();
    await expectAccessible(page);
  });

  test('the menu changes when the role changes', async ({ page }) => {
    await signIn(page, PEOPLE.rohan);
    await expect(appTabs(page)).toHaveText(['Home', 'Tasks', 'HRMS']);
    const grant = `
      INSERT INTO role_permissions (id, organisation_id, role_id, module_key, actions, updated_at)
      SELECT gen_random_uuid(), r.organisation_id, r.id, 'roles', ARRAY['view'], now()
        FROM roles r JOIN organisations o ON o.id = r.organisation_id
       WHERE r.name = 'Teacher' AND o.name = 'Kidzonia Pre-schools'`;
    await withDb((c) => c.query(grant));
    try {
      await page.reload();
      await expect(appTabs(page)).toHaveText(['Home', 'Tasks', 'HRMS', 'Settings']);
    } finally {
      await withDb((c) => c.query(`DELETE FROM role_permissions WHERE module_key = 'roles'`));
    }
    await page.reload();
    await expect(appTabs(page)).toHaveText(['Home', 'Tasks', 'HRMS']);
  });

  test('someone in two organisations picks one, and it is remembered', async ({ page }) => {
    await signIn(page, PEOPLE.priya, 'Sunrise Kids Academy');
    await expect(page.getByText('Welcome to Sunrise Kids Academy.')).toBeVisible();

    await page.getByRole('button', { name: 'Your profile' }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.getByLabel('Mobile number').fill(PEOPLE.priya);
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.locator('input').first().click();
    await page.keyboard.type('123456');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('radio', { name: 'Sunrise Kids Academy' })).toBeChecked();
    await expectAccessible(page);
  });

  test('logging out ends the session, even after a reload', async ({ page }) => {
    await signIn(page, PEOPLE.ananya);
    await expect(appTabs(page).first()).toBeVisible();
    await page.getByRole('button', { name: 'Your profile' }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/settings/users');
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test('a signed-in page survives a reload', async ({ page }) => {
    await signIn(page, PEOPLE.ananya);
    await page.goto('/tasks/approvals');
    await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible();
  });
});

test.describe('on a phone', () => {
  test('menus become sideways strips @phone', async ({ page }) => {
    await signIn(page, PEOPLE.ananya);
    await page.goto('/tasks');
    const menu = page.getByRole('navigation', { name: 'Tasks menu' });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box?.height ?? 0).toBeLessThan(80);
    // No sideways scrolling of the page itself.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expectAccessible(page);
  });
});
