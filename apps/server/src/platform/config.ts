import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

// Shared by the full loader and loadDatabaseConfig so the CLI and the server validate identically.
const DatabaseSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

/** `a.b.c.d, 10.0.0.0/8, ::1` -> list, or null if any entry is not an IP or CIDR. */
function parseProxyAddresses(value: string): string[] | null {
  const items = value.split(',').map((x) => x.trim());
  for (const item of items) {
    const [addr = '', prefix, extra] = item.split('/');
    const family = isIP(addr);
    if (family === 0 || extra !== undefined) return null;
    if (prefix !== undefined) {
      const max = family === 4 ? 32 : 128;
      if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > max) return null;
    }
  }
  return items;
}

/**
 * Startup safeguard: in production the rate limiter keys on `request.ip`, so `false` behind nginx
 * makes every client share one key, and `true` trusts any X-Forwarded-For. Returns a warning or null.
 */
export function trustProxyWarning(c: Pick<AppConfig, 'nodeEnv' | 'trustProxy'>): string | null {
  if (c.nodeEnv !== 'production') return null;
  if (c.trustProxy === false) {
    return 'TRUST_PROXY is false: behind the reverse proxy all clients share one rate-limit key; set it to the proxy address';
  }
  if (c.trustProxy === true) {
    return 'TRUST_PROXY is true: X-Forwarded-For is trusted from any sender; set it to the proxy address';
  }
  return null;
}

const HttpOrigin = z
  .url({ protocol: /^https?$/ })
  .refine((v) => new URL(v).origin === v, 'must be an origin without path or trailing slash');
// Authelia serves OIDC only over HTTPS; the issuer is always the public https origin.
const HttpsOrigin = HttpOrigin.refine((v) => v.startsWith('https://'), 'must use https');

const ConfigSchema = DatabaseSchema.extend({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  /** Exact browser origin of the UI, e.g. https://mise.example.com (no path, no trailing slash). */
  PUBLIC_ORIGIN: z
    .url()
    .refine((v) => new URL(v).origin === v, 'must be an origin without path or trailing slash'),
  /**
   * Fastify `trustProxy`: off by default. Behind the reverse proxy set the proxy's address
   * (comma-separated IPs/CIDRs, e.g. `192.168.1.10`), or a hop count. `true` trusts any sender of
   * X-Forwarded-For and is spoofable unless the app is reachable only through the proxy.
   */
  TRUST_PROXY: z
    .string()
    .refine(
      (v) => /^(true|false|[1-9]\d?)$/.test(v) || parseProxyAddresses(v) !== null,
      'must be true, false, a hop count or comma-separated IPs/CIDRs',
    )
    .default('false'),
  /** HMAC key for CSRF tokens. */
  CSRF_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /** Key material for the encrypted OIDC login-state cookie. Separate from CSRF_SECRET. */
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /** Public OIDC issuer exactly as Authelia reports it; `iss` is validated against it (ADR-012 addendum). */
  OIDC_ISSUER: HttpsOrigin,
  /** Internal Authelia base URL for discovery, token and JWKS calls. Defaults to OIDC_ISSUER. */
  OIDC_INTERNAL_URL: HttpOrigin.optional(),
  OIDC_CLIENT_ID: z.string().min(1).max(255),
  OIDC_CLIENT_SECRET: z.string().min(1),
  /**
   * Authelia portal logout the browser is sent to right after a successful callback, so no SSO
   * session outlives the login (ADR-003 addendum D4). `rd=<app url>` is appended.
   */
  OIDC_POST_LOGIN_LOGOUT_URL: z.url({ protocol: /^https$/ }),
}).refine((c) => new URL(c.OIDC_POST_LOGIN_LOGOUT_URL).origin === c.OIDC_ISSUER, {
  path: ['OIDC_POST_LOGIN_LOGOUT_URL'],
  message: 'must be on the OIDC_ISSUER origin',
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: (typeof LOG_LEVELS)[number];
  databaseUrl: string;
  databasePoolMax: number;
  publicOrigin: string;
  /** Fastify trustProxy: off, all, hop count, or trusted proxy addresses. */
  trustProxy: boolean | number | string[];
  csrfSecret: string;
  sessionSecret: string;
  oidc: OidcConfig;
}

export interface OidcConfig {
  issuer: string;
  internalUrl: string;
  clientId: string;
  clientSecret: string;
  postLoginLogoutUrl: string;
}

/** Names that may be supplied as `<NAME>_FILE` (path to a file holding the value). */
const SECRET_NAMES = [
  'DATABASE_URL',
  'CSRF_SECRET',
  'SESSION_SECRET',
  'OIDC_CLIENT_SECRET',
] as const;

export class ConfigError extends Error {}

/**
 * Secret values that belong to test and example setups (A16). In production the server refuses them,
 * so a test configuration cannot leak into a real deployment. Compared after trim and lower-casing.
 * `test-client-secret` is the fake OIDC provider's client secret (`auth/test-idp.ts`), also used by E2E.
 */
export const KNOWN_TEST_SECRET_VALUES: readonly string[] = [
  'test-client-secret',
  'client-secret-value',
  'int-test-session-secret-0123456789',
  'changeme',
  'change-me',
  'secret',
  'password',
  // Placeholders from .env.example
  'change-me-at-least-32-characters-long',
];

/** Minimum number of different characters in SESSION_SECRET and CSRF_SECRET in production. */
export const MIN_DISTINCT_SECRET_CHARS = 10;

/**
 * Production only. Names variables, never values. This rule catches mistakes, such as leaving a test value
 * or an `.env.example` placeholder in a deployment; it is not a measure of secret strength. E2E generates
 * the session and CSRF secrets randomly per run, which an exact list cannot catch, so those two also need
 * the schema's 32-character minimum and at least MIN_DISTINCT_SECRET_CHARS different characters.
 * (`openssl rand -base64 32` passes easily.)
 */
function assertProductionSecrets(c: {
  CSRF_SECRET: string;
  SESSION_SECRET: string;
  OIDC_CLIENT_SECRET: string;
}): void {
  const problems: string[] = [];
  const known = new Set(KNOWN_TEST_SECRET_VALUES);
  for (const name of ['SESSION_SECRET', 'CSRF_SECRET', 'OIDC_CLIENT_SECRET'] as const) {
    if (known.has(c[name].trim().toLowerCase())) {
      problems.push(`${name}: is a known test or example value`);
    }
  }
  for (const name of ['SESSION_SECRET', 'CSRF_SECRET'] as const) {
    if (new Set(c[name]).size < MIN_DISTINCT_SECRET_CHARS) {
      problems.push(
        `${name}: must contain at least ${MIN_DISTINCT_SECRET_CHARS} different characters`,
      );
    }
  }
  if (problems.length > 0) {
    throw new ConfigError(`invalid production configuration: ${problems.join('; ')}`);
  }
}

type Env = Readonly<Record<string, string | undefined>>;

type ReadFile = (path: string) => string;

/** Applies `NAME_FILE` indirection for the given secret names; errors name variables only. */
function mergeSecretFiles(
  env: Env,
  names: readonly string[],
  readFile: ReadFile,
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...env };
  for (const name of names) {
    const filePath = env[`${name}_FILE`];
    if (filePath === undefined || filePath === '') continue;
    if (env[name] !== undefined && env[name] !== '') {
      throw new ConfigError(`${name} and ${name}_FILE are both set`);
    }
    try {
      merged[name] = readFile(filePath).replace(/\r?\n$/, '');
    } catch {
      throw new ConfigError(`${name}_FILE could not be read`);
    }
  }
  return merged;
}

