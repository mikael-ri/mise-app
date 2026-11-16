import { expect, test } from '@playwright/test';
import { installFakeApi } from '../support/fake-recipes-api.js';
import { uuid } from '../../apps/web/src/features/recipes/recipe-fixtures.js';

// UI-ONLY (card A12): the API is stubbed with `installFakeApi`, which parses every response and request
// with the @mise/contracts schemas. A16 must swap the stub for the real sign-in helper and rerun this
// spec against the real server, including full-text search ranking (AC-02, FR-02, FR-07).
test.describe('UI-only (stubbed API): AC-02 recipe search and edit', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('AC-02: search by name, open the shared recipe, edit it and see earlier versions', async ({
    page,
  }) => {
    const api = await installFakeApi(page, [
      { id: uuid(901), title: 'Äidin kääretorttu', tags: ['jälkiruoka'] },
      { id: uuid(902), title: 'Pähkinäinen puuro', tags: ['aamiainen'] },
    ]);
    await page.goto('/recipes');
    await expect(page.getByTestId('recipe-card')).toHaveCount(3);

    await page.getByTestId('recipe-search-input').fill('kääre');
    await expect(page.getByTestId('recipe-card')).toHaveCount(1);
    await expect(page.getByTestId('recipe-card')).toContainText('Äidin kääretorttu');

    await page.getByTestId('recipe-search-input').fill('lohi');
    await expect(page.getByTestId('recipe-card')).toHaveText(/Uunilohi ja perunat/);
    await page.getByTestId('recipe-card').getByRole('link').click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Uunilohi ja perunat' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Recipe actions' }).click();
    await page.getByRole('menuitem', { name: 'History' }).click();
    await expect(page.getByTestId('version-row').first()).toContainText('v3');
    expect(api.requests.some((r) => r.startsWith('GET /api/v1/recipes?q=lohi'))).toBe(true);
  });

  test('AC-02: tag chips and the time filter narrow the list; no results offers Clear search', async ({
    page,
  }) => {
    await installFakeApi(page, [
      { id: uuid(901), title: 'Äidin kääretorttu', tags: ['jälkiruoka'] },
    ]);
    await page.goto('/recipes');
    await expect(page.getByTestId('recipe-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'jälkiruoka' }).click();
    await expect(page.getByTestId('recipe-card')).toHaveCount(1);
    await page.getByRole('button', { name: 'Under 30 min' }).click();
    await expect(page.getByTestId('recipe-card')).toHaveCount(1); // no time data: included
    await page.getByTestId('recipe-search-input').fill('olematon');
    await expect(page.getByText('No recipes match "olematon"')).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByTestId('recipe-search-input')).toHaveValue('');
  });
});
