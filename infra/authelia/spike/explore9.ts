// Throwaway: cookie lifetime after first factor, with and without "Remember me".
import { chromium } from '@playwright/test';
import { BROWSER_ARGS, PUBLIC, firstFactor, newSession } from './portal.ts';
const browser = await chromium.launch({ args: BROWSER_ARGS });
for (const remember of [false, true]) {
  const s = await newSession(browser);
  await s.page.goto(PUBLIC + '/');
  await s.page.waitForSelector('#username-textfield');
  await s.page.waitForTimeout(1000);
  const visible = (await s.page.getByText('Remember me').count()) > 0;
  if (remember && visible) await s.page.getByText('Remember me').click();
  await firstFactor(s.page, 'alice', false);
  await s.page.waitForURL('**/2fa/**', { timeout: 60_000 });
  const c = (await s.ctx.cookies()).find((x) => x.name === 'authelia_session');
  console.log(
    `remember=${remember} checkboxVisible=${visible} cookie.expires-now=${c ? Math.round(c.expires - Date.now() / 1000) : 'n/a'}s secure=${c?.secure} httpOnly=${c?.httpOnly} sameSite=${c?.sameSite}`,
  );
  await s.ctx.close();
}
await browser.close();
