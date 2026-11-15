import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEST_DATABASE_URL,
  DEFAULT_TEST_MIGRATION_DATABASE_URL,
  assertSafeTestDatabase,
  loadTestDatabaseConfig,
} from '../../../../tests/support/test-database-config.js';

const guard = (env: Record<string, string | undefined>) =>
  assertSafeTestDatabase(loadTestDatabaseConfig(env));

describe('shared test database config (ADR-018)', () => {
  it('defaults: app and owner roles, same local mise_test database, DATABASE_URL ignored', () => {
    const c = loadTestDatabaseConfig({
      DATABASE_URL: 'postgres://prod:secret@db.example.com/mise',
    });
    expect(c.appUrl).toBe(DEFAULT_TEST_DATABASE_URL);
    expect(c.ownerUrl).toBe(DEFAULT_TEST_MIGRATION_DATABASE_URL);
    expect([c.databaseName, c.appRole, c.ownerRole]).toEqual([
      'mise_test',
      'mise_test_app',
      'mise_test_owner',
    ]);
    expect(() => assertSafeTestDatabase(c)).not.toThrow();
  });

  it('MISE_TEST_DB_SUFFIX appends to the database name of both URLs', () => {
    const c = loadTestDatabaseConfig({ MISE_TEST_DB_SUFFIX: 'a' });
    expect(c.databaseName).toBe('mise_test_a');
    expect(new URL(c.ownerUrl).pathname).toBe('/mise_test_a');
    expect(() => assertSafeTestDatabase(c)).not.toThrow();
  });

  it.each(['A', 'a-b', 'a b', '', 'x'.repeat(17)].filter((s) => s !== ''))(
    'rejects the suffix %j',
    (suffix) => {
      expect(() => loadTestDatabaseConfig({ MISE_TEST_DB_SUFFIX: suffix })).toThrow(/SUFFIX/);
    },
  );

  const owner = 'postgres://mise_test_owner:x@localhost:5433';
  const app = 'postgres://mise_test_app:x@localhost:5433';
  it.each([
    [
      'database name does not end in _test',
      { TEST_DATABASE_URL: `${app}/mise`, TEST_MIGRATION_DATABASE_URL: `${owner}/mise` },
      /must end in _test/,
    ],
    [
      'name merely contains test',
      { TEST_DATABASE_URL: `${app}/test_mise`, TEST_MIGRATION_DATABASE_URL: `${owner}/test_mise` },
      /must end in _test/,
    ],
    [
      'remote app host',
      { TEST_DATABASE_URL: 'postgres://mise_test_app:x@db.example.com/mise_test' },
      /TEST_DATABASE_URL: host/,
    ],
    [
      'remote owner host',
      { TEST_MIGRATION_DATABASE_URL: 'postgres://mise_test_owner:x@10.0.0.5/mise_test' },
      /TEST_MIGRATION_DATABASE_URL: host/,
    ],
    [
      'lookalike host',
      { TEST_DATABASE_URL: 'postgres://mise_test_app:x@localhost.evil.test/mise_test' },
      /host/,
    ],
    [
      'URLs name different databases',
      { TEST_MIGRATION_DATABASE_URL: `${owner}/other_test` },
      /differs/,
    ],
    ['same role for app and owner', { TEST_DATABASE_URL: `${owner}/mise_test` }, /different roles/],
  ])('refuses: %s', (_name, env, message) => {
    expect(() => guard(env)).toThrow(message);
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])('accepts the loopback host %s', (host) => {
    expect(() =>
      guard({
        TEST_DATABASE_URL: `postgres://mise_test_app:x@${host}:5433/mise_test`,
        TEST_MIGRATION_DATABASE_URL: `postgres://mise_test_owner:x@${host}:5433/mise_test`,
      }),
    ).not.toThrow();
  });

  it('never puts a password in the refusal message', () => {
    try {
      guard({ TEST_DATABASE_URL: 'postgres://mise_test_app:hunter2@db.example.com/mise_test' });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain('hunter2');
    }
  });
});
