import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import {
  startCallbackServer,
  driveToCallback,
  BROWSER_ARGS,
  OUT,
  freshTotp,
  firstFactor,
  newSession,
  seedTotp,
  shot,
} from './portal.ts';
import { REDIRECT_URI, completeAuth, startAuth } from './rp.ts';

const f = `${OUT}alice-totp.hex`;
if (!existsSync(f)) writeFileSync(f, seedTotp('alice').toString('hex'));
const secret = Buffer.from(readFileSync(f, 'utf8'), 'hex');

const browser = await chromium.launch({ args: BROWSER_ARGS });
const s = await newSession(browser);
const cbServer = await startCallbackServer();
s.page.on('response', (r) => {
  if (r.url().includes('/api/oidc/consent') || r.url().includes('reauth') || r.status() >= 400)
    console.log('HTTP', r.status(), r.request().method(), r.url().slice(0, 110));
});
s.page.on('framenavigated', (f) => {
  if (f === s.page.mainFrame()) console.log('NAV', f.url().slice(0, 120));
});
s.page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200));
});
s.page.on('response', async (r) => {
  if (
    r.url().includes('/reauthenticate') ||
    (r.url().includes('/api/oidc/consent') && r.request().method() === 'POST')
  )
    console.log(
      'BODYOF',
      r.request().method(),
      r.url().slice(-40),
      r.status(),
      (await r.text().catch(() => '')).slice(0, 300),
      'REQ',
      (r.request().postData() ?? '')
        .replace(/"password":"[^"]*"/, '"password":"***"')
        .slice(0, 200),
    );
});
s.page.on('requestfailed', (r) =>
  console.log('REQFAILED', r.url().slice(0, 140), r.failure()?.errorText),
);
s.page.on('response', (r) => {
  if (r.status() >= 300 && r.status() < 400)
    console.log(
      'REDIRECT',
      r.status(),
      r.url().slice(0, 90),
      '->',
      (r.headers()['location'] ?? '').slice(0, 130),
    );
});
const req = startAuth({
  ...(process.env.MAXAGE ? { maxAge: Number(process.env.MAXAGE) } : {}),
  ...(process.env.PROMPT ? { prompt: process.env.PROMPT } : {}),
});
console.log('REQ PARAMS', process.env.MAXAGE, process.env.PROMPT);
await s.page.goto(req.url);
await firstFactor(s.page, 'alice');
await s.page.waitForTimeout(8000);
console.log('URL after 1FA', s.page.url());
await shot(s.page, 'a-after-1fa');
console.log('BODY', (await s.page.locator('body').innerText()).slice(0, 300));
console.log(
  'INPUTS',
  await s.page
    .locator('input')
    .evaluateAll((els) =>
      els.map(
        (e) => `${e.id}|${(e as HTMLInputElement).type}|${(e as HTMLInputElement).maxLength}`,
      ),
    ),
);
await s.page.keyboard.type(await freshTotp(secret, 'alice'));
await s.page.waitForTimeout(3000);
const o = await driveToCallback(s.page, 'alice');
console.log('OUTCOME', JSON.stringify(o.steps), o.reachedCallback, o.url);
await shot(s.page, 'a-final');
console.log('FINAL BODY', (await s.page.locator('body').innerText()).slice(0, 400));
if (o.reachedCallback) {
  const r = await completeAuth(o.url, req);
  const { sub: _sub, ...rest } = r.claims;
  console.log('CLAIMS', JSON.stringify(rest));
}
await browser.close();
await cbServer.close();
