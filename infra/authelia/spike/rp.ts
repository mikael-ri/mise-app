// Spike A03: the throwaway relying-party. Models what Mise's auth module (card A07) must do.
// - Discovery/JWKS/token calls go to the INTERNAL URL with forwarded headers describing the PUBLIC URL.
// - `iss` is validated against the PUBLIC issuer. Browser redirects use the PUBLIC authorization endpoint.
import { readFileSync } from 'node:fs';
import { request } from './http.ts';
import {
  buildAuthorizationUrl,
  generatePkce,
  randomToken,
  validateIdToken,
  type IdTokenClaims,
  type Jwks,
} from './oidc.ts';

export const PUBLIC_ISSUER = 'https://auth.mydomain.test:9443';
export const INTERNAL = 'http://127.0.0.1:9091';
export const REDIRECT_URI = 'http://localhost:8765/callback';
export const CLIENT_ID = 'mise';
const FORWARDED = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'auth.mydomain.test:9443' };

const secret = readFileSync(
  new URL('../secrets/oidc-client-secret.plain', import.meta.url),
  'utf8',
).trim();

export interface AuthRequest {
  url: string;
  state: string;
  nonce: string;
  verifier: string;
  /** Epoch seconds when the request was created (freshness reference). */
  startedAt: number;
  maxAge: number | undefined;
}

export function startAuth(opts: { maxAge?: number; prompt?: string } = {}): AuthRequest {
  const pkce = generatePkce();
  const state = randomToken();
  const nonce = randomToken();
  const url = buildAuthorizationUrl({
    publicAuthorizationEndpoint: `${PUBLIC_ISSUER}/api/oidc/authorization`,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    state,
    nonce,
    codeChallenge: pkce.challenge,
    ...(opts.maxAge !== undefined ? { maxAge: opts.maxAge } : {}),
    ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),
  });
  return {
    url,
    state,
    nonce,
    verifier: pkce.verifier,
    startedAt: Math.floor(Date.now() / 1000),
    maxAge: opts.maxAge,
  };
}

export async function fetchJwks(): Promise<Jwks> {
  const r = await request(`${INTERNAL}/jwks.json`, { headers: FORWARDED });
  if (r.status !== 200) throw new Error(`jwks fetch failed: ${r.status}`);
  return JSON.parse(r.body) as Jwks;
}

export interface TokenResult {
  idToken: string;
  claims: IdTokenClaims;
  raw: Record<string, unknown>;
}

/** Completes the flow from the callback URL: state check, code exchange (internal URL), ID-token validation. */
export async function completeAuth(
  callbackUrl: string,
  req: AuthRequest,
  skew = 5,
): Promise<TokenResult> {
  const cb = new URL(callbackUrl);
  const err = cb.searchParams.get('error');
  if (err) throw new Error(`authorization error: ${err}`);
  if (cb.searchParams.get('state') !== req.state) throw new Error('state mismatch');
  const code = cb.searchParams.get('code');
  if (!code) throw new Error('no code in callback');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: req.verifier,
  }).toString();
  const basic = Buffer.from(`${CLIENT_ID}:${secret}`).toString('base64');
  const r = await request(`${INTERNAL}/api/oidc/token`, {
    method: 'POST',
    headers: {
      ...FORWARDED,
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (r.status !== 200) throw new Error(`token endpoint ${r.status}`);
  const raw = JSON.parse(r.body) as Record<string, unknown>;
  const idToken = raw.id_token;
  if (typeof idToken !== 'string') throw new Error('no id_token');
  const claims = validateIdToken({
    token: idToken,
    jwks: await fetchJwks(),
    expectedIssuer: PUBLIC_ISSUER,
    clientId: CLIENT_ID,
    nonce: req.nonce,
    now: Math.floor(Date.now() / 1000),
    authRequestStartedAt: req.startedAt,
    skew,
  });
  return { idToken, claims, raw };
}
