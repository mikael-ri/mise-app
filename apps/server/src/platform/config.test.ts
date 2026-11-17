import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  KNOWN_TEST_SECRET_VALUES,
  loadConfig,
  loadDatabaseConfig,
  trustProxyWarning,
} from './config.js';

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
    const prod = {
      ...base,
      NODE_ENV: 'production',
      SESSION_SECRET: 'q7Vf2LmX9pRtZ4cKd8Hs1WbN6yUa3JeG',
      CSRF_SECRET: 'Gx3aUy6NbW1sHd8cKZt4RpX9mL2fV7qJ',
      OIDC_CLIENT_SECRET: 'oidc-Pm4Zr8Tn2Kd7Vb1Xw',
    };
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

describe('production secret rule (A16 startup rule)', () => {
  const prod = { ...base, NODE_ENV: 'production' };
  const random = 'q7Vf2LmX9pRtZ4cKd8Hs1WbN6yUa3JeG';
  const names = ['SESSION_SECRET', 'CSRF_SECRET', 'OIDC_CLIENT_SECRET'] as const;
  // SESSION_SECRET and CSRF_SECRET also have a 32-character minimum everywhere, so only list entries
  // that long can reach the list check for them; every entry is checked for OIDC_CLIENT_SECRET.
  const cases = names.flatMap((name) =>
    KNOWN_TEST_SECRET_VALUES.filter((v) => name === 'OIDC_CLIENT_SECRET' || v.length >= 32).map(
      (value) => ({ name, value }),
    ),
  );

  it.each(cases)('known test value refused in production: $name = $value', ({ name, value }) => {
    expect(() => loadConfig({ ...prod, [name]: value })).toThrow(
      new RegExp(`${name}: is a known test or example value`),
    );
  });

  it.each(cases)(
    'known test value accepted outside production: $name = $value',
    ({ name, value }) => {
      expect(() => loadConfig({ ...base, NODE_ENV: 'test', [name]: value })).not.toThrow();
    },
  );

  it.each([
    ['one repeated character', 'a'.repeat(40)],
    ['a repeating pattern', 'abab'.repeat(10)],
    ['nine different characters', '123456789'.repeat(4)],
  ])('refuses %s for SESSION_SECRET and CSRF_SECRET in production', (_label, value) => {
    expect(() => loadConfig({ ...prod, SESSION_SECRET: value })).toThrow(
      /SESSION_SECRET: must contain at least 10 different characters/,
    );
    expect(() => loadConfig({ ...prod, CSRF_SECRET: value })).toThrow(
      /CSRF_SECRET: must contain at least 10 different characters/,
    );
  });

  it('accepts an openssl-style base64 secret in production', () => {
    const secret = 'kXn3+Qe0/vV8mZpTb2yHc7LwJ9sUa4RdF1gYtNo6iAE=';
    expect(() =>
      loadConfig({
        ...prod,
        SESSION_SECRET: secret,
        CSRF_SECRET: secret + 'x',
        OIDC_CLIENT_SECRET: 'oidc-Pm4Zr8Tn2Kd7Vb1Xw',
      }),
    ).not.toThrow();
  });

  it('accepts the same repeated-character secrets outside production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'test' })).not.toThrow();
  });

  it('accepts normal random secrets in production', () => {
    expect(() =>
      loadConfig({
        ...prod,
        SESSION_SECRET: random,
        CSRF_SECRET: random.split('').reverse().join(''),
        OIDC_CLIENT_SECRET: 'oidc-' + random,
      }),
    ).not.toThrow();
  });

  it('never puts the offending value in the error', () => {
    try {
      loadConfig({
        ...prod,
        SESSION_SECRET: random,
        CSRF_SECRET: random,
        OIDC_CLIENT_SECRET: 'password',
      });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('OIDC_CLIENT_SECRET');
      expect((e as Error).message).not.toContain('password');
    }
  });
});
