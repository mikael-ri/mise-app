import { E2E_ORIGIN } from '../support/e2e-ports.js';
import { COLOR_SCHEMES, expectNoAxeViolations } from '../support/axe.js';
import { expect, test } from '../support/fixtures.js';
import { runToken, seedRecipeWithHistory } from '../support/seed.js';

// NFR-05 / AC-18: contrast and accessibility in a real browser, in both themes at 390 px. Covers the
// signed-out screens and every main authenticated screen (real server, real sign-in). Colour contrast is
// the part jsdom unit tests cannot check. The recipe form, list and history, and the shopping list with
// its item sheet and pending row, are also scanned in ac-18, ac-14 and ac-08 in the states they create.
for (const colorScheme of COLOR_SCHEMES) {
  test.describe(`NFR-05 axe, ${colorScheme} theme`, () => {
    for (const path of [
      '/signin',
      '/signin?reason=session_ended',
      '/signin?error=not_provisioned',
    ]) {
      test(`NFR-05: ${path} has no axe violations`, async ({ browser }) => {
        const context = await browser.newContext({
          colorScheme,
          viewport: { width: 390, height: 844 },
          baseURL: E2E_ORIGIN,
        });
        const page = await context.newPage();
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectNoAxeViolations(page);
        await context.close();
      });
    }

    test('NFR-05: every main authenticated screen has no axe violations', async ({ anna }) => {
      const { page } = anna;
      await page.emulateMedia({ colorScheme });
      const token = runToken();
      const recipe = await seedRecipeWithHistory(anna.api, `Uunilohi ${token}`);
      const list = await anna.api.createShoppingList({ name: `Axe ${token}` });

      for (const path of [
        '/recipes',
        '/recipes/new',
        `/recipes/${recipe.id}`,
        `/recipes/${recipe.id}/edit`,
        `/recipes/${recipe.id}/versions`,
        `/recipes/${recipe.id}/versions/${recipe.currentVersion.id}`,
        '/shopping',
        `/shopping/${list.id}`,
        '/settings',
        '/settings/devices',
        '/no-such-screen',
      ]) {
        await page.goto(path);
        // The not-found screen is an empty state without a level-1 heading; wait for its title instead.
        const ready =
          path === '/no-such-screen'
            ? page.getByText('Page not found')
            : page.getByRole('heading', { level: 1 });
        await expect(ready, path).toBeVisible();
        await expect(page.getByTestId('recipes-loading')).toHaveCount(0);
        await expectNoAxeViolations(page);
      }
    });
  });
}