function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`invalid configuration: ${problems.join('; ')}`);
  }
  return parsed.data;
}

const defaultReadFile: ReadFile = (p) => readFileSync(p, 'utf8');

export interface DatabaseConfig {
  databaseUrl: string;
  databasePoolMax: number;
}

/**
 * Database settings only, for admin CLI commands that must not need the rest of the server
 * environment. Same rules as `loadConfig` (including `DATABASE_URL_FILE`).
 */
export function loadDatabaseConfig(env: Env, readFile: ReadFile = defaultReadFile): DatabaseConfig {
  const c = parseOrThrow(DatabaseSchema, mergeSecretFiles(env, ['DATABASE_URL'], readFile));
  return { databaseUrl: c.DATABASE_URL, databasePoolMax: c.DATABASE_POOL_MAX };
}

/**
 * Loads and validates configuration. Secrets may come from `NAME` or `NAME_FILE` (not both).
 * Error messages name the variables only, never their values.
 */
export function loadConfig(env: Env, readFile: ReadFile = defaultReadFile): AppConfig {
  const c = parseOrThrow(ConfigSchema, mergeSecretFiles(env, SECRET_NAMES, readFile));
  if (c.NODE_ENV === 'production') assertProductionSecrets(c);
  return {
    nodeEnv: c.NODE_ENV,
    host: c.HOST,
    port: c.PORT,
    logLevel: c.LOG_LEVEL,
    databaseUrl: c.DATABASE_URL,
    databasePoolMax: c.DATABASE_POOL_MAX,
    publicOrigin: c.PUBLIC_ORIGIN,
    trustProxy:
      c.TRUST_PROXY === 'true'
        ? true
        : c.TRUST_PROXY === 'false'
          ? false
          : /^\d+$/.test(c.TRUST_PROXY)
            ? Number(c.TRUST_PROXY)
            : parseProxyAddresses(c.TRUST_PROXY)!,
    csrfSecret: c.CSRF_SECRET,
    sessionSecret: c.SESSION_SECRET,
    oidc: {
      issuer: c.OIDC_ISSUER,
      internalUrl: c.OIDC_INTERNAL_URL ?? c.OIDC_ISSUER,
      clientId: c.OIDC_CLIENT_ID,
      clientSecret: c.OIDC_CLIENT_SECRET,
      postLoginLogoutUrl: c.OIDC_POST_LOGIN_LOGOUT_URL,
    },
  };
}
