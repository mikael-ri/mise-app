import { chromium } from '@playwright/test';
import {
  BROWSER_ARGS,
  drive,
  loadCredentials,
  newSession,
  shot,
  startCallbackServer,
} from './portal.ts';
import { startAuth } from './rp.ts';
const browser = await chromium.launch({ args: BROWSER_ARGS });
const cb = await startCallbackServer();
const s = await newSession(browser, {
  authenticator: { isUserVerified: true, credentials: loadCredentials('bob') },
});
s.page.on('response', (r) => {
  if (r.url().includes('/api/') && r.request().method() !== 'GET')
    console.log('HTTP', r.status(), r.request().method(), r.url().slice(-45));
});
const req = startAuth({ prompt: 'login' });
await s.page.goto(req.url);
await s.page.waitForSelector('#passkey-sign-in-button');
await s.page.waitForTimeout(1500);
await s.page.locator('#passkey-sign-in-button').click();
await s.page.waitForTimeout(9000);
console.log('URL', s.page.url().slice(0, 110));
console.log(
  'BODY',
  (await s.page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 400),
);
await shot(s.page, 'bob-after-passkey');
const o = await drive(s.page, { user: 'bob', method: 'passkey', timeoutMs: 40_000 });
console.log('DRIVE', o.reachedCallback, o.steps);
await browser.close();
await cb.close();
