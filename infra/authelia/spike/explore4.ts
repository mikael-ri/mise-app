import { chromium } from '@playwright/test';
import { BROWSER_ARGS, newSession, registerPasskey } from './portal.ts';
const browser = await chromium.launch({ args: BROWSER_ARGS });
const s = await newSession(browser, { authenticator: { isUserVerified: true } });
await registerPasskey(s, 'bob');
await browser.close();
