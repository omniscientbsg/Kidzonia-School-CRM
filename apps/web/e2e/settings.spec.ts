import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { PEOPLE, expectAccessible, expectAccessibleInBothSchemes, signIn, withDb } from './support';

/** Picks an option in a Mantine Select by its label. */
async function choose(
  page: Page,
  label: string | RegExp,
  option: string,
  scope: Page | Locator = page,
) {
  await scope.getByLabel(label).first().click();
  // The dropdown's options (the top bar's school switcher has options too).
  await page.getByRole('listbox').getByRole('option', { name: option, exact: true }).click();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Your profile' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

async function enterCode(page: Page) {
  await page.locator('input[inputmode="numeric"]').first().click();
  await page.keyboard.type('123456');
}

const freshMobile = () => `9${String(Date.now()).slice(-9)}`;

test.describe('Phase 2: done when', () => {
  test('an owner registers, sets up a role, and a hidden field disappears for the user', async ({
    page,
  }) => {
    // The whole brief journey in one test: registration, settings, two sign-ins.
    test.setTimeout(120_000);
    const ownerMobile = freshMobile();
    // 1. Register a head office with one school.
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expectAccessible(page);
    await page.getByLabel('Full name').fill('Asha Kulkarni');
    await page.getByLabel('Mobile number').fill(ownerMobile);
    await page.getByRole('button', { name: 'Send code' }).click();
    await enterCode(page);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText('Mobile number verified.')).toBeVisible();
    await page.locator('input[type="password"]').fill('a-strong-password');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'What are you setting up?' })).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('radio', { name: /A head office/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByLabel('Organisation name').fill('Little Stars Group');
    await page.getByLabel('City').fill('Pune');
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Add your schools' })).toBeVisible();
    await page.getByLabel('School name').fill('Aundh');
    await page.getByRole('button', { name: 'Create organisation' }).click();
    await expect(page.getByRole('heading', { name: /, Asha$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Set up your organisation' })).toBeVisible();

    // 2. Add a school.
    await page.goto('/settings/schools');
    await page.getByRole('button', { name: 'Add school' }).click();
    const schoolDialog = page.getByRole('dialog', { name: 'Add school' });
    await schoolDialog.getByLabel('School name').fill('Baner');
    await schoolDialog.getByLabel('City').fill('Pune');
    await schoolDialog.getByRole('button', { name: 'Add school' }).click();
    await expect(page.getByRole('button', { name: 'Baner' })).toBeVisible();
    await expectAccessible(page);

    // 3. Create a role that can see Users in its schools.
    await page.goto('/settings/roles');
    await page.getByRole('button', { name: 'New role' }).click();
    const roleDialog = page.getByRole('dialog', { name: 'New role' });
    await roleDialog.getByLabel('Role name').fill('Coordinator');
    await roleDialog.getByRole('button', { name: 'Create role' }).click();
    await expect(page.getByLabel('Role name')).toHaveValue('Coordinator');
    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('button', { name: /^Users/ })
      .click();
    await page.getByRole('checkbox', { name: 'View' }).check();
    await choose(page, 'Whose records', 'Their school(s)');
    await page.getByRole('button', { name: 'Save role' }).click();
    await expect(page.getByText('Coordinator saved. Changes apply straight away.')).toBeVisible();
    await expectAccessible(page);

    // 4. Add a user with that role, scoped to Baner.
    const userMobile = freshMobile().replace(/^9/, '8');
    await page.goto('/settings/users');
    await page.getByRole('button', { name: 'Add user' }).click();
    const drawer = page.getByRole('dialog', { name: 'Add user' });
    await drawer.getByLabel('Full name').fill('Ravi Patil');
    await drawer.getByLabel('Mobile number').fill(userMobile);
    await choose(page, 'School', 'Baner', drawer);
    await choose(page, 'Role', 'Coordinator', drawer);
    await drawer.getByText('Chosen schools', { exact: true }).click();
    await drawer.locator('label', { hasText: /^Baner$/ }).click();
    await drawer.getByRole('switch', { name: /Send invite/ }).uncheck({ force: true });
    await drawer.getByRole('button', { name: 'Add user' }).click();
    await expect(page.getByRole('button', { name: /Ravi Patil/ })).toBeVisible();
    await expectAccessibleInBothSchemes(page);

    // Ravi sees mobile numbers for now.
    await signOut(page);
    await signIn(page, userMobile);
    await page.goto('/settings/users');
    await expect(page.getByRole('columnheader', { name: 'Mobile' })).toBeVisible();
    await signOut(page);

    // 5. Hide Mobile number for the role.
    await signIn(page, ownerMobile);
    await page.goto('/settings/roles');
    await page.getByRole('link', { name: 'Edit' }).last().click();
    await expect(page.getByLabel('Role name')).toHaveValue('Coordinator');
    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('button', { name: /^Users/ })
      .click();
    await page.getByText('Field permissions', { exact: true }).click();
    await page
      .getByRole('radiogroup', { name: 'Mobile number access' })
      .getByText('Hidden')
      .click();
    await page.getByRole('button', { name: 'Save role' }).click();
    await expect(page.getByText('Coordinator saved. Changes apply straight away.')).toBeVisible();
    await signOut(page);

    // 6. The field is gone from Ravi's screens and from the API response.
    await signIn(page, userMobile);
    const response = page.waitForResponse(
      (r) => r.url().includes('/api/users?') && r.status() === 200,
    );
    await page.goto('/settings/users');
    const body = (await (await response).json()) as { items: Record<string, unknown>[] };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((i) => !('mobile' in i))).toBe(true);
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Mobile' })).toHaveCount(0);
  });
});

test.describe('Phase 2 journeys', () => {
  test('changes that need approval go to the manager', async ({ page }) => {
    await withDb(async (c) => {
      await c.query(`
        INSERT INTO role_permissions (id, organisation_id, role_id, module_key, actions, reach, updated_at)
        SELECT gen_random_uuid(), r.organisation_id, r.id, 'users', ARRAY['view'], 'own', now()
          FROM roles r JOIN organisations o ON o.id = r.organisation_id
         WHERE r.seed_key = 'teacher' AND o.name = 'Kidzonia Pre-schools'
        ON CONFLICT DO NOTHING`);
      await c.query(`
        INSERT INTO role_field_permissions (id, organisation_id, role_id, module_key, field_key, access, own_record, needs_approval, updated_at)
        SELECT gen_random_uuid(), r.organisation_id, r.id, 'users', 'mobile', 'view', 'edit', true, now()
          FROM roles r JOIN organisations o ON o.id = r.organisation_id
         WHERE r.seed_key = 'teacher' AND o.name = 'Kidzonia Pre-schools'
        ON CONFLICT DO NOTHING`);
    });
    await signIn(page, PEOPLE.rohan);
    await page.getByRole('button', { name: 'Your profile' }).click();
    await page.getByRole('menuitem', { name: 'Your details' }).click();
    await expect(page.getByRole('heading', { name: 'Your details', level: 2 })).toBeVisible();
    await expect(page.getByLabel('Full name')).toBeDisabled();
    await page.getByLabel('Mobile number').fill('96660 77777');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Your manager needs to approve this change.')).toBeVisible();
    await expectAccessible(page);
    await signOut(page);

    await signIn(page, '98480 33105'); // Meera, Rohan's principal
    await page.goto('/changes');
    await expect(page.getByText(/Rohan Gupta: Mobile number/)).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Nothing is waiting for your approval.')).toBeVisible();
    // Put the Teacher role back as seeded, for the tests that follow.
    await withDb(async (c) => {
      await c.query(`DELETE FROM role_field_permissions WHERE module_key = 'users' AND field_key = 'mobile'
        AND role_id IN (SELECT id FROM roles WHERE seed_key = 'teacher')`);
      await c.query(`DELETE FROM role_permissions WHERE module_key = 'users'
        AND role_id IN (SELECT id FROM roles WHERE seed_key = 'teacher')`);
    });
  });

  test('previewing a role shows only what both people may see, read-only', async ({ page }) => {
    await signIn(page, PEOPLE.ananya);
    await page.goto('/settings/roles');
    const teacherRow = page
      .locator('.role-row')
      .filter({ has: page.getByText('Teacher', { exact: true }) });
    await teacherRow.getByRole('link', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Preview as this role' }).click();
    const dialog = page.getByRole('dialog', { name: 'Preview as this role' });
    await choose(page, 'Preview as', 'Priya Sharma', dialog);
    await dialog.getByRole('button', { name: 'Start preview' }).click();
    await expect(page.getByText(/Previewing as Priya Sharma \(Teacher\)/)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Apps' }).getByRole('link')).toHaveText([
      'Home',
      'Tasks',
      'HRMS',
    ]);
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Exit preview' }).click();
    await expect(page.getByRole('navigation', { name: 'Apps' }).getByRole('link')).toHaveText([
      'Home',
      'Tasks',
      'HRMS',
      'Settings',
    ]);
  });

  test('Manage people gives and removes a role with a school scope', async ({ page }) => {
    await signIn(page, PEOPLE.ananya);
    await page.goto('/settings/roles');
    await page
      .locator('.role-row')
      .filter({ has: page.getByText('Teacher', { exact: true }) })
      .getByRole('button', { name: /people$/ })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Teacher' });
    await dialog.getByLabel('Add a person').first().fill('Rahul');
    await page.getByRole('option', { name: /Rahul Verma/ }).click();
    await dialog.getByText('Chosen schools', { exact: true }).click();
    await dialog.locator('label', { hasText: /^Jubilee Hills$/ }).click();
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog.getByText('Rahul Verma')).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press('Escape');
    await page.goto('/settings/users');
    await expect(page.getByText(/waiting for a role/)).toHaveCount(0);
  });

  test('organisation settings and holidays', async ({ page }) => {
    await signIn(page, PEOPLE.ananya);
    await page.goto('/settings/organisation');
    await expect(page.getByRole('heading', { name: 'Organisation', level: 2 })).toBeVisible();
    await page.getByRole('button', { name: 'Add holiday' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add holiday' });
    await dialog.getByLabel('Name').fill('Children’s Day');
    await dialog.getByLabel('First day').fill(`${new Date().getFullYear()}-11-14`);
    await dialog.getByRole('button', { name: 'Add holiday' }).click();
    await expect(page.getByText('Children’s Day')).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('Phase 2 on a phone', () => {
  test('settings pages fit a phone @phone', async ({ page }) => {
    await signIn(page, PEOPLE.ananya);
    for (const path of [
      '/settings/users',
      '/settings/roles',
      '/settings/schools',
      '/settings/organisation',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Settings menu' })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
      await expectAccessible(page);
    }
  });
});
