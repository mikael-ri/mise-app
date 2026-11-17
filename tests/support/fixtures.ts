// Two real member sessions (Anna and Ankka, provisioned in global-setup) as Playwright fixtures. Each is a
// fresh browser context holding that member's stored device session, at 390 px width. Use `anna` alone
// for single-user flows and both for conflicts and live sync.
import { test as base, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { E2E_ORIGIN } from './e2e-ports.js';
import { MemberApi } from './api.js';
import { authStatePath, type MemberKey } from './auth.js';

export interface MemberSession {
  context: BrowserContext;
  page: Page;
  api: MemberApi;
}

export const MOBILE = { width: 390, height: 844 } as const;

export const test = base.extend<{
  anna: MemberSession;
  ankka: MemberSession;
}>({
  anna: async ({ browser }, use) => {
    const session = await open(browser, 'anna');
    await use(session);
    await session.context.close();
  },
  ankka: async ({ browser }, use) => {
    const session = await open(browser, 'ankka');
    await use(session);
    await session.context.close();
  },
});

async function open(browser: Browser, member: MemberKey): Promise<MemberSession> {
  const context = await browser.newContext({
    baseURL: E2E_ORIGIN,
    storageState: authStatePath(member),
    viewport: MOBILE,
  });
  const page = await context.newPage();
  return { context, page, api: new MemberApi(context.request) };
}

export { expect } from '@playwright/test';
