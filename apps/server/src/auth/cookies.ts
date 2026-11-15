// Cookie and token primitives for device sessions (DB §3, tech §12). No Fastify cookie plugin: the
// two cookies Mise uses are parsed and serialised here.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ReturnToPath } from '@mise/contracts';

/** `__Host-`: Secure, Path=/, no Domain, so no sibling subdomain can set or shadow it. */
export const SESSION_COOKIE = '__Host-mise_session';
export const LOGIN_STATE_COOKIE = '__Host-mise_oidc';
/** How long a started login may take before the callback is refused. */
export const LOGIN_STATE_MAX_AGE_SECONDS = 600;

const TOKEN_BYTES = 32; // 256 bits
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A new opaque session token (256 random bits, base64url). Only its digest is ever stored. */
export function newSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** SHA-256 of the token bytes, or null when the value is not a well-formed token. */
export function sessionTokenDigest(token: string): Buffer | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  const raw = Buffer.from(token, 'base64url');
  if (raw.length !== TOKEN_BYTES) return null;
  return createHash('sha256').update(raw).digest();
}

/** First value of `name` in a Cookie header (RFC 6265 §5.4), or undefined. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return undefined;
}

interface CookieOptions {
  maxAgeSeconds: number;
}

/**
 * `SameSite=Lax`: the session cookie must arrive on the top-level navigation back from Authelia;
 * mutations are covered by Origin + CSRF token (A06). `Secure` + `HttpOnly` always.
 */
export function serializeCookie(name: string, value: string, o: CookieOptions): string {
  return `${name}=${value}; Path=/; Max-Age=${o.maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(name: string): string {
  return serializeCookie(name, '', { maxAgeSeconds: 0 });
}

// --- Encrypted login state (state, nonce, PKCE verifier, start time, return path) ---

export const LoginState = z.strictObject({
  state: z.string().min(1).max(128),
  nonce: z.string().min(1).max(128),
  codeVerifier: z.string().min(43).max(128),
  /** Epoch milliseconds when the login started. */
  startedAt: z.int().nonnegative(),
  returnTo: ReturnToPath,
});
export type LoginState = z.infer<typeof LoginState>;

const AAD = Buffer.from(LOGIN_STATE_COOKIE);

/** AES-256-GCM key derived from SESSION_SECRET; the label keeps it apart from any future use. */
export function loginStateKey(sessionSecret: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', sessionSecret, Buffer.alloc(0), 'mise/oidc-login-state/v1', 32),
  );
}

export function sealLoginState(key: Buffer, s: LoginState): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(JSON.stringify(s), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}

/** Decrypts and checks age; null on any tampering, wrong key, malformed or expired value. */
export function openLoginState(
  key: Buffer,
  sealed: string | undefined,
  nowMs: number,
): LoginState | null {
  if (sealed === undefined || sealed.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(sealed)) return null;
  const raw = Buffer.from(sealed, 'base64url');
  if (raw.length < 12 + 16 + 1) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAAD(AAD);
    decipher.setAuthTag(raw.subarray(12, 28));
    const pt = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    const parsed = LoginState.safeParse(JSON.parse(pt.toString('utf8')));
    if (!parsed.success) return null;
    const age = nowMs - parsed.data.startedAt;
    if (age < 0 || age > LOGIN_STATE_MAX_AGE_SECONDS * 1000) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
