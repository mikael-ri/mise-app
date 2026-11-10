// Spike A03 helper: explore the device-registration flow. Throwaway.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const OUT = new URL('./.out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  args: ['--host-resolver-rules=MAP *.mydomain.test 127.0.0.1'],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await page.goto('https://auth.mydomain.test:9443/');
await page.fill('#username-textfield', 'bob');
await page.fill('#password-textfield', 'dev-only-Bob-pw-1');
await page.click('#sign-in-button');
await page.waitForURL('**/2fa/**', { timeout: 30000 });
await page.getByText('METHODS').click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}03-methods.png` });
console.log('METHODS BODY', (await page.locator('body').innerText()).slice(0, 500));
await page.goto('https://auth.mydomain.test:9443/settings');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}04-settings.png` });
console.log('SETTINGS URL', page.url());
console.log('SETTINGS BODY', (await page.locator('body').innerText()).slice(0, 700));
try {
  console.log(
    'NOTIFICATION',
    readFileSync(new URL('../data/notification.txt', import.meta.url), 'utf8').slice(-600),
  );
} catch {
  console.log('no notification yet');
}
await browser.close();
