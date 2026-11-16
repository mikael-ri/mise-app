import { expect, test } from '@playwright/test';
import { COLOR_SCHEMES, expectNoAxeViolations } from '../support/axe.js';
import { installFakeApi } from '../support/fake-recipes-api.js';
import { RECIPE_ID } from '../../apps/web/src/features/recipes/recipe-fixtures.js';

// UI-ONLY (card A12): stubbed API (see tests/support/fake-recipes-api.ts). A16 must replace the stub with
// the real sign-in helper and rerun this spec against the real server (AC-14, FR-06).
test.describe('UI-only (stubbed API): AC-14 servings converter', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('AC-14: yield 4 previews at 3 servings without persisting or calling the write API', async ({
    page,
  }) => {
    const api = await installFakeApi(page);
    await page.goto(`/recipes/${RECIPE_ID}`);
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
    expect(api.requests.filter((r) => !r.startsWith('GET '))).toEqual([]);
    expect(api.get(RECIPE_ID).revision).toBe(3);
  });

  for (const colorScheme of COLOR_SCHEMES) {
    test(`NFR-05: detail with a preview has no axe violations, ${colorScheme} theme`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await installFakeApi(page);
      await page.goto(`/recipes/${RECIPE_ID}`);
      await page.getByTestId('servings-input').fill('3');
      await expect(page.getByText(/Preview only, not saved/)).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }
});
