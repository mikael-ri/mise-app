// Spike A03: minimal OIDC relying-party helpers (PKCE, authorization URL, ID-token validation).
// Throwaway evidence code, not production. Node >= 24 (built-in crypto + fetch, no dependencies).
import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from 'node:crypto';

export interface Jwks {
  keys: Array<JsonWebKey & { kid?: string; use?: string; alg?: string }>;
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nonce?: string;
  auth_time?: number;
  azp?: string;
  amr?: string[];
  acr?: string;
  [claim: string]: unknown;
}

export interface ValidationInput {
  token: string;
  jwks: Jwks;
  /** The PUBLIC issuer, exactly as configured. Never the internal URL. */
  expectedIssuer: string;
  clientId: string;
  nonce: string;
  /** Seconds since epoch. */
  now: number;
  /** When this authorization request was started (epoch seconds). auth_time must not predate it. */
  authRequestStartedAt: number;
  /** Tolerated clock skew in seconds (same host in this deployment, so small). */
  skew?: number;
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function buildAuthorizationUrl(p: {
  publicAuthorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  /** Omit to demonstrate the control case (no freshness request). */
  maxAge?: number;
  prompt?: string;
}): string {
  const u = new URL(p.publicAuthorizationEndpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', p.clientId);
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('scope', 'openid profile email');
  u.searchParams.set('state', p.state);
  u.searchParams.set('nonce', p.nonce);
  u.searchParams.set('code_challenge', p.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (p.maxAge !== undefined) u.searchParams.set('max_age', String(p.maxAge));
  if (p.prompt !== undefined) u.searchParams.set('prompt', p.prompt);
  return u.toString();
}

function decodeJson(part: string, what: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch {
    throw new Error(`malformed token: ${what}`);
  }
}

/** Validates signature (RS256 only), iss, aud/azp, exp, nonce and auth_time freshness. Throws on any failure. */
export function validateIdToken(i: ValidationInput): IdTokenClaims {
  const skew = i.skew ?? 5;
  const parts = i.token.split('.');
  if (parts.length !== 3 || parts.some((p, idx) => idx < 2 && p === ''))
    throw new Error('malformed token');
  const [h, p, s] = parts as [string, string, string];
  const header = decodeJson(h, 'header');
  if (header.alg !== 'RS256') throw new Error(`unsupported alg: ${String(header.alg)}`);
  const key = i.jwks.keys.find(
    (k) => k.kid === header.kid && k.kty === 'RSA' && (k.use ?? 'sig') === 'sig',
  );
  if (!key) throw new Error(`unknown kid: ${String(header.kid)}`);
  const ok = verify(
    'RSA-SHA256',
    Buffer.from(`${h}.${p}`),
    createPublicKey({ key, format: 'jwk' }),
    Buffer.from(s, 'base64url'),
  );
  if (!ok) throw new Error('bad signature');

  const c = decodeJson(p, 'payload') as IdTokenClaims;
  if (c.iss !== i.expectedIssuer) throw new Error(`iss mismatch: ${String(c.iss)}`);
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(i.clientId)) throw new Error('aud mismatch');
  if (aud.length > 1 && c.azp !== i.clientId)
    throw new Error('azp must equal client when multiple aud');
  if (typeof c.exp !== 'number' || c.exp + skew < i.now) throw new Error('token expired (exp)');
  if (typeof c.sub !== 'string' || c.sub === '') throw new Error('missing sub');
  if (c.nonce !== i.nonce) throw new Error('nonce mismatch');
  if (typeof c.auth_time !== 'number') throw new Error('missing or invalid auth_time');
  if (c.auth_time + skew < i.authRequestStartedAt) {
    throw new Error('stale auth_time: authentication predates the authorization request');
  }
  if (c.auth_time - skew > i.now) throw new Error('auth_time in the future');
  return c;
}
