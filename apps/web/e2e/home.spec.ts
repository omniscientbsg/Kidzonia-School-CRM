import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PEOPLE, expectAccessible, expectAccessibleInBothSchemes, signIn, withDb } from './support';

/**
 * Phase 5 journeys (item g): each seeded persona's Home matches the demo; a
 * notification is received and opened; a report is filtered, saved and
 * downloaded; search finds a task.
 */

const DEMO_ORG = 'Kidzonia Pre-schools';
const VIKRAM = '98480 11202';
const MEERA = '98480 33105';

const panel = (page: Page, name: string) =>
  page.locator('section.panel').filter({ has: page.getByRole('heading', { level: 2, name }) });

test.describe('each persona’s Home matches the demo', () => {
  test('Ananya, the Owner: her schools, lowest first, and what needs attention', async ({
    page,
  }) => {
    await signIn(page, PEOPLE.ananya);
    await expect(page.getByRole('heading', { level: 1, name: /, Ananya$/ })).toBeVisible();
    await expect(page.getByText('Here’s what’s happening across your 4 schools.')).toBeVisible();
    const schools = panel(page, 'Your schools');
    await expect(schools.getByRole('row')).toHaveCount(5); // header + 4 schools
    await expect(page.getByRole('link', { name: /person waiting for a role/ })).toBeVisible();
    await expect(
      panel(page, 'Notifications').getByText('Rahul Verma joined and is waiting for a role'),
    ).toBeVisible();
    await expect(panel(page, 'Updates')).toBeVisible();
    await expectAccessibleInBothSchemes(page);
  });

  test('Vikram, a department head: the tasks he set, by school', async ({ page }) => {
    await signIn(page, VIKRAM);
    const set = panel(page, 'Tasks you’ve set');
    await expect(set.getByText('Submit weekly lesson plan')).toBeVisible();
    await expect(set.getByText('Jubilee Hills').first()).toBeVisible();
    await expect(
      panel(page, 'Notifications').getByText('3 people submitted “Submit weekly lesson plan”'),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test('Meera, a principal: her team today and her school’s updates', async ({ page }) => {
    await signIn(page, MEERA);
    await expect(page.getByText('Here’s Jubilee Hills today.')).toBeVisible();
    const team = panel(page, 'Your team today');
    await expect(team.getByText('Priya Sharma')).toBeVisible();
    await expect(team.getByText('Rohan Gupta')).toBeVisible();
    await expect(
      panel(page, 'Updates').getByText('Rohan Gupta submitted “Classroom safety check”'),
    ).toBeVisible();
    await expect(panel(page, 'Updates').getByText('Imran Sheikh')).toHaveCount(0);
    await expectAccessible(page);
  });

  test('Priya, a teacher: today’s list and what she was given', async ({ page }) => {
    await signIn(page, PEOPLE.priya, DEMO_ORG);
    const today = panel(page, 'Today');
    await expect(today.getByText('Classroom safety check')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Your schools' })).toHaveCount(0);
    await expect(
      panel(page, 'Notifications').getByText(
        'Meera Iyer gave you “Plan Annual Day rehearsal for Nursery A”',
      ),
    ).toBeVisible();
    await expectAccessible(page);
  });
});

test('a notification is received and opened', async ({ page, request }) => {
  // Meera hands Rohan a task; the delivery worker puts it in his bell.
  await withDb(async (db) => {
    const ids = await db.query<{ org: string; rohan: string; meera: string; task: string }>(
      `select o.id as org,
              (select id from users where organisation_id = o.id and mobile = '+919848044109') as rohan,
              (select id from users where organisation_id = o.id and mobile = '+919848033105') as meera,
              (select id from tasks where organisation_id = o.id and title = 'Classroom safety check' limit 1) as task
         from organisations o where o.name = $1`,
      [DEMO_ORG],
    );
    const r = ids.rows[0];
    if (!r) throw new Error('Demo organisation missing');
    await db.query(
      `insert into notification_outbox (id, organisation_id, event, recipient_user_id, entity_type, entity_id, payload, dedupe_key)
       values (gen_random_uuid(), $1, 'task_sent_back', $2, 'task', $3, $4, 'e2e:sent-back')
       on conflict do nothing`,
      [r.org, r.rohan, r.task, JSON.stringify({ by: r.meera })],
    );
  });
  const delivered = await request.post('/api/__test/deliver-notifications');
  expect(delivered.ok()).toBe(true);

  await signIn(page, PEOPLE.rohan);
  const bell = page.getByRole('button', { name: /^Notifications, \d+ unread$/ });
  await expect(bell).toBeVisible();
  await bell.click();
  // In the bell's list (Home's Notifications panel shows it too).
  const item = page
    .locator('.mantine-Popover-dropdown')
    .getByRole('button', { name: /“Classroom safety check” was sent back to you/ });
  await expect(item).toBeVisible();
  await expectAccessible(page);
  await item.click();
  await expect(page.getByRole('dialog', { name: 'Classroom safety check' })).toBeVisible();
});

test('a report is filtered, saved and downloaded', async ({ page }) => {
  await signIn(page, PEOPLE.ananya);
  await page.goto('/tasks/reports');
  await expect(page.getByRole('heading', { level: 1, name: 'Task reports' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Priya Sharma/ })).toBeVisible();
  await expectAccessibleInBothSchemes(page);

  await page.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: 'Overdue', exact: true }).click();
  await expect(page).toHaveURL(/status=overdue/);
  await expect(page.getByRole('row', { name: /Priya Sharma/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Divya Menon/ })).toBeVisible();

  await page.getByRole('button', { name: 'Save this view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save this view' });
  await dialog.getByLabel('Name').fill('Overdue this week');
  await dialog.getByRole('button', { name: 'Save view' }).click();
  await expect(page.getByRole('button', { name: 'Overdue this week', exact: true })).toBeVisible();

  // Opening the saved view from a clean page brings the filter back.
  await page.goto('/tasks/reports');
  await page.getByRole('button', { name: 'Overdue this week', exact: true }).click();
  await expect(page).toHaveURL(/status=overdue/);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^task-report-.*\.csv$/);
  const text = (await readFile(await file.path(), 'utf8')).replace(/^\uFEFF/, '');
  const lines = text.trim().split('\r\n');
  expect(lines[0]).toContain('Name,Role,School,Tasks');
  expect(text).toContain('Divya Menon');
  expect(text).not.toContain('Priya Sharma');
});

test('search finds a task and opens it', async ({ page }) => {
  await signIn(page, MEERA);
  const search = page.getByRole('combobox', { name: 'Search' });
  await search.fill('safety');
  const hit = page.getByRole('option', { name: /Classroom safety check/ });
  await expect(hit).toBeVisible();
  await expectAccessible(page);
  await search.press('ArrowDown');
  await hit.click();
  await expect(page.getByRole('dialog', { name: 'Classroom safety check' })).toBeVisible();
});
