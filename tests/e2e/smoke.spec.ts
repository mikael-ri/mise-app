import { expect, test } from '@playwright/test';

test('smoke: hello page renders and API is live', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mise');
  const res = await request.get('/api/v1/health/live');
  expect(res.status()).toBe(200);
});
