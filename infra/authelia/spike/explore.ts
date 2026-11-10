// Spike A03 helper: dump what the Authelia portal shows (selectors for the real spec). Throwaway.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const OUT = new URL('./.out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  args: ['--host-resolver-rules=MAP *.mydomain.test 127.0.0.1'],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await page.goto('https://auth.mydomain.test:9443/');
await page.waitForLoadState('networkidle');
await page.screenshot({ path: `${OUT}01-login.png` });
console.log(
  'INPUTS',
  await page
    .locator('input, button, a')
    .evaluateAll((els) =>
      els.map(
        (e) =>
          `${e.tagName}#${e.id}[${(e as HTMLInputElement).type ?? ''}] ${e.textContent?.trim().slice(0, 40)}`,
      ),
    ),
);
await page.fill('#username-textfield', 'bob');
await page.fill('#password-textfield', 'dev-only-Bob-pw-1');
await page.click('#sign-in-button');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(10000);
await page.screenshot({ path: `${OUT}02-after-first-factor.png` });
console.log('URL', page.url());
console.log('BODY', (await page.locator('body').innerText()).slice(0, 600));
await browser.close();
