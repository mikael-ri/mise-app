import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import {
  BROWSER_ARGS,
  OUT,
  PUBLIC,
  drive,
  newSession,
  observe,
  startCallbackServer,
} from './portal.ts';
import { completeAuth, startAuth } from './rp.ts';
const secret = Buffer.from(readFileSync(`${OUT}alice-totp.hex`, 'utf8'), 'hex');
const opts = { user: 'alice', method: 'password-totp', totpSecret: secret } as const;
const browser = await chromium.launch({ args: BROWSER_ARGS });
const cb = await startCallbackServer();
const s = await newSession(browser);
const first = startAuth({ prompt: 'login' });
await s.page.goto(first.url);
const o1 = await drive(s.page, opts);
const t1 = await completeAuth(o1.url, first);
console.log('LOGIN', o1.steps, 'amr', t1.claims.amr);
console.log(
  'COOKIES BEFORE',
  (await s.ctx.cookies()).map(
    (c) => `${c.name} exp=${c.expires} secure=${c.secure} http=${c.httpOnly} ss=${c.sameSite}`,
  ),
);
// Explicit portal logout, as Mise could do right after minting its own session.
const resp = await s.page
  .goto(`${PUBLIC}/logout?rd=${encodeURIComponent('http://localhost:8765/callback')}`)
  .catch((e: unknown) => String(e));
await s.page.waitForTimeout(4000);
console.log(
  'LOGOUT landed',
  s.page.url().slice(0, 100),
  typeof resp === 'string' ? resp : resp?.status(),
);
console.log(
  'COOKIES AFTER',
  (await s.ctx.cookies()).map((c) => `${c.name} exp=${c.expires}`),
);
const req = startAuth({ prompt: 'login' });
console.log('NEXT REQUEST first screen:', await observe(s.page, req.url));
await browser.close();
await cb.close();
