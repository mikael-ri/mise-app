// Pure OIDC relying-party logic (ADR-003 and its A03 addendum): PKCE, the authorization URL and
// ID-token validation. No I/O; network calls live in idp.ts.
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import type { JsonWebKeyInput } from 'node:crypto';
import { z } from 'zod';

/** Tolerated clock skew and the freshness window around the login start (ADR-003 addendum D3). */
export const SKEW_SECONDS = 5;

export class OidcError extends Error {
  constructor(readonly reason: OidcFailure) {
    super(reason);
    this.name = 'OidcError';
  }
}

/** Fixed reason codes; safe to log (never token contents, subjects or secrets). */
export type OidcFailure =
  | 'idp_error'
  | 'login_state_invalid'
  | 'state_mismatch'
  | 'issuer_param_mismatch'
  | 'token_exchange_failed'
  | 'discovery_failed'
  | 'jwks_failed'
  | 'token_malformed'
  | 'alg_unsupported'
  | 'kid_unknown'
  | 'signature_invalid'
  | 'iss_mismatch'
  | 'aud_mismatch'
  | 'azp_mismatch'
  | 'expired'
  | 'not_yet_valid'
  | 'iat_invalid'
  | 'sub_missing'
  | 'nonce_mismatch'
  | 'auth_time_missing'
  | 'auth_time_stale'
  | 'auth_time_future'
  | 'subject_not_provisioned';

export const Jwk = z.looseObject({
  kty: z.string(),
  kid: z.string().optional(),
  use: z.string().optional(),
  alg: z.string().optional(),
  n: z.string().optional(),
  e: z.string().optional(),
});
export const Jwks = z.object({ keys: z.array(Jwk) });
export type Jwks = z.infer<typeof Jwks>;

export function randomUrlToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export interface AuthorizationRequest {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/**
 * Code flow + PKCE S256. Freshness: `prompt=login` (ADR-003 addendum D3: `max_age=0` loops on
 * Authelia 4.39.28); the callback then requires a fresh `auth_time`. Scope `openid` only: Mise
 * takes nothing from the profile (privacy, tech §12).
 */
export function buildAuthorizationUrl(r: AuthorizationRequest): string {
  const u = new URL(r.authorizationEndpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', r.clientId);
  u.searchParams.set('redirect_uri', r.redirectUri);
  u.searchParams.set('scope', 'openid');
  u.searchParams.set('state', r.state);
  u.searchParams.set('nonce', r.nonce);
  u.searchParams.set('code_challenge', pkceChallenge(r.codeVerifier));
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('prompt', 'login');
  return u.toString();
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface IdTokenCheck {
  token: string;
  jwks: Jwks;
  /** The public issuer, exactly as configured (never the internal URL). */
  issuer: string;
  clientId: string;
  nonce: string;
  /** Epoch seconds. */
  now: number;
  /** Epoch seconds when this login started; `auth_time` must not predate it (minus skew). */
  loginStartedAt: number;
}

export interface VerifiedIdentity {
  subject: string;
  /** Verified fresh authentication time (epoch seconds), stored as `authenticated_at`. */
  authTime: number;
}

const Header = z.object({ alg: z.string(), kid: z.string().optional() });
// Every claim is checked explicitly below, so a missing one gets its own reason code.
const Claims = z.looseObject({
  iss: z.unknown().optional(),
  sub: z.unknown().optional(),
  aud: z.unknown().optional(),
  azp: z.unknown().optional(),
  exp: z.unknown().optional(),
  iat: z.unknown().optional(),
  nbf: z.unknown().optional(),
  nonce: z.unknown().optional(),
  auth_time: z.unknown().optional(),
});

function decodePart<T>(part: string, schema: z.ZodType<T>): T {
  try {
    const parsed = schema.safeParse(JSON.parse(Buffer.from(part, 'base64url').toString('utf8')));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through
  }
  throw new OidcError('token_malformed');
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Validates the ID token from the token endpoint: RS256 signature against the issuer's JWKS, then
 * iss, aud/azp, exp, nbf, iat, sub, nonce and `auth_time` freshness. `amr` is deliberately ignored
 * (ADR-003 addendum D3: it does not show freshness). Throws `OidcError` on any failure.
 */
export function validateIdToken(c: IdTokenCheck): VerifiedIdentity {
  const parts = c.token.split('.');
  if (parts.length !== 3 || parts.some((p) => p === '' || !/^[A-Za-z0-9_-]+$/.test(p))) {
    throw new OidcError('token_malformed');
  }
  const [h, p, s] = parts as [string, string, string];
  const header = decodePart(h, Header);
  // Authelia signs ID tokens with RS256 (A03). Pinning the algorithm rules out `none`/HS256 confusion.
  if (header.alg !== 'RS256') throw new OidcError('alg_unsupported');
  const candidates = c.jwks.keys.filter(
    (k) =>
      k.kty === 'RSA' &&
      (k.use === undefined || k.use === 'sig') &&
      (k.alg === undefined || k.alg === 'RS256') &&
      (header.kid === undefined ? true : k.kid === header.kid),
  );
  // Without a kid the key must be unambiguous.
  if (candidates.length !== 1) throw new OidcError('kid_unknown');
  let ok: boolean;
  try {
    const key = createPublicKey({ key: candidates[0] as JsonWebKeyInput['key'], format: 'jwk' });
    ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
  } catch {
    ok = false;
  }
  if (!ok) throw new OidcError('signature_invalid');

  const claims = decodePart(p, Claims);
  if (claims.iss !== c.issuer) throw new OidcError('iss_mismatch');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(c.clientId)) throw new OidcError('aud_mismatch');
  if ((aud.length > 1 || claims.azp !== undefined) && claims.azp !== c.clientId) {
    throw new OidcError('azp_mismatch');
  }
  if (!isNumber(claims.exp) || claims.exp + SKEW_SECONDS <= c.now) throw new OidcError('expired');
  if (claims.nbf !== undefined && (!isNumber(claims.nbf) || claims.nbf - SKEW_SECONDS > c.now)) {
    throw new OidcError('not_yet_valid');
  }
  if (!isNumber(claims.iat) || claims.iat - SKEW_SECONDS > c.now) {
    throw new OidcError('iat_invalid');
  }
  if (typeof claims.sub !== 'string' || claims.sub === '' || claims.sub.length > 255) {
    throw new OidcError('sub_missing');
  }
  if (typeof claims.nonce !== 'string' || !safeEqual(claims.nonce, c.nonce)) {
    throw new OidcError('nonce_mismatch');
  }
  if (!isNumber(claims.auth_time)) throw new OidcError('auth_time_missing');
  if (claims.auth_time < c.loginStartedAt - SKEW_SECONDS) throw new OidcError('auth_time_stale');
  if (claims.auth_time - SKEW_SECONDS > c.now) throw new OidcError('auth_time_future');
  return { subject: claims.sub, authTime: Math.floor(claims.auth_time) };
}
