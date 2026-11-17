// Real sign-in path for E2E: the app's own /signin -> /api/v1/auth/oidc/start -> callback, with the fake
// OIDC provider (tests/support/fake-oidc-server.ts) behind it. Only the browser-facing issuer URLs are
// answered here, inside the browser context; token, JWKS and discovery calls go server-to-server.
import type { BrowserContext, Page, Route } from '@playwright/test';
import { TEST_ISSUER } from '../../apps/server/src/auth/test-idp.js';

export const HOUSEHOLD_NAME = 'E2E Home';
/** Provisioned OIDC subjects and the names the UI shows for them (Anna is the owner). */
export const MEMBERS = {
  anna: { subject: 'e2e-anna', displayName: 'Anna' },
  ankka: { subject: 'e2e-ankka', displayName: 'Ankka' },
} as const;
export type MemberKey = keyof typeof MEMBERS;

export const authStatePath = (member: MemberKey): string =>
  new URL(`../.auth/${member}.json`, import.meta.url).pathname;

/**
 * Makes the issuer answer as `subject`, instantly and without a form. The issuer host does not resolve
 * and Chromium does not route redirect hops, so the two app endpoints that would redirect to it are
 * fetched without following the redirect and their `Location` is rewritten: /oidc/start jumps straight
 * to the callback (code = subject + nonce, read by the fake provider's token endpoint), and the callback's
 * hop through the issuer's portal logout goes straight to its `rd` target. The server code is unchanged.
 */
export async function installFakeIssuer(context: BrowserContext, subject: string): Promise<void> {
  const rewrite = async (route: Route, redirect: (location: URL) => string) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const location = response.headers()['location'];
    if (response.status() !== 302 || location === undefined) {
      await route.fulfill({ response });
      return;
    }
    const headers = { ...response.headers(), location: redirect(new URL(location)) };
    await route.fulfill({ response, headers });
  };
  await context.route('**/api/v1/auth/oidc/start*', (route) =>
    rewrite(route, (authorization) => {
      const callback = new URL(authorization.searchParams.get('redirect_uri') ?? '');
      const nonce = authorization.searchParams.get('nonce') ?? '';
      callback.searchParams.set(
        'code',
        Buffer.from(JSON.stringify({ sub: subject, nonce })).toString('base64url'),
      );
      callback.searchParams.set('state', authorization.searchParams.get('state') ?? '');
      callback.searchParams.set('iss', TEST_ISSUER);
      return callback.toString();
    }),
  );
  await context.route('**/api/v1/auth/oidc/callback*', (route) =>
    rewrite(route, (logout) => logout.searchParams.get('rd') ?? '/'),
  );
}

/** Signs `page` in through the real UI and OIDC callback; resolves once the app shell has loaded. */
export async function signIn(page: Page, subject: string): Promise<void> {
  await installFakeIssuer(page.context(), subject);
  await page.goto('/signin');
  await page
    .getByRole('link', { name: 'Sign in' })
    .or(page.getByRole('button', { name: 'Sign in' }))
    .click();
  await page.waitForURL(
    (u) => !u.pathname.startsWith('/signin') && !u.pathname.startsWith('/api/'),
  );
}
