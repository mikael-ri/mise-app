import { COLOR_SCHEMES, expectNoAxeViolations } from '../support/axe.js';
import { expect, test } from '../support/fixtures.js';
import { runToken, seedRecipe } from '../support/seed.js';

// Real server and real sign-in (card A16).
test.describe('AC-18 Finnish recipes (real server)', () => {
  test('AC-18: Finnish names, units and quantities render and survive a create round trip', async ({
    anna,
  }) => {
    const { page } = anna;
    const token = runToken();
    await seedRecipe(anna.api, `Äidin kääretorttu ${token}`, { tags: ['jälkiruoka'] });
    const salmon = await seedRecipe(anna.api, `Uunilohi ${token}`);

    await page.goto('/recipes');
    await page.getByTestId('recipe-search-input').fill(token);
    await expect(
      page.getByTestId('recipe-card').filter({ hasText: `Äidin kääretorttu ${token}` }),
    ).toBeVisible();

    await page.goto(`/recipes/${salmon.id}`);
    const lines = page.getByTestId('ingredient-line');
    await expect(lines.nth(0)).toContainText('lohifilettä');
    await expect(lines.nth(1)).toContainText('perunaa, kuorittuna');
    await expect(lines.nth(2)).toContainText('1,5 dl');
    await expect(lines.nth(3)).toContainText('1-2 kpl');
    await expect(page.getByText('Lämmitä uuni 200 asteeseen.')).toBeVisible();

    await page.goto('/recipes/new');
    await page.getByLabel('Title').fill(`Pähkinäinen ruisleipä ${token}`);
    await page.getByLabel('Yield', { exact: true }).fill('2');
    await page.getByLabel('Amount').fill('1,5');
    await page.getByLabel('Unit', { exact: true }).fill('rkl');
    await page.getByLabel('Ingredient', { exact: true }).fill('hunajaa, lämmitettynä');
    await page.getByRole('button', { name: 'Create recipe' }).first().click();
    await expect(
      page.getByRole('heading', { level: 1, name: `Pähkinäinen ruisleipä ${token}` }),
    ).toBeVisible();
    await expect(page.getByTestId('ingredient-line')).toContainText('1,5 rkl');
    await expect(page.getByTestId('ingredient-line')).toContainText('hunajaa, lämmitettynä');
  });

  for (const colorScheme of COLOR_SCHEMES) {
    test(`NFR-05: list, history and form have no axe violations, ${colorScheme} theme`, async ({
      anna,
    }) => {
      const { page } = anna;
      await page.emulateMedia({ colorScheme });
      const recipe = await seedRecipe(anna.api, `Uunilohi ${runToken()}`);
      for (const path of [
        '/recipes',
        `/recipes/${recipe.id}/versions`,
        `/recipes/${recipe.id}/edit`,
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
