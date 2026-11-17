import { expect, test } from '../support/fixtures.js';
import { runToken, seedRecipe } from '../support/seed.js';

// AC-10: with no AI API access, members can still browse and edit existing recipes and manage shopping
// lists. The E2E stack is started with no AI configuration at all (playwright.config.ts sets no provider
// key, and Milestone A has no AI module), so every flow here runs with AI disabled.
test.describe('AC-10 recipes and shopping lists work with AI disabled', () => {
  test('AC-10: a member browses and edits a recipe', async ({ anna, ankka }) => {
    const { page } = anna;
    const title = `Uunilohi ${runToken()}`;
    const recipe = await seedRecipe(ankka.api, title);

    await page.goto('/recipes');
    await page.getByTestId('recipe-search-input').fill(title);
    await page.getByTestId('recipe-card').filter({ hasText: title }).getByRole('link').click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

    await page.goto(`/recipes/${recipe.id}/edit`);
    await page.getByLabel('Title').fill(`${title} paranneltu`);
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(
      page.getByRole('heading', { level: 1, name: `${title} paranneltu` }),
    ).toBeVisible();
  });

  test('AC-10: a member manages a shopping list', async ({ anna }) => {
    const { page } = anna;
    const name = `Kauppa ${runToken()}`;
    await page.goto('/shopping');
    await page.getByRole('button', { name: 'New list' }).click();
    await page.getByRole('dialog').getByLabel('List name').fill(name);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

    const input = page.getByTestId('add-item-input');
    await input.fill('Leipä');
    await input.press('Enter');
    const item = page.getByTestId('shopping-item').filter({ hasText: 'Leipä' });
    await expect(item).toBeVisible();
    await item.getByTestId('item-checkbox').click();
    await expect(page.getByTestId('picked-section')).toContainText('Picked up (1)');
  });
});
