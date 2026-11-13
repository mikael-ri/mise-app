import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const base = {
  DATABASE_URL: 'postgres://u:topsecret@localhost:5432/mise',
  PUBLIC_ORIGIN: 'https://mise.test',
  CSRF_SECRET: 'x'.repeat(32),
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
  ])('fails fast on %s', (_name, override) => {
    expect(() => loadConfig({ ...base, ...override })).toThrow(ConfigError);
  });

  it('never puts secret values in the error message', () => {
    try {
      loadConfig({ ...base, CSRF_SECRET: 'short-secret-value', PORT: 'abc' });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain('short-secret-value');
      expect((e as Error).message).not.toContain('topsecret');
    }
  });
});
