import { expect, test } from '@playwright/test';
import { ErrorBody } from '../../packages/contracts/src/index.js';

// UI-only smoke, like the A12 and A15 specs: `/api/**` is stubbed in the browser, so it needs only
// Vite (no API server, database or secrets). The session endpoint answers "not signed in" and the
// app must send the visitor to /signin. The real health check (`/api/v1/health/live`) belongs to A16,
// which runs the suite against the real server.
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
