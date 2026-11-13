import { readFileSync } from 'node:fs';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Exact browser origin of the UI, e.g. https://mise.example.com (no path, no trailing slash). */
  PUBLIC_ORIGIN: z
    .url()
    .refine((v) => new URL(v).origin === v, 'must be an origin without path or trailing slash'),
  /**
   * Fastify `trustProxy`: off by default. Behind the reverse proxy set `true` (single trusted hop)
   * or a hop count. Never `true` without a proxy: X-Forwarded-For becomes spoofable.
   */
  TRUST_PROXY: z
    .string()
    .regex(/^(true|false|[1-9]\d?)$/, 'must be true, false or a hop count')
    .default('false'),
  /** HMAC key for CSRF tokens. */
  CSRF_SECRET: z.string().min(32, 'must be at least 32 characters'),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: (typeof LOG_LEVELS)[number];
  databaseUrl: string;
  databasePoolMax: number;
  publicOrigin: string;
  trustProxy: boolean | number;
  csrfSecret: string;
}

/** Names that may be supplied as `<NAME>_FILE` (path to a file holding the value). */
const SECRET_NAMES = ['DATABASE_URL', 'CSRF_SECRET'] as const;

export class ConfigError extends Error {}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Loads and validates configuration. Secrets may come from `NAME` or `NAME_FILE` (not both).
 * Error messages name the variables only, never their values.
 */
export function loadConfig(
  env: Env,
  readFile: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): AppConfig {
  const merged: Record<string, string | undefined> = { ...env };
  for (const name of SECRET_NAMES) {
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
  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`invalid configuration: ${problems.join('; ')}`);
  }
  const c = parsed.data;
  return {
    nodeEnv: c.NODE_ENV,
    host: c.HOST,
    port: c.PORT,
    logLevel: c.LOG_LEVEL,
    databaseUrl: c.DATABASE_URL,
    databasePoolMax: c.DATABASE_POOL_MAX,
    publicOrigin: c.PUBLIC_ORIGIN,
    trustProxy:
      c.TRUST_PROXY === 'true' ? true : c.TRUST_PROXY === 'false' ? false : Number(c.TRUST_PROXY),
    csrfSecret: c.CSRF_SECRET,
  };
}
