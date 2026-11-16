import { expect, test } from '@playwright/test';
import { COLOR_SCHEMES, expectNoAxeViolations } from '../support/axe.js';
import { installFakeApi } from '../support/fake-recipes-api.js';
import { RECIPE_ID, uuid } from '../../apps/web/src/features/recipes/recipe-fixtures.js';

// UI-ONLY (card A12): stubbed API (see tests/support/fake-recipes-api.ts). A16 must replace the stub with
// the real sign-in helper and rerun this spec against the real server (AC-18, FR-05).
test.describe('UI-only (stubbed API): AC-18 Finnish recipes', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('AC-18: Finnish names, units and quantities render and survive a create round trip', async ({
    page,
  }) => {
    await installFakeApi(page, [
      { id: uuid(901), title: 'Äidin kääretorttu', tags: ['jälkiruoka'] },
    ]);
    await page.goto('/recipes');
    await expect(
      page.getByTestId('recipe-card').filter({ hasText: 'Äidin kääretorttu' }),
    ).toBeVisible();

    await page.goto(`/recipes/${RECIPE_ID}`);
    const lines = page.getByTestId('ingredient-line');
    await expect(lines.nth(0)).toContainText('lohifilettä');
    await expect(lines.nth(1)).toContainText('perunaa, kuorittuna');
    await expect(lines.nth(2)).toContainText('1,5 dl');
    await expect(lines.nth(3)).toContainText('1-2 kpl');
    await expect(page.getByText('Lämmitä uuni 200 asteeseen.')).toBeVisible();

    await page.goto('/recipes/new');
    await page.getByLabel('Title').fill('Pähkinäinen ruisleipä');
    await page.getByLabel('Yield', { exact: true }).fill('2');
    await page.getByLabel('Amount').fill('1,5');
    await page.getByLabel('Unit', { exact: true }).fill('rkl');
    await page.getByLabel('Ingredient', { exact: true }).fill('hunajaa, lämmitettynä');
    await page.getByRole('button', { name: 'Create recipe' }).first().click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Pähkinäinen ruisleipä' }),
    ).toBeVisible();
    await expect(page.getByTestId('ingredient-line')).toContainText('1,5 rkl');
    await expect(page.getByTestId('ingredient-line')).toContainText('hunajaa, lämmitettynä');
  });

  for (const colorScheme of COLOR_SCHEMES) {
    test(`NFR-05: list, history and form have no axe violations, ${colorScheme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await installFakeApi(page);
      for (const path of [
        '/recipes',
        `/recipes/${RECIPE_ID}/versions`,
        `/recipes/${RECIPE_ID}/edit`,
        '/recipes/new',
      ]) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByTestId('recipes-loading')).toHaveCount(0);
        await expectNoAxeViolations(page);
      }
    });
  }
});
