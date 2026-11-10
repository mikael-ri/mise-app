// Spike A03: Playwright helpers for driving the Authelia portal (dev stack). Throwaway evidence code.
import { readFileSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';
import { base32Decode, totp } from './totp.ts';

export const PUBLIC = 'https://auth.mydomain.test:9443';
export const PASSWORDS = { alice: 'dev-only-Alice-pw-1', bob: 'dev-only-Bob-pw-1' } as const;
export type User = keyof typeof PASSWORDS;

const HERE = new URL('.', import.meta.url).pathname;
export const OUT = `${HERE}.out/`;
const NOTIFICATION = `${HERE}../data/notification.txt`;
mkdirSync(OUT, { recursive: true });

/** Append one evidence record (JSON line) for the ADR addendum. */
export function evidence(kind: string, data: Record<string, unknown>): void {
  appendFileSync(
    `${OUT}evidence.jsonl`,
    JSON.stringify({ at: new Date().toISOString(), kind, ...data }) + '\n',
  );
}

export const BROWSER_ARGS = ['--host-resolver-rules=MAP *.mydomain.test 127.0.0.1'];

export interface Session {
  ctx: BrowserContext;
  page: Page;
  cdp: CDPSession;
  authenticatorId: string | null;
}

/** New isolated browser context (own cookies). `uv` controls the virtual authenticator's user verification. */
export async function newSession(
  browser: Browser,
  opts: { authenticator?: { isUserVerified: boolean; credentials?: unknown[] } } = {},
): Promise<Session> {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  let authenticatorId: string | null = null;
  if (opts.authenticator) {
    await cdp.send('WebAuthn.enable');
    const r = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: opts.authenticator.isUserVerified,
        automaticPresenceSimulation: true,
      },
    });
    authenticatorId = r.authenticatorId;
    for (const credential of opts.authenticator.credentials ?? []) {
      await cdp.send('WebAuthn.addCredential', { authenticatorId, credential } as never);
    }
  }
  return { ctx, page, cdp, authenticatorId };
}

/** Virtual-authenticator credentials die with the context; persist them (dev-only throwaway keys) to reuse. */
export async function exportCredentials(s: Session, user: User): Promise<void> {
  if (!s.authenticatorId) throw new Error('no authenticator');
  const { credentials } = await s.cdp.send('WebAuthn.getCredentials', {
    authenticatorId: s.authenticatorId,
  });
  writeFileSync(`${OUT}${user}-passkey.json`, JSON.stringify(credentials));
}

/** Removes all WebAuthn credentials of a user through the admin CLI (test isolation). */
export function deleteWebauthnCredentials(user: User): void {
  execFileSync(
    'docker',
    [
      'exec',
      'mise-authelia-authelia-1',
      'authelia',
      'storage',
      'user',
      'webauthn',
      'delete',
      user,
      '--all',
      '--config',
      '/config/configuration.yml',
    ],
    { encoding: 'utf8' },
  );
}

/** Persist the authenticator's current credentials (sign counts advance on every use) and close the context. */
export async function closeSession(s: Session, user?: User): Promise<void> {
  if (user && s.authenticatorId) await exportCredentials(s, user).catch(() => undefined);
  await s.ctx.close();
}

export function loadCredentials(user: User): unknown[] {
  try {
    return JSON.parse(readFileSync(`${OUT}${user}-passkey.json`, 'utf8')) as unknown[];
  } catch {
    return [];
  }
}

