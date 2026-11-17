import { COLOR_SCHEMES, expectNoAxeViolations } from '../support/axe.js';
import { expect, test } from '../support/fixtures.js';
import { runToken, seedRecipe } from '../support/seed.js';

// Real server and real sign-in (card A16).
test.describe('AC-14 servings converter (real server)', () => {
  test('AC-14: yield 4 previews at 3 servings without persisting or calling the write API', async ({
    anna,
  }) => {
    const { page } = anna;
    const recipe = await seedRecipe(anna.api, `Uunilohi ${runToken()}`);
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/') && r.method() !== 'GET')
        writes.push(`${r.method()} ${r.url()}`);
    });

    await page.goto(`/recipes/${recipe.id}`);
    const lines = page.getByTestId('ingredient-line');
    await expect(lines.first()).toContainText('600 g');

    await page.getByTestId('servings-input').fill('3');
    await expect(lines.first()).toContainText('450 g');
    await expect(lines.nth(4)).toContainText('maun mukaan');
    await expect(page.getByText(/Preview only, not saved/)).toBeVisible();

    await page.getByTestId('servings-reset').click();
    await expect(page.getByTestId('servings-input')).toHaveValue('4');
    await expect(lines.first()).toContainText('600 g');

    await page.reload();
    await expect(page.getByTestId('servings-input')).toHaveValue('4');
    expect(writes).toEqual([]);
    expect((await anna.api.getRecipe(recipe.id)).revision).toBe(recipe.revision);
  });

  for (const colorScheme of COLOR_SCHEMES) {
    test(`NFR-05: detail with a preview has no axe violations, ${colorScheme} theme`, async ({
      anna,
    }) => {
      const { page } = anna;
      await page.emulateMedia({ colorScheme });
      const recipe = await seedRecipe(anna.api, `Uunilohi ${runToken()}`);
      await page.goto(`/recipes/${recipe.id}`);
      await page.getByTestId('servings-input').fill('3');
      await expect(page.getByText(/Preview only, not saved/)).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }
});
