import { chromium } from '@playwright/test';
import { BROWSER_ARGS, newSession, shot } from './portal.ts';
import { startAuth } from './rp.ts';
const browser = await chromium.launch({ args: BROWSER_ARGS });
const s = await newSession(browser);
await s.ctx.route('http://localhost:8765/**', (r) => r.fulfill({ status: 200, body: 'callback' }));
s.page.on('response', (r) => {
  if (r.status() >= 300) console.log('HTTP', r.status(), r.url().slice(0, 160));
});
const req = startAuth({ maxAge: 0 });
console.log('AUTH URL', req.url);
await s.page.goto(req.url);
await s.page.waitForTimeout(4000);
console.log('URL', s.page.url());
console.log('BODY', (await s.page.locator('body').innerText()).slice(0, 400));
await shot(s.page, 'dbg-authurl');
await browser.close();
