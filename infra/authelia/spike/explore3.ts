// Spike A03 helper: explore passkey registration. Throwaway.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const OUT = new URL('./.out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  args: ['--host-resolver-rules=MAP *.mydomain.test 127.0.0.1'],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
});
await page.goto('https://auth.mydomain.test:9443/');
await page.fill('#username-textfield', 'bob');
await page.fill('#password-textfield', 'dev-only-Bob-pw-1');
await page.click('#sign-in-button');
await page.waitForURL('**/2fa/**', { timeout: 30000 });
await page.getByText('METHODS').click();
await page.getByText('SECURITY KEY - WEBAUTHN', { exact: false }).click();
await page.waitForTimeout(2000);
console.log('URL', page.url());
console.log('BODY', (await page.locator('body').innerText()).slice(0, 400));
await page.screenshot({ path: `${OUT}05-webauthn.png` });
const reg = page.getByText('Register device');
if (await reg.count()) {
  await reg.click();
  await page.waitForTimeout(3000);
}
await page.getByRole('button', { name: 'ADD' }).nth(1).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}07-add.png` });
console.log('AFTER ADD', (await page.locator('body').innerText()).slice(0, 500));
console.log('AFTER REGISTER', page.url(), (await page.locator('body').innerText()).slice(0, 400));
await page.screenshot({ path: `${OUT}06-register.png` });
try {
  console.log(
    'NOTIFICATION',
    readFileSync(new URL('../data/notification.txt', import.meta.url), 'utf8').slice(-700),
  );
} catch {
  console.log('no notification yet');
}
await browser.close();
