// Spike A03 evidence suite (NFR-01, AC-11; ADR-003/012). Runs against the dev stack (scripts/dev-up.sh).
// Not part of `pnpm check`/`pnpm e2e`: run with `pnpm exec playwright test -c infra/authelia/spike`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect, test, type Browser } from '@playwright/test';
import { request } from './http.ts';
import {
  BROWSER_ARGS,
  OUT,
  PUBLIC,
  drive,
  evidence,
  deleteWebauthnCredentials,
  registerPasskey,
  newSession,
  observe,
  seedTotp,
  startCallbackServer,
} from './portal.ts';
import { INTERNAL, PUBLIC_ISSUER, completeAuth, startAuth, type AuthRequest } from './rp.ts';

const FORWARDED = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'auth.mydomain.test:9443' };
const WK = '/.well-known/openid-configuration';

let browser: Browser;
let callback: { close: () => Promise<void> };
let aliceSecret: Buffer;

test.beforeAll(async () => {
  browser = await chromium.launch({ args: BROWSER_ARGS });
  callback = await startCallbackServer();
  const f = `${OUT}alice-totp.hex`;
  if (!existsSync(f)) writeFileSync(f, seedTotp('alice').toString('hex'));
  aliceSecret = Buffer.from(readFileSync(f, 'utf8'), 'hex');
});

test.afterAll(async () => {
  await browser.close();
  await callback.close();
});

test.describe.configure({ mode: 'default', timeout: 15 * 60_000 });

test('issuer/network: tokens and keys via internal URL, iss validated against the public issuer (NFR-01)', async () => {
  const pub = JSON.parse((await request(PUBLIC + WK)).body) as {
    issuer: string;
    token_endpoint: string;
  };
  expect(pub.issuer).toBe(PUBLIC_ISSUER);

  const bare = await request(INTERNAL + WK);
  expect(bare.status).toBe(400); // fails closed without forwarded headers

  const fwd = JSON.parse((await request(INTERNAL + WK, { headers: FORWARDED })).body) as {
    issuer: string;
  };
  expect(fwd.issuer).toBe(PUBLIC_ISSUER);

  const wrongHost = await request(INTERNAL + WK, {
    headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'evil.mydomain.test' },
  });
  expect(wrongHost.status).toBe(400);

  const wrongProto = await request(INTERNAL + WK, {
    headers: { 'X-Forwarded-Proto': 'http', 'X-Forwarded-Host': 'auth.mydomain.test:9443' },
  });
  expect(wrongProto.status).toBe(400);
  evidence('issuer', {
    public: pub.issuer,
    internalBare: bare.status,
    internalForwarded: fwd.issuer,
    wrongHost: wrongHost.status,
    wrongProto: wrongProto.status,
  });
});

test('config: two_factor client policy, no experimental keys, passkey UV required (tech 12)', () => {
  const cfg = readFileSync(new URL('../configuration.example.yml', import.meta.url), 'utf8');
  expect(cfg).toMatch(/authorization_policy: 'two_factor'/);
  expect(cfg).not.toMatch(/^\s*experimental_/m); // commented mentions are allowed only inside comments
  expect(cfg).toMatch(/user_verification: 'required'/);
});

interface Variant {
  name: string;
  params: { maxAge?: number; prompt?: string };
  waitMs: number;
  expectChallenge: boolean;
}

const VARIANTS: Variant[] = [
  { name: 'control: no freshness parameter', params: {}, waitMs: 8000, expectChallenge: false },
  { name: 'prompt=login', params: { prompt: 'login' }, waitMs: 8000, expectChallenge: true },
  { name: 'max_age=1', params: { maxAge: 1 }, waitMs: 8000, expectChallenge: true },
  {
    name: 'max_age=30 (after 35 s)',
    params: { maxAge: 30 },
    waitMs: 35_000,
    expectChallenge: true,
  },
];

type DriveOpts = Parameters<typeof drive>[1];
type TestSession = Awaited<ReturnType<typeof newSession>>;

const FACTOR_STEPS = [
  'first-factor',
  'password-reauth',
  'password-second-factor',
  'totp',
  'passkey-sign-in',
];