/** The notifier file is overwritten on every message, so detect a new code by comparing with the previous one. */
export function currentOtc(): string | null {
  try {
    const text = readFileSync(NOTIFICATION, 'utf8');
    return [...text.matchAll(/^([A-Z0-9]{8})$/gm)].at(-1)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function waitForNewOtc(previous: string | null, timeoutMs = 15_000): Promise<string> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const c = currentOtc();
    if (c && c !== previous) return c;
    if (Date.now() > end) throw new Error('no new one-time code in notifier output');
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Seeds a TOTP credential through the Authelia admin CLI and returns the secret (for the test only). */
export function seedTotp(user: User): Buffer {
  const out = execFileSync(
    'docker',
    [
      'exec',
      'mise-authelia-authelia-1',
      'authelia',
      'storage',
      'user',
      'totp',
      'generate',
      user,
      '--force',
      '--config',
      '/config/configuration.yml',
    ],
    { encoding: 'utf8' },
  );
  const m = /secret=([A-Z2-7]+)/.exec(out);
  if (!m?.[1]) throw new Error('could not read TOTP secret from CLI output');
  return base32Decode(m[1]);
}

/** Authelia rejects replay of a TOTP code within its window, so wait for a fresh window if this one was used. */
export async function freshTotp(secret: Buffer, user: User): Promise<string> {
  const f = `${OUT}${user}-totp-last.txt`;
  let last = -1;
  try {
    last = Number(readFileSync(f, 'utf8'));
  } catch {
    /* first use */
  }
  let counter = Math.floor(Date.now() / 30_000);
  if (counter <= last) {
    await new Promise((r) => setTimeout(r, (last + 1) * 30_000 - Date.now() + 1500));
    counter = Math.floor(Date.now() / 30_000);
  }
  writeFileSync(f, String(counter));
  return totp(secret, counter * 30);
}

export function currentTotp(secret: Buffer, offsetPeriods = 0): string {
  return totp(secret, Date.now() / 1000 + offsetPeriods * 30);
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}${name}.png` });
}

/** First-factor (username + password) on the Authelia login page. Argon2 verification is slow (seconds). */
export async function firstFactor(page: Page, user: User, remember = false): Promise<void> {
  await page.fill('#username-textfield', user);
  await page.fill('#password-textfield', PASSWORDS[user]);
  if (remember) await page.locator('#remember-checkbox').click();
  await page.click('#sign-in-button');
}

/** Registers a user-verified passkey for `user` via the portal settings (needs identity verification code). */
export async function registerPasskey(s: Session, user: User): Promise<void> {
  const { page } = s;
  await page.goto(PUBLIC + '/');
  await firstFactor(page, user);
  await page.waitForURL('**/2fa/**', { timeout: 60_000 });
  await page.waitForTimeout(2000);
  await page.getByText('Register device').click();
  await page.waitForURL('**/settings/two-factor-authentication');
  await page.waitForSelector('text=WebAuthn Credentials');
  await page.waitForTimeout(1500);
  const previousCode = currentOtc();
  await page.getByRole('button', { name: 'ADD' }).nth(1).click();
  await page.waitForSelector('text=Identity Verification', { timeout: 15_000 });
  await page.waitForTimeout(1500);
  await page.getByLabel('One-Time Code').fill(await waitForNewOtc(previousCode));
  await page.getByRole('button', { name: 'VERIFY' }).click();
  await page.getByLabel('Description').fill(`spike-passkey-${user}`);
  await page.getByRole('button', { name: 'NEXT' }).click();
  await page.waitForTimeout(6000);
  await shot(page, 'reg-after-next');
  const body = await page.locator('body').innerText();
  console.log('REG STEP', body.slice(0, 600));
  await exportCredentials(s, user);
}

/** Result of driving the portal until the RP callback or a dead end. `steps` records the screens seen (evidence). */
export interface Outcome {
  reachedCallback: boolean;
  url: string;
  steps: string[];
}

const CALLBACK = 'http://localhost:8765/callback';

export interface DriveOptions {
  user: User;
  /** How the user proves identity on a login form. */
  method: 'password-totp' | 'passkey';
  totpSecret?: Buffer;
  /** Stop (without completing) as soon as the first interactive challenge is seen. */
  stopAtChallenge?: boolean;
  timeoutMs?: number;
}

/**
 * State machine over whatever Authelia shows: login form, TOTP, consent, password re-check.
 * Returns when the RP callback is reached, when `stopAtChallenge` triggers, or on timeout/loop.
 */
export async function drive(page: Page, o: DriveOptions): Promise<Outcome> {
  const steps: string[] = [];
  const end = Date.now() + (o.timeoutMs ?? 120_000);
  const counts = new Map<string, number>();
  const seen = (k: string): number => {
    counts.set(k, (counts.get(k) ?? 0) + 1);
    return counts.get(k) ?? 0;
  };
  while (Date.now() < end) {
    if (page.url().startsWith(CALLBACK)) return { reachedCallback: true, url: page.url(), steps };
    const loginForm = await page
      .locator('#username-textfield')
      .isVisible()
      .catch(() => false);
    const totpPage = page.url().includes('/2fa/one-time-password');
    const reauth = await page
      .getByText('confirm your identity')
      .isVisible()
      .catch(() => false);
    const accept = page.getByRole('button', { name: 'ACCEPT' });
    const consent = await accept.isVisible().catch(() => false);

    if (process.env.DEBUG_DRIVE)
      console.log('DRIVE state', {
        loginForm,
        totpPage,
        reauth,
        consent,
        url: page.url().slice(0, 70),
      });
    if (loginForm) {
      if (o.stopAtChallenge)
        return {
          reachedCallback: false,
          url: page.url(),
          steps: [...steps, 'CHALLENGE:login-form'],
        };
      if (seen('login') > 2) break;
      if (o.method === 'passkey') {
        steps.push('passkey-sign-in');
        await page.locator('#passkey-sign-in-button').click();
      } else {
        steps.push('first-factor');
        await firstFactor(page, o.user);
      }
      await page.waitForTimeout(6000);
    } else if (totpPage && o.totpSecret) {
      if (o.stopAtChallenge)
        return { reachedCallback: false, url: page.url(), steps: [...steps, 'CHALLENGE:totp'] };
      if (seen('totp') > 2) break;
      steps.push('totp');
      await page.waitForTimeout(1500);
      await page.keyboard.type(await freshTotp(o.totpSecret, o.user));
      await page.waitForTimeout(5000);
    } else if (page.url().includes('/2fa/password')) {
      // Passkey (user-verified) sign-in is only the first step; Authelia asks for the password as second factor.
      if (o.stopAtChallenge)
        return {
          reachedCallback: false,
          url: page.url(),
          steps: [...steps, 'CHALLENGE:password-second-factor'],
        };
      if (seen('pw2') > 2) break;
      steps.push('password-second-factor');
      await page.locator('input[type=password]').fill(PASSWORDS[o.user]);
      await page.getByRole('button', { name: 'AUTHENTICATE' }).click();
      await page.waitForTimeout(6000);
    } else if (reauth) {
      if (o.stopAtChallenge)
        return {
          reachedCallback: false,
          url: page.url(),
          steps: [...steps, 'CHALLENGE:password-reauth'],
        };
      if (seen('reauth') > 2) break;
      const known =
        (await page
          .locator('input[type=password]')
          .isVisible()
          .catch(() => false)) &&
        (await page
          .getByRole('button', { name: 'SUBMIT' })
          .isVisible()
          .catch(() => false));
      if (!known) {
        // A re-check that is not the known password prompt. Record exactly what it shows.
        await shot(page, `unknown-reauth-${o.user}`);
        const text = (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 300);
        const buttons = (await page.getByRole('button').allInnerTexts()).join(' / ');
        steps.push(`unknown-reauth: ${text} [buttons: ${buttons}]`);
        break;
      }
      steps.push('password-reauth');
      await page.locator('input[type=password]').fill(PASSWORDS[o.user]);
      await page.getByRole('button', { name: 'SUBMIT' }).click();
      await page.waitForTimeout(6000);
      if (
        await page
          .getByText('Failed to confirm your identity')
          .isVisible()
          .catch(() => false)
      ) {
        steps.push('stale-failed-message-reload');
        await page.reload();
        await page.waitForTimeout(2500);
      }
    } else if (consent) {
      if (seen('consent') > 2) break;
      steps.push('consent-accept');
      await accept.click();
      await page.waitForTimeout(3000);
    } else {
      await page.waitForTimeout(500);
    }
  }
  return { reachedCallback: page.url().startsWith(CALLBACK), url: page.url(), steps };
}

/** Navigates to an authorization URL and reports what the portal does first (silent code vs challenge). */
export async function observe(page: Page, authUrl: string, settleMs = 8000): Promise<string> {
  await page.goto(authUrl).catch(() => undefined);
  const end = Date.now() + settleMs;
  while (Date.now() < end) {
    if (page.url().startsWith(CALLBACK)) return 'silent-callback';
    if (
      await page
        .locator('#username-textfield')
        .isVisible()
        .catch(() => false)
    )
      return 'login-form';
    if (
      await page
        .getByText('confirm your identity')
        .isVisible()
        .catch(() => false)
    )
      return 'password-reauth';
    if (page.url().includes('/2fa/')) return '2fa-page';
    if (
      await page
        .getByRole('button', { name: 'ACCEPT' })
        .isVisible()
        .catch(() => false)
    )
      return 'consent-screen';
    await page.waitForTimeout(300);
  }
  return `unknown:${page.url().slice(0, 80)}`;
}

/** Real listener standing in for Mise's /callback (Playwright route() is not applied to redirect targets). */
export async function startCallbackServer(): Promise<{ close: () => Promise<void> }> {
  const { createServer } = await import('node:http');
  const srv = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('callback');
  });
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(8765, '127.0.0.1', resolve);
  });
  return { close: () => new Promise<void>((r) => srv.close(() => r())) };
}
