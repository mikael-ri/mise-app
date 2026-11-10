import { chromium } from '@playwright/test';
import { BROWSER_ARGS, PUBLIC, firstFactor, newSession, shot } from './portal.ts';
const browser = await chromium.launch({ args: BROWSER_ARGS });
const s = await newSession(browser, { authenticator: { isUserVerified: true } });
const { page } = s;
await page.goto(PUBLIC + '/');
await firstFactor(page, 'bob');
await page.waitForURL('**/2fa/**', { timeout: 60_000 });
await page.waitForTimeout(2000);
await page.getByText('Register device').click();
await page.waitForTimeout(5000);
console.log('BODY', (await page.locator('body').innerText()).slice(0, 600));
await page.locator('#webauthn-credential-add').hover({ force: true });
await page.waitForTimeout(1500);
console.log(
  'TOOLTIP',
  await page.locator('[role=tooltip], [data-slot=tooltip-content]').allInnerTexts(),
);
await shot(page, 'dbg-settings2');
console.log(
  'ATTRS',
  await page
    .locator('#webauthn-credential-add')
    .evaluate((e) => e.getAttributeNames().map((n) => `${n}=${e.getAttribute(n)?.slice(0, 40)}`)),
);
await browser.close();
