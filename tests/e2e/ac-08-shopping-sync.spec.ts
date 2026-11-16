import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { COLOR_SCHEMES, expectNoAxeViolations } from '../support/axe.js';
import { FakeShoppingServer } from '../support/fake-shopping-api.js';

// UI-ONLY (card A15): stubbed API and a fake EventSource (see tests/support/fake-shopping-api.ts).
// A16 must replace the fake with the real sign-in helper and rerun this flow against the real
// server and the real SSE stream (AC-08, FR-34, FR-37).
test.describe('UI-only (stubbed API): AC-08 live shopping list on two devices', () => {
  const viewport = { width: 390, height: 844 };

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

  test('AC-08: a checkoff on one device reaches the other without reload, also after a reconnect', async ({
    browser,
  }) => {
    const server = new FakeShoppingServer();
    const contextA = await browser.newContext({ viewport });
    const contextB = await browser.newContext({ viewport });
    const a = await contextA.newPage();
    const b = await contextB.newPage();
    await server.attach(a);
    const clientB = await server.attach(b);

    // Device A creates a standalone list with groceries and a non-food item (FR-34, FR-35).
    await a.goto('/shopping');
    await a.getByRole('button', { name: 'New list' }).click();
    await a.getByRole('dialog').getByLabel('List name').fill('Weekend shop');
    await a.getByRole('button', { name: 'Create' }).click();
    await expect(a).toHaveURL(/\/shopping\/[0-9a-f-]+$/);
    await expect(a.getByRole('heading', { name: 'Weekend shop', level: 1 })).toBeVisible();
    await addItems(a, ['Milk', 'Carrots', 'Batteries AA']);
    await expect(a.getByTestId('sync-status')).toContainText('Live');

    // FR-36: grouped by category, Other last.
    const headings = a.getByRole('heading', { level: 2 });
    await expect(headings).toHaveText([/Vegetables \(1\)/, /Dairy \(1\)/, /Other \(1\)/]);

    // Device B opens the same list.
    await b.goto(new URL(a.url()).pathname);
    await expect(row(b, 'Milk')).toBeVisible();
    await expect(b.getByTestId('sync-status')).toContainText('Live');
    await expect(b.getByRole('heading', { level: 2 })).toHaveText([
      /Vegetables \(1\)/,
      /Dairy \(1\)/,
      /Other \(1\)/,
    ]);

    // A checks off milk: B updates without a reload (FR-37).
    await row(a, 'Milk').getByTestId('item-checkbox').click();
    await expect(b.getByTestId('picked-section')).toContainText('Picked up (1)');
    await expect(b.getByTestId('list-progress')).toContainText('1 of 3 picked up');
    await expect(b.getByTestId('live-announcements')).toContainText('Milk picked up');

    // B loses the connection: indicator shows Reconnecting, the list stays visible.
    await clientB.disconnect();
    await expect(b.getByTestId('sync-status')).toContainText('Reconnecting...');
    await expect(row(b, 'Carrots')).toBeVisible();

    // A checks off carrots while B is offline: B does not know yet.
    await row(a, 'Carrots').getByTestId('item-checkbox').click();
    await expect(a.getByTestId('picked-section')).toContainText('Picked up (2)');
    await expect(b.getByTestId('picked-section')).toContainText('Picked up (1)');

    // B reconnects: refetch brings the change, indicator is Live again.
    await clientB.reconnect();
    await expect(b.getByTestId('picked-section')).toContainText('Picked up (2)');
    await expect(b.getByTestId('sync-status')).toContainText('Live');

    // Axe, both themes, on the list and with the item sheet open (cf. conventions section 6).
    for (const scheme of COLOR_SCHEMES) {
      await a.emulateMedia({ colorScheme: scheme });
      await expectNoAxeViolations(a);
      await a.getByRole('button', { name: 'Edit Batteries AA' }).click();
      await expect(a.getByTestId('item-sheet')).toBeVisible();
      await expectNoAxeViolations(a);
      await a.keyboard.press('Escape');
      await expect(a.getByTestId('item-sheet')).toBeHidden();
    }

    await contextA.close();
    await contextB.close();
  });
});
