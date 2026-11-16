import { expect, test } from '@playwright/test';
import { COLOR_SCHEMES, expectNoAxeViolations } from '../support/axe.js';

// NFR-05 / AC-18: contrast and accessibility in a real browser, in both themes.
// A16 extends this to the authenticated screens once the auth helper exists.
for (const colorScheme of COLOR_SCHEMES) {
  test.describe(`NFR-05 axe, ${colorScheme} theme`, () => {
    test.use({ colorScheme, viewport: { width: 390, height: 844 } });

    for (const path of [
      '/signin',
      '/signin?reason=session_ended',
      '/signin?error=not_provisioned',
    ]) {
      test(`NFR-05: ${path} has no axe violations`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectNoAxeViolations(page);
      });
    }
  });
}
