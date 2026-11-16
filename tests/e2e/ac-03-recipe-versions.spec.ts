import { expect, test } from '@playwright/test';
import { installFakeApi } from '../support/fake-recipes-api.js';
import { RECIPE_ID } from '../../apps/web/src/features/recipes/recipe-fixtures.js';

// UI-ONLY (card A12): stubbed API (see tests/support/fake-recipes-api.ts). A16 must replace the stub with
// the real sign-in helper and rerun these flows, in particular the 409 conflict dialog, against the real
// server (AC-03, FR-03).
test.describe('UI-only (stubbed API): AC-03 versions, restore and conflicts', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('AC-03: a content edit makes a new current version and the earlier amount stays viewable', async ({
    page,
  }) => {
    await installFakeApi(page);
    await page.goto(`/recipes/${RECIPE_ID}/edit`);
    await page.getByLabel('Amount').first().fill('200');
    await page.getByLabel('What changed? (optional)').fill('Vähensin kalaa');
    await page.getByRole('button', { name: 'Save new version' }).first().click();

    await expect(page.getByTestId('ingredient-line').first()).toContainText('200 g');
    await page.getByRole('button', { name: 'Recipe actions' }).click();
    await page.getByRole('menuitem', { name: 'History' }).click();
    const rows = page.getByTestId('version-row');
    await expect(rows.first()).toContainText('v4');
    await expect(rows.first()).toContainText('Vähensin kalaa');

    await rows.filter({ hasText: 'v3' }).getByRole('link', { name: 'View v3' }).click();
    await expect(page.getByText('You are viewing v3 (not current)')).toBeVisible();
    await expect(page.getByTestId('ingredient-line').first()).toContainText('600 g');
  });

  test('AC-03: restore asks first, then creates a new version with the old content', async ({
    page,
  }) => {
    await installFakeApi(page);
    await page.goto(`/recipes/${RECIPE_ID}/versions`);
    await page.getByRole('button', { name: 'Restore v1' }).click();
    await expect(page.getByRole('dialog')).toContainText(
      "This creates a new version v4 with v1's content.",
    );
    await page.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByTestId('ingredient-line').first()).toContainText('800 g');
  });

  test('FR-03: 409 conflict dialog; second conflict keeps the draft; Save mine as newest succeeds', async ({
    page,
  }) => {
    const api = await installFakeApi(page);
    await page.goto(`/recipes/${RECIPE_ID}/edit`);
    const title = page.getByLabel('Title');
    await title.fill('Uunilohi ja uudet perunat');

    api.otherMemberEdits(RECIPE_ID, (c) => c);
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    const dialog = page.getByTestId('conflict-dialog');
    await expect(dialog).toContainText(
      'Another household member saved a newer version while you were editing.',
    );

    await dialog.getByRole('button', { name: 'Save mine as newest' }).click();
    await expect(dialog).toContainText('This replaces the current content with your edits.');
    // Someone saves again between our refetch and our write: that PATCH must 409 once more.
    api.otherMemberEditsBeforeNextPatch(RECIPE_ID);
    await dialog.getByRole('button', { name: 'Replace with my edits' }).click();
    await expect(dialog).toContainText('Someone saved again');
    await page.keyboard.press('Escape');
    await expect(title).toHaveValue('Uunilohi ja uudet perunat');

    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await dialog.getByRole('button', { name: 'Save mine as newest' }).click();
    await dialog.getByRole('button', { name: 'Replace with my edits' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Uunilohi ja uudet perunat' }),
    ).toBeVisible();
    expect(api.get(RECIPE_ID).title).toBe('Uunilohi ja uudet perunat');
  });

  test('FR-01: ingredients reorder within a group by keyboard drag and by the row menu', async ({
    page,
  }) => {
    await installFakeApi(page);
    await page.goto(`/recipes/${RECIPE_ID}/edit`);
    const names = page.getByLabel('Ingredient', { exact: true });
    await expect(names.nth(0)).toHaveValue('lohifilettä');

    await page.getByRole('button', { name: 'Drag to reorder' }).first().focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    await page.keyboard.press('Space');
    await expect(names.nth(0)).toHaveValue('perunaa');
    await expect(names.nth(1)).toHaveValue('lohifilettä');

    await page.getByRole('button', { name: 'Actions for ingredient perunaa' }).click();
    await page.getByRole('menuitem', { name: 'Move down' }).click();
    await expect(names.nth(0)).toHaveValue('lohifilettä');
  });

  test('archived recipe: list badge, read-only note with Restore on detail', async ({ page }) => {
    await installFakeApi(page);
    await page.goto(`/recipes/${RECIPE_ID}`);
    await page.getByRole('button', { name: 'Recipe actions' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByTestId('archived-note')).toContainText(
      'Restore this recipe to edit it.',
    );

    await page.goto('/recipes?archived=1');
    await expect(page.getByTestId('archived-badge')).toHaveText('Archived');
    await page.getByRole('button', { name: /^Restore / }).click();
    await expect(page.getByTestId('archived-badge')).toHaveCount(0);
  });
});