/** Logs in once (fresh), establishing the Authelia SSO cookie in this browser. */
async function initialLogin(s: TestSession, opts: DriveOpts, label: string): Promise<void> {
  const first = startAuth({ prompt: 'login' });
  await s.page.goto(first.url);
  const o1 = await drive(s.page, opts);
  expect(o1.reachedCallback, `initial login steps: ${o1.steps.join(',')}`).toBe(true);
  const t1 = await completeAuth(o1.url, first);
  evidence('initial-login', {
    method: label,
    amr: t1.claims.amr,
    hasAuthTime: typeof t1.claims.auth_time === 'number',
    steps: o1.steps,
  });
}

/**
 * Establishes an SSO session, then starts a NEW authorization request (the "revoked device" situation: Mise
 * has forgotten the device, Authelia's SSO cookie is still live). Records exactly which factors Authelia
 * asked for again and whether the RP accepts the resulting token.
 */
async function ssoReuse(s: TestSession, opts: DriveOpts, v: Variant, label: string): Promise<void> {
  await initialLogin(s, opts, label);
  await s.page.waitForTimeout(v.waitMs);
  const req: AuthRequest = startAuth(v.params);
  const screen = await observe(s.page, req.url);
  const o2 = await drive(s.page, opts);
  const factors = o2.steps.filter((x) => FACTOR_STEPS.includes(x));
  const rp = await completeAuth(o2.url, req).then(
    (r) => ({
      accepted: true as const,
      authTimeAfterRequestStartS: Number(r.claims.auth_time) - req.startedAt,
      amr: r.claims.amr,
    }),
    (e: unknown) => ({
      accepted: false as const,
      reason: e instanceof Error ? e.message : String(e),
    }),
  );
  evidence('sso-reuse', {
    method: label,
    variant: v.name,
    firstScreen: screen,
    steps: o2.steps,
    factorsRepresented: factors,
    secondFactorRepresented: factors.some((f) => f === 'totp' || f === 'passkey-sign-in'),
    rp,
  });
  if (v.expectChallenge) {
    expect(factors.length, `${v.name}: Authelia asked for no credential`).toBeGreaterThan(0);
    expect(rp.accepted, `${v.name}: fresh authentication was not proven`).toBe(true);
  } else {
    expect(factors, `${v.name}: control must not challenge`).toEqual([]);
    expect(rp.accepted, `${v.name}: RP must reject the stale token`).toBe(false);
  }
}

/** Mitigation: end the Authelia SSO session explicitly; the next request must need the full login again. */
async function afterPortalLogout(
  s: TestSession,
  opts: DriveOpts,
  label: string,
  fullLoginSteps: string[],
): Promise<void> {
  await initialLogin(s, opts, label);
  await s.page.goto(`${PUBLIC}/logout?rd=${encodeURIComponent('http://localhost:8765/callback')}`);
  await s.page.waitForTimeout(3000);
  const req = startAuth({ prompt: 'login' });
  const screen = await observe(s.page, req.url);
  const o2 = await drive(s.page, opts);
  const rp = await completeAuth(o2.url, req).then(
    (r) => ({ accepted: true as const, amr: r.claims.amr }),
    (e: unknown) => ({
      accepted: false as const,
      reason: e instanceof Error ? e.message : String(e),
    }),
  );
  evidence('after-portal-logout', { method: label, firstScreen: screen, steps: o2.steps, rp });
  expect(screen).toBe('login-form');
  for (const step of fullLoginSteps) expect(o2.steps).toContain(step);
  expect(rp.accepted).toBe(true);
}

for (const v of VARIANTS) {
  test(`AC-11 password+TOTP: new request with live SSO session, ${v.name}`, async () => {
    const s = await newSession(browser);
    await ssoReuse(
      s,
      { user: 'alice', method: 'password-totp', totpSecret: aliceSecret },
      v,
      'password+totp',
    );
    await s.ctx.close();
  });
}

test('AC-11 password+TOTP: after Authelia portal logout the full login (both factors) is required again', async () => {
  const s = await newSession(browser);
  await afterPortalLogout(
    s,
    { user: 'alice', method: 'password-totp', totpSecret: aliceSecret },
    'password+totp',
    ['first-factor', 'totp'],
  );
  await s.ctx.close();
});

