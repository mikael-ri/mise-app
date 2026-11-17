import type { Route } from '@playwright/test';
import { ErrorBody } from '../../packages/contracts/src/index.js';
import { expect, test } from '../support/fixtures.js';
import { runToken, seedRecipeWithHistory } from '../support/seed.js';

// Real server and real sign-in (card A16): two household members, Anna and Ankka, each with their own
// device session. The only stub is the 500 in the non-409 failure test, which the server cannot produce.
test.describe('AC-03 versions, restore and conflicts (real server)', () => {
  test('AC-03: a content edit makes a new current version and the earlier amount stays viewable', async ({
    anna,
  }) => {
    const { page } = anna;
    const recipe = await seedRecipeWithHistory(anna.api, `Uunilohi ${runToken()}`);
    await page.goto(`/recipes/${recipe.id}/edit`);
    await page.getByLabel('Amount').first().fill('200');
    await page.getByLabel('What changed? (optional)').fill('Vähensin kalaa vielä');
    await page.getByRole('button', { name: 'Save new version' }).first().click();

    await expect(page.getByTestId('ingredient-line').first()).toContainText('200 g');
    await page.getByRole('button', { name: 'Recipe actions' }).click();
    await page.getByRole('menuitem', { name: 'History' }).click();
    const rows = page.getByTestId('version-row');
    await expect(rows.first()).toContainText('v4');
    await expect(rows.first()).toContainText('Vähensin kalaa vielä');

    await rows.filter({ hasText: 'v3' }).getByRole('link', { name: 'View v3' }).click();
    await expect(page.getByText('You are viewing v3 (not current)')).toBeVisible();
    await expect(page.getByTestId('ingredient-line').first()).toContainText('600 g');
  });

  test('AC-03: restore asks first, then creates a new version with the old content', async ({
    anna,
  }) => {
    const { page } = anna;
    const recipe = await seedRecipeWithHistory(anna.api, `Uunilohi ${runToken()}`);
    await page.goto(`/recipes/${recipe.id}/versions`);
    await page.getByRole('button', { name: 'Restore v1' }).click();
    await expect(page.getByRole('dialog')).toContainText(
      "This creates a new version v4 with v1's content.",
    );
    await page.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByTestId('ingredient-line').first()).toContainText('800 g');
    expect((await anna.api.getRecipe(recipe.id)).currentVersion.versionNo).toBe(4);
  });

  test('FR-03: 409 conflict dialog; second conflict keeps the draft; Save mine as newest succeeds', async ({
    anna,
    ankka,
  }) => {
    const { page } = anna;
    const title = `Uunilohi ${runToken()}`;
    const mine = `${title} ja uudet perunat`;
    const recipe = await seedRecipeWithHistory(anna.api, title);
    await page.goto(`/recipes/${recipe.id}/edit`);
    const field = page.getByLabel('Title');
    await field.fill(mine);

    // Ankka saves while Anna is editing.
    await ankka.api.patchRecipe(await ankka.api.getRecipe(recipe.id), { tags: ['kala', 'ankka'] });
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    const dialog = page.getByTestId('conflict-dialog');
    await expect(dialog).toContainText(
      'Another household member saved a newer version while you were editing.',
    );

    await dialog.getByRole('button', { name: 'Save mine as newest' }).click();
    await expect(dialog).toContainText('This replaces the current content with your edits.');
    // "Replace with my edits" refetches the latest recipe, then writes. Ankka saves right after that
    // real GET answered, so Anna's write is stale again and the real server answers 409 a second time.
    const handler = async (route: Route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const response = await route.fetch();
      await ankka.api.patchRecipe(await ankka.api.getRecipe(recipe.id), { tags: ['kala', 'taas'] });
      return route.fulfill({ response });
    };
    await page.route(`**/api/v1/recipes/${recipe.id}`, handler);
    await dialog.getByRole('button', { name: 'Replace with my edits' }).click();
    await expect(dialog).toContainText('Someone saved again');
    await page.unroute(`**/api/v1/recipes/${recipe.id}`, handler);
    await page.keyboard.press('Escape');
    await expect(field).toHaveValue(mine);

    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await dialog.getByRole('button', { name: 'Save mine as newest' }).click();
    await dialog.getByRole('button', { name: 'Replace with my edits' }).click();
    await expect(page.getByRole('heading', { level: 1, name: mine })).toBeVisible();
    expect((await anna.api.getRecipe(recipe.id)).title).toBe(mine);
  });

  test('FR-03: "Open latest version" shows the other member\'s save and drops the draft', async ({
    anna,
    ankka,
  }) => {
    const { page } = anna;
    const title = `Uunilohi ${runToken()}`;
    const recipe = await seedRecipeWithHistory(anna.api, title);
    await page.goto(`/recipes/${recipe.id}/edit`);
    await page.getByLabel('Title').fill(`${title} minun`);

    await ankka.api.patchRecipe(await ankka.api.getRecipe(recipe.id), {
      title: `${title} Ankan`,
    });
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await page
      .getByTestId('conflict-dialog')
      .getByRole('button', { name: 'Open latest version' })
      .click();
    await expect(page.getByTestId('conflict-dialog')).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: `${title} Ankan` })).toBeVisible();
    expect((await anna.api.getRecipe(recipe.id)).title).toBe(`${title} Ankan`);
  });

  test('FR-03: a non-409 failure while replacing is shown in the dialog and keeps the draft', async ({
    anna,
    ankka,
  }) => {
    const { page } = anna;
    const title = `Uunilohi ${runToken()}`;
    const mine = `${title} minun`;
    const recipe = await seedRecipeWithHistory(anna.api, title);
    await page.goto(`/recipes/${recipe.id}/edit`);
    await page.getByLabel('Title').fill(mine);
    await ankka.api.patchRecipe(await ankka.api.getRecipe(recipe.id), { tags: ['kala', 'ankka'] });
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    const dialog = page.getByTestId('conflict-dialog');
    await dialog.getByRole('button', { name: 'Save mine as newest' }).click();

    // Stub: the real server cannot be made to fail with a 500 on demand.
    await page.route(`**/api/v1/recipes/${recipe.id}`, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify(
              ErrorBody.parse({
                code: 'internal_error',
                message: 'boom',
                correlationId: 'e2e-500',
              }),
            ),
          })
        : route.fallback(),
    );
    await dialog.getByRole('button', { name: 'Replace with my edits' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Title')).toHaveValue(mine);
    expect((await anna.api.getRecipe(recipe.id)).title).toBe(title);
  });

  test('FR-01: ingredients reorder within a group by keyboard drag and by the row menu', async ({
    anna,
  }) => {
    const { page } = anna;
    const recipe = await seedRecipeWithHistory(anna.api, `Uunilohi ${runToken()}`);
    await page.goto(`/recipes/${recipe.id}/edit`);
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

  test('archived recipe: list badge, read-only note with Restore on detail', async ({ anna }) => {
    const { page } = anna;
    const title = `Uunilohi ${runToken()}`;
    const recipe = await seedRecipeWithHistory(anna.api, title);
    await page.goto(`/recipes/${recipe.id}`);
    await page.getByRole('button', { name: 'Recipe actions' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByTestId('archived-note')).toContainText(
      'Restore this recipe to edit it.',
    );

    await page.goto('/recipes?archived=1');
    await page.getByTestId('recipe-search-input').fill(title);
    const card = page.getByTestId('recipe-card').filter({ hasText: title });
    await expect(card.getByTestId('archived-badge')).toHaveText('Archived');
    await card.getByRole('button', { name: /^Restore / }).click();
    await expect(card.getByTestId('archived-badge')).toHaveCount(0);
  });
});
