import { expect, test } from '../support/fixtures.js';
import {
  runToken,
  salmonContent,
  seedRecipe,
  seedRecipeWithHistory,
  simpleContent,
} from '../support/seed.js';

// Real server and real sign-in (card A16). Specs share one database, so each makes its own recipes with
// a unique token in the title and tag and looks only at those.
test.describe('AC-02 recipe search and edit (real server)', () => {
  test('AC-02: search by name, open the shared recipe, edit it and see earlier versions', async ({
    anna,
    ankka,
  }) => {
    const token = runToken();
    // Ankka's recipe is found and opened by Anna: the recipe bank is shared.
    await seedRecipe(ankka.api, `Äidin kääretorttu ${token}`, { tags: ['jälkiruoka'] });
    await seedRecipe(ankka.api, `Pähkinäinen puuro ${token}`, { tags: ['aamiainen'] });
    const salmon = await seedRecipeWithHistory(ankka.api, `Uunilohi ja perunat ${token}`);

    const { page } = anna;
    await page.goto('/recipes');
    const search = page.getByTestId('recipe-search-input');
    await search.fill(token);
    await expect(page.getByTestId('recipe-card')).toHaveCount(3);

    await search.fill(`kääretorttu ${token}`);
    await expect(page.getByTestId('recipe-card')).toHaveCount(1);
    await expect(page.getByTestId('recipe-card')).toContainText('Äidin kääretorttu');

    await search.fill(`uunilohi ${token}`);
    await expect(page.getByTestId('recipe-card')).toHaveCount(1);
    await expect(page.getByTestId('recipe-card')).toContainText('Uunilohi ja perunat');
    await page.getByTestId('recipe-card').getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/recipes/${salmon.id}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: `Uunilohi ja perunat ${token}` }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Recipe actions' }).click();
    await page.getByRole('menuitem', { name: 'History' }).click();
    await expect(page.getByTestId('version-row').first()).toContainText('v3');
    await expect(page.getByTestId('version-row')).toHaveCount(3);
  });

  test('AC-02: tag chips and the time filter narrow the list; no results offers Clear search', async ({
    anna,
  }) => {
    const token = runToken();
    const tag = `jälkiruoka-${token}`;
    await seedRecipe(anna.api, `Äidin kääretorttu ${token}`, {
      tags: [tag],
      content: { ...salmonContent(), prep_minutes: 10, cook_minutes: 10 },
    });
    await seedRecipe(anna.api, `Pähkinäinen puuro ${token}`, { tags: ['aamiainen'] });
    await seedRecipe(anna.api, `Kiireetön keitto ${token}`, {
      tags: [tag],
      content: { ...simpleContent('porkkanaa'), prep_minutes: 20, cook_minutes: 60 },
    });

    const { page } = anna;
    await page.goto('/recipes');
    const search = page.getByTestId('recipe-search-input');
    await search.fill(token);
    await expect(page.getByTestId('recipe-card')).toHaveCount(3);
    await page.getByRole('button', { name: tag }).click();
    await expect(page.getByTestId('recipe-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'Under 30 min' }).click();
    await expect(page.getByTestId('recipe-card')).toHaveCount(1);
    await expect(page.getByTestId('recipe-card')).toContainText('Äidin kääretorttu');

    await search.fill('olematonhakusana');
    await expect(page.getByText('No recipes match "olematonhakusana"')).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(search).toHaveValue('');
  });
});