// Needs Authelia started with MISE_AUTH_SSO_INACTIVITY=90s MISE_AUTH_SSO_EXPIRATION=5m (20s expires during the login itself).
test('AC-11 password+TOTP: after SSO inactivity expiry the full login is required again', async () => {
  test.skip(
    process.env.SSO_SHORT !== '1',
    'set SSO_SHORT=1 with a short-lifetime Authelia (see comment)',
  );
  const s = await newSession(browser);
  const opts = { user: 'alice', method: 'password-totp', totpSecret: aliceSecret } as const;
  await initialLogin(s, opts, 'password+totp');
  await s.page.waitForTimeout(Number(process.env.SSO_WAIT_MS ?? 100_000));
  const req = startAuth({ prompt: 'login' });
  const screen = await observe(s.page, req.url);
  const o2 = await drive(s.page, opts);
  evidence('after-sso-expiry', { method: 'password+totp', firstScreen: screen, steps: o2.steps });
  expect(screen).toBe('login-form');
  expect(o2.steps).toContain('totp');
  await s.ctx.close();
});

test('AC-11 password+TOTP: stale/forged token handling reaches the RP validator end to end', async () => {
  // A token for a different nonce (replay of an earlier flow's code/token) is rejected.
  const s = await newSession(browser);
  const opts = { user: 'alice', method: 'password-totp', totpSecret: aliceSecret } as const;
  const req = startAuth({ prompt: 'login' });
  await s.page.goto(req.url);
  const o = await drive(s.page, opts);
  expect(o.reachedCallback).toBe(true);
  await expect(completeAuth(o.url, { ...req, nonce: 'someone-elses-nonce' })).rejects.toThrow(
    /nonce/,
  );
  await expect(completeAuth(o.url.replace(/state=[^&]+/, 'state=forged'), req)).rejects.toThrow(
    /state mismatch/,
  );
  await s.ctx.close();
});

test('NFR-01 cookie attributes of the Authelia session cookie', async () => {
  const s = await newSession(browser);
  await s.page.goto(PUBLIC + '/');
  const cookies = await s.ctx.cookies();
  evidence('cookies-anonymous', {
    cookies: cookies.map((c) => ({
      name: c.name,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expires: c.expires,
    })),
  });
  await s.ctx.close();
});

test.describe('passkey (bob)', () => {
  const bobOpts = { user: 'bob', method: 'passkey' } as const;
  // One long-lived virtual authenticator for the whole suite: Chromium's virtual authenticator does not
  // honour an imported sign count, so a re-imported credential is (correctly) rejected by Authelia as cloned.
  let bob: Awaited<ReturnType<typeof newSession>>;

  const setUv = async (verified: boolean): Promise<void> => {
    await bob.cdp.send('WebAuthn.setUserVerified', {
      authenticatorId: bob.authenticatorId ?? '',
      isUserVerified: verified,
    });
  };

  test.beforeAll(async () => {
    deleteWebauthnCredentials('bob');
    bob = await newSession(browser, { authenticator: { isUserVerified: true } });
    await registerPasskey(bob, 'bob');
    await bob.ctx.clearCookies();
  });

  test.afterAll(async () => {
    await bob.ctx.close();
  });

  test.beforeEach(async () => {
    await bob.ctx.clearCookies(); // isolates the Authelia SSO state; the authenticator keeps its counters
    await setUv(true);
  });

  test('AC-11 passkey: user-verified login; record which steps Authelia requires for two_factor', async () => {
    const req = startAuth({ prompt: 'login' });
    await bob.page.goto(req.url);
    const o = await drive(bob.page, bobOpts);
    evidence('passkey-login', {
      reached: o.reachedCallback,
      steps: o.steps,
      finalUrl: o.url.slice(0, 80),
    });
    expect(o.reachedCallback, `passkey steps: ${o.steps.join(',')}`).toBe(true);
    const t = await completeAuth(o.url, req);
    evidence('passkey-token', {
      amr: t.claims.amr,
      acr: t.claims.acr,
      hasAuthTime: typeof t.claims.auth_time === 'number',
    });
  });

  for (const v of VARIANTS) {
    test(`AC-11 passkey: new request with live SSO session, ${v.name}`, async () => {
      await ssoReuse(bob, bobOpts, v, 'passkey');
    });
  }

  test('AC-11 passkey: after Authelia portal logout the passkey login is required again', async () => {
    await afterPortalLogout(bob, bobOpts, 'passkey', ['passkey-sign-in']);
  });

  test('NFR-01 passkey without user verification is rejected', async () => {
    await setUv(false);
    const req = startAuth({ prompt: 'login' });
    await bob.page.goto(req.url);
    const o = await drive(bob.page, { ...bobOpts, timeoutMs: 40_000 });
    evidence('passkey-no-uv', { reached: o.reachedCallback, steps: o.steps });
    expect(o.reachedCallback).toBe(false);
  });
});
