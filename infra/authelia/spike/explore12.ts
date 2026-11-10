import { chromium } from '@playwright/test';
import { BROWSER_ARGS, PUBLIC, newSession, shot } from './portal.ts';
const browser = await chromium.launch({ args: BROWSER_ARGS });
const s = await newSession(browser);
s.page.on('response', (r) => {
  if (r.status() >= 400) console.log('HTTP', r.status(), r.url().slice(0, 100));
});
await s.page.goto(PUBLIC + '/');
await s.page.waitForTimeout(6000);
console.log('URL', s.page.url());
console.log(
  'BODY',
  (await s.page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 300),
);
await shot(s.page, 'dbg-login-page');
await browser.close();
