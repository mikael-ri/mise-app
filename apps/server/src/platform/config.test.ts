import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, loadDatabaseConfig, trustProxyWarning } from './config.js';

const base = {
  DATABASE_URL: 'postgres://u:topsecret@localhost:5432/mise',
  PUBLIC_ORIGIN: 'https://mise.test',
  CSRF_SECRET: 'x'.repeat(32),
  SESSION_SECRET: 's'.repeat(32),
  OIDC_ISSUER: 'https://auth.mise.test',
  OIDC_CLIENT_ID: 'mise',
  OIDC_CLIENT_SECRET: 'client-secret-value',
  OIDC_POST_LOGIN_LOGOUT_URL: 'https://auth.mise.test/logout',
};

describe('loadConfig (NFR-01)', () => {
  it('applies defaults and maps names', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
      databasePoolMax: 10,
    });
    expect(c.publicOrigin).toBe('https://mise.test');
  });

  it('parses TRUST_PROXY: off by default, true or a hop count, else rejected', () => {
    expect(loadConfig(base).trustProxy).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'yes' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, TRUST_PROXY: '0' })).toThrow(ConfigError);
  });

  it('accepts the proxy address list for TRUST_PROXY (A19: the Pi address, not true)', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '192.168.1.10' }).trustProxy).toEqual([
      '192.168.1.10',
    ]);
    expect(loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8, ::1' }).trustProxy).toEqual([
      '10.0.0.0/8',
      '::1',
    ]);
    for (const bad of ['192.168.1.300', '10.0.0.0/33', 'proxy.local', '1.2.3.4/8/1', '1.2.3.4,']) {
      expect(() => loadConfig({ ...base, TRUST_PROXY: bad }), bad).toThrow(ConfigError);
    }
  });

  it('warns at startup in production when TRUST_PROXY is false or true (NFR-01)', () => {
    const prod = { ...base, NODE_ENV: 'production' };
    expect(trustProxyWarning(loadConfig(prod))).toMatch(/TRUST_PROXY is false/);
    expect(trustProxyWarning(loadConfig({ ...prod, TRUST_PROXY: 'true' }))).toMatch(
      /TRUST_PROXY is true/,
    );
    expect(trustProxyWarning(loadConfig({ ...prod, TRUST_PROXY: '192.168.1.10' }))).toBeNull();
    expect(trustProxyWarning(loadConfig({ ...prod, TRUST_PROXY: '1' }))).toBeNull();
    expect(trustProxyWarning(loadConfig(base))).toBeNull();
  });

  it('reads secrets from *_FILE and trims one trailing newline', () => {
    const rest = { ...base, CSRF_SECRET: undefined };
    const c = loadConfig({ ...rest, CSRF_SECRET_FILE: '/run/secrets/csrf' }, (p) => {
      expect(p).toBe('/run/secrets/csrf');
      return `${'y'.repeat(40)}\n`;
    });
    expect(c.csrfSecret).toBe('y'.repeat(40));
  });

  it('rejects NAME together with NAME_FILE', () => {
    expect(() => loadConfig({ ...base, CSRF_SECRET_FILE: '/x' }, () => 'z'.repeat(40))).toThrow(
      ConfigError,
    );
  });

  it('reports an unreadable secret file without leaking the path contents', () => {
    const rest = { ...base, CSRF_SECRET: undefined };
    expect(() =>
      loadConfig({ ...rest, CSRF_SECRET_FILE: '/nope' }, () => {
        throw new Error('ENOENT /nope');
      }),
    ).toThrow('CSRF_SECRET_FILE could not be read');
  });

  it.each([
    ['missing DATABASE_URL', { DATABASE_URL: undefined }],
    ['short CSRF secret', { CSRF_SECRET: 'short' }],
    ['origin with path', { PUBLIC_ORIGIN: 'https://mise.test/app' }],
    ['origin with trailing slash', { PUBLIC_ORIGIN: 'https://mise.test/' }],
    ['bad port', { PORT: '70000' }],
    ['bad log level', { LOG_LEVEL: 'loud' }],
    ['short session secret', { SESSION_SECRET: 'short' }],
    ['missing OIDC client secret', { OIDC_CLIENT_SECRET: undefined }],
    ['http OIDC issuer', { OIDC_ISSUER: 'http://auth.mise.test' }],
    ['OIDC issuer with path', { OIDC_ISSUER: 'https://auth.mise.test/x' }],
    ['missing post-login logout URL', { OIDC_POST_LOGIN_LOGOUT_URL: undefined }],
    [
      'logout URL off the issuer origin',
      { OIDC_POST_LOGIN_LOGOUT_URL: 'https://evil.test/logout' },
    ],
  ])('fails fast on %s', (_name, override) => {
    expect(() => loadConfig({ ...base, ...override })).toThrow(ConfigError);
  });

  it('maps OIDC settings; the internal URL defaults to the public issuer (ADR-012 addendum)', () => {
    expect(loadConfig(base).oidc).toEqual({
      issuer: 'https://auth.mise.test',
      internalUrl: 'https://auth.mise.test',
      clientId: 'mise',
      clientSecret: 'client-secret-value',
      postLoginLogoutUrl: 'https://auth.mise.test/logout',
    });
    const c = loadConfig({ ...base, OIDC_INTERNAL_URL: 'http://authelia:9091' });
    expect(c.oidc.internalUrl).toBe('http://authelia:9091');
  });

  it('reads the OIDC client secret and session secret from *_FILE', () => {
    const files: Record<string, string> = { '/c': 'from-file\n', '/s': 'f'.repeat(40) };
    const c = loadConfig(
      {
        ...base,
        OIDC_CLIENT_SECRET: undefined,
        SESSION_SECRET: undefined,
        OIDC_CLIENT_SECRET_FILE: '/c',
        SESSION_SECRET_FILE: '/s',
      },
      (p) => files[p]!,
    );
    expect(c.oidc.clientSecret).toBe('from-file');
    expect(c.sessionSecret).toBe('f'.repeat(40));
  });

  it('never puts secret values in the error message', () => {
    try {
      loadConfig({
        ...base,
        CSRF_SECRET: 'short-secret-value',
        SESSION_SECRET: 'short-session',
        PORT: 'abc',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain('short-secret-value');
      expect((e as Error).message).not.toContain('topsecret');
      expect((e as Error).message).not.toContain('short-session');
      expect((e as Error).message).not.toContain('client-secret-value');
    }
  });
});

describe('loadDatabaseConfig', () => {
  it('needs only the database settings and applies the pool default', () => {
    expect(loadDatabaseConfig({ DATABASE_URL: 'postgres://x/y' })).toEqual({
      databaseUrl: 'postgres://x/y',
      databasePoolMax: 10,
    });
  });

  it('validates like loadConfig: missing URL, bad pool size, NAME with NAME_FILE', () => {
    expect(() => loadDatabaseConfig({})).toThrow(ConfigError);
    expect(() => loadDatabaseConfig({ DATABASE_URL: 'x', DATABASE_POOL_MAX: '0' })).toThrow(
      ConfigError,
    );
    expect(() => loadDatabaseConfig({ DATABASE_URL: 'x', DATABASE_URL_FILE: '/f' })).toThrow(
      /both set/,
    );
  });

  it('reads DATABASE_URL_FILE and trims one trailing newline', () => {
    const cfg = loadDatabaseConfig({ DATABASE_URL_FILE: '/f' }, () => 'postgres://x/y\n');
    expect(cfg.databaseUrl).toBe('postgres://x/y');
  });
});
