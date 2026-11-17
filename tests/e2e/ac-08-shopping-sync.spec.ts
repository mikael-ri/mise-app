import type { Page, Route } from '@playwright/test';
import { COLOR_SCHEMES, expectNoAxeViolations } from '../support/axe.js';
import { expect, test } from '../support/fixtures.js';
import { runToken } from '../support/seed.js';
import { cutStreams, restoreStreams } from '../support/stream-control.js';

// Real server, real SSE stream and real sign-in (card A16): Anna and Ankka are two member sessions,
// i.e. two devices. The connection loss is real too: tests/support/connection-proxy.ts drops the open event
// streams (Chromium's offline mode does not close a stream that is already open). The only stub is the delayed item response in the pending-row test.
test.describe('AC-08 live shopping list on two devices (real server)', () => {
  test.afterEach(async () => {
    await restoreStreams(); // never leave the streams cut for the next test
  });

  const row = (page: Page, name: string) =>
    page.getByTestId('shopping-item').filter({ hasText: name });

  async function addItems(page: Page, names: string[]) {
    const input = page.getByTestId('add-item-input');
    for (const name of names) {
      await input.fill(name);
      await input.press('Enter');
      await expect(row(page, name)).toBeVisible();
    }
  }

  // The server's categorizer puts a new free-text item in Other until someone files it (or the household
  // remembers a category for the name); filing is a real item edit, so it also exercises the sheet.
  async function fileUnder(page: Page, name: string, category: string) {
    await page.getByRole('button', { name: `Edit ${name}` }).click();
    const sheet = page.getByTestId('item-sheet');
    await sheet.getByLabel('Category').selectOption({ label: category });
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toBeHidden();
  }

  async function createList(page: Page, name: string) {
    await page.goto('/shopping');
    await page.getByRole('button', { name: 'New list' }).click();
    await page.getByRole('dialog').getByLabel('List name').fill(name);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\/shopping\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  }

  test('AC-08: a checkoff on one device reaches the other without reload, also after a reconnect', async ({
    anna,
    ankka,
  }) => {
    const a = anna.page;
    const b = ankka.page;

    // Device A creates a standalone list with groceries and a non-food item (FR-34, FR-35).
    await createList(a, `Weekend shop ${runToken()}`);
    await addItems(a, ['Maito', 'Porkkanat', 'Paristot AA']);
    await expect(a.getByTestId('sync-status')).toContainText('Live');
    await fileUnder(a, 'Maito', 'Dairy');
    await fileUnder(a, 'Porkkanat', 'Vegetables');

    // FR-36: grouped by category, Other last.
    await expect(a.getByRole('heading', { level: 2 })).toHaveText([
      /Vegetables \(1\)/,
      /Dairy \(1\)/,
      /Other \(1\)/,
    ]);

    // Device B opens the same list.
    const listPath = new URL(a.url()).pathname;
    await b.goto(listPath);
    await expect(row(b, 'Maito')).toBeVisible();
    await expect(b.getByTestId('sync-status')).toContainText('Live');
    await expect(b.getByRole('heading', { level: 2 })).toHaveText([
      /Vegetables \(1\)/,
      /Dairy \(1\)/,
      /Other \(1\)/,
    ]);

    // A checks off milk: B updates without a reload (FR-37).
    await row(a, 'Maito').getByTestId('item-checkbox').click();
    await expect(b.getByTestId('picked-section')).toContainText('Picked up (1)');
    await expect(b.getByTestId('list-progress')).toContainText('1 of 3 picked up');
    await expect(b.getByTestId('live-announcements')).toContainText('Maito picked up by Anna');
    // Attribution uses the real member name (B is Ankka, A is Anna).
    await b
      .getByTestId('picked-section')
      .getByRole('button', { name: /Picked up/ })
      .click();
    await b.getByRole('button', { name: 'Edit Maito' }).click();
    await expect(b.getByTestId('item-sheet')).toContainText('Picked up by Anna');
    await b.keyboard.press('Escape');
    await expect(b.getByTestId('item-sheet')).toBeHidden();

    // B loses the connection: indicator shows Reconnecting, the list stays visible.
    await cutStreams();
    await expect(b.getByTestId('sync-status')).toContainText('Reconnecting...');
    await expect(row(b, 'Porkkanat')).toBeVisible();

    // A checks off carrots while B is offline: B does not know yet.
    await row(a, 'Porkkanat').getByTestId('item-checkbox').click();
    await expect(a.getByTestId('picked-section')).toContainText('Picked up (2)');
    await expect(b.getByTestId('picked-section')).toContainText('Picked up (1)');

    // B reconnects: the client compares the cursor from the stream with its own seq and refetches over
    // REST (ADR-004 addendum). Wait for that refetch response, then for the result; no fixed sleeps.
    const listUrl = new RegExp(`/api/v1/shopping-lists/${listPath.split('/').pop()}$`);
    const refetched = b.waitForResponse(
      (r) => listUrl.test(r.url()) && r.request().method() === 'GET' && r.ok(),
      { timeout: 20_000 },
    );
    await restoreStreams();
    await refetched;
    await expect(b.getByTestId('picked-section')).toContainText('Picked up (2)');
    await expect(b.getByTestId('sync-status')).toContainText('Live', { timeout: 20_000 });

    // Axe, both themes, on the list and with the item sheet open (cf. conventions section 6).
    for (const scheme of COLOR_SCHEMES) {
      await a.emulateMedia({ colorScheme: scheme });
      await expectNoAxeViolations(a);
      await a.getByRole('button', { name: 'Edit Paristot AA' }).click();
      await expect(a.getByTestId('item-sheet')).toBeVisible();
      await expectNoAxeViolations(a);
      await a.keyboard.press('Escape');
      await expect(a.getByTestId('item-sheet')).toBeHidden();
    }
  });

  test('FR-35: an added item shows an "Adding…" placeholder at once, then lands in Other; axe passes with it visible', async ({
    anna,
  }) => {
    const { page } = anna;
    await createList(page, `Pending ${runToken()}`);

    // Hold the real server's answer to the item POST so the placeholder stays on screen.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/v1/shopping-lists/*/items', async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await gate;
      return route.continue();
    });

    const input = page.getByTestId('add-item-input');
    await input.fill('Pesusieni');
    await input.press('Enter');
    const placeholder = page.getByTestId('pending-item');
    await expect(placeholder).toContainText('Pesusieni');
    await expect(placeholder).toContainText('Adding…');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    for (const scheme of COLOR_SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectNoAxeViolations(page);
    }

    release();
    await expect(placeholder).toBeHidden();
    await expect(row(page, 'Pesusieni')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([/Other \(1\)/]);
  });
});
