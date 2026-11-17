import { expect, test } from '@playwright/test';
import { ErrorBody } from '../../packages/contracts/src/index.js';

// The API is real (started by playwright.config.ts). The signed-out redirect check stubs `/api/**` in the
// browser so it stays independent of auth state: the session endpoint answers "not signed in" and the app
// must send the visitor to /signin.
test('smoke: the API reports liveness', async ({ request }) => {
  const res = await request.get('/api/v1/health/live');
  expect(res.status()).toBe(200);
});

test('smoke: a signed-out visit to / redirects to the sign-in screen', async ({ page }) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify(
        ErrorBody.parse({
          code: 'unauthenticated',
          message: 'authentication required',
          correlationId: 'e2e-smoke',
        }),
      ),
    }),
  );

  await page.goto('/');

  // The app keeps the original path so sign-in can return to it (docs/ui/conventions.md section 1).
  await expect(page).toHaveURL(/\/signin\?returnTo=%2F$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mise');
  await expect(
    page.getByRole('link', { name: 'Sign in' }).or(page.getByRole('button', { name: 'Sign in' })),
  ).toBeVisible();
});
