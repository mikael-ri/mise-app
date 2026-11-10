import { chromium } from '@playwright/test';
import {
  BROWSER_ARGS,
  deleteWebauthnCredentials,
  drive,
  newSession,
  registerPasskey,
  shot,
  startCallbackServer,
} from './portal.ts';
import { completeAuth, startAuth } from './rp.ts';
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${Math.round((Date.now() - t0) / 1000)}s]`, ...a);
const browser = await chromium.launch({ args: BROWSER_ARGS });
const cb = await startCallbackServer();
deleteWebauthnCredentials('bob');
const bob = await newSession(browser, { authenticator: { isUserVerified: true } });
await registerPasskey(bob, 'bob');
await bob.ctx.clearCookies();
log('registered; starting login');
bob.page.on('response', (r) => {
  if (r.url().includes('/api/') && r.request().method() !== 'GET')
    log('HTTP', r.status(), r.request().method(), r.url().slice(-40));
});
const req = startAuth({ prompt: 'login' });
await bob.page.goto(req.url);
log('at', bob.page.url().slice(0, 90));
const o = await Promise.race([
  drive(bob.page, { user: 'bob', method: 'passkey', timeoutMs: 60_000 }),
  new Promise<never>((_, rej) => setTimeout(() => rej(new Error('drive hung >90s')), 90_000)),
]);
log('DRIVE', o.reachedCallback, o.steps, o.url.slice(0, 90));
await shot(bob.page, 'bob-drive-end');
log('BODY', (await bob.page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 300));
if (o.reachedCallback) {
  const t = await Promise.race([
    completeAuth(o.url, req),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('completeAuth hung')), 20_000)),
  ]);
  log(
    'CLAIMS',
    JSON.stringify({ amr: t.claims.amr, acr: t.claims.acr, auth_time: t.claims.auth_time }),
  );
}
await browser.close();
await cb.close();
