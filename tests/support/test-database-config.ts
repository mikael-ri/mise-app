// The one place that decides which database tests may touch (ADR-018). Pure: no I/O, no `pg` import.
//
// - TEST_DATABASE_URL            connects as the APP role (least privilege). Services and API tests use it,
//                                so a missing grant shows up as a failing test.
// - TEST_MIGRATION_DATABASE_URL  connects as the OWNER role. Used only to create/reset/migrate the test
//                                database and by the database package's schema tests.
// - MISE_TEST_DB_SUFFIX          appends `_<suffix>` to the database name (mise_test_a, mise_test_b), so
//                                parallel lanes or worktrees each get their own database.
// Tests never read DATABASE_URL; the real application database is unreachable from here by design.
// The defaults point at the dev Compose PostgreSQL (infra/compose.dev.yaml) with throwaway credentials.

export const DEFAULT_TEST_DATABASE_URL =
  'postgres://mise_test_app:mise_test@localhost:5433/mise_test';
export const DEFAULT_TEST_MIGRATION_DATABASE_URL =
  'postgres://mise_test_owner:mise_test@localhost:5433/mise_test';

export interface TestDatabaseConfig {
  /** App role connection string (suffix applied). */
  readonly appUrl: string;
  /** Owner role connection string (suffix applied). */
  readonly ownerUrl: string;
  readonly databaseName: string;
  readonly appRole: string;
  readonly ownerRole: string;
}

const SUFFIX = /^[a-z0-9]{1,16}$/;
/** `mise_test` or `mise_test_<suffix>`: ends in `_test` or `_test_<suffix>`. */
const SAFE_DATABASE_NAME = /^[a-z][a-z0-9_]*_test(_[a-z0-9]+)?$/;
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

type Env = Readonly<Record<string, string | undefined>>;

function databaseOf(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\//, ''));
}

function withSuffix(raw: string, suffix: string | undefined): string {
  const url = new URL(raw);
  if (suffix !== undefined) url.pathname = `/${databaseOf(url)}_${suffix}`;
  return url.toString();
}

/**
 * The browser E2E suite's own lane: `mise_test_e2e` (or `mise_test_<suffix>e2e` when MISE_TEST_DB_SUFFIX is
 * set), so `pnpm e2e` and the integration tests never reset each other's database.
 */
export function loadE2eDatabaseConfig(env: Env = process.env): TestDatabaseConfig {
  const lane = env['MISE_TEST_DB_SUFFIX'] || '';
  return loadTestDatabaseConfig({ ...env, MISE_TEST_DB_SUFFIX: `${lane}e2e` });
}

export function loadTestDatabaseConfig(env: Env = process.env): TestDatabaseConfig {
  const suffix = env['MISE_TEST_DB_SUFFIX'] || undefined;
  if (suffix !== undefined && !SUFFIX.test(suffix)) {
    throw new Error('MISE_TEST_DB_SUFFIX must be 1-16 characters of [a-z0-9]');
  }
  const appUrl = withSuffix(env['TEST_DATABASE_URL'] || DEFAULT_TEST_DATABASE_URL, suffix);
  const ownerUrl = withSuffix(
    env['TEST_MIGRATION_DATABASE_URL'] || DEFAULT_TEST_MIGRATION_DATABASE_URL,
    suffix,
  );
  const app = new URL(appUrl);
  const owner = new URL(ownerUrl);
  return {
    appUrl,
    ownerUrl,
    databaseName: databaseOf(app),
    appRole: decodeURIComponent(app.username),
    ownerRole: decodeURIComponent(owner.username),
  };
}

/**
 * The safety guard, implemented once and called from the Vitest global setup (and from the reset
 * function that drops schemas). Refuses unless, for BOTH URLs: the database name ends in `_test` or
 * `_test_<suffix>`, both URLs name the same database, the host is loopback, the URL carries no query
 * parameters (they can override host, port and user in `pg`), and the two roles differ.
 * Messages never contain the URLs (they carry passwords).
 */
export function assertSafeTestDatabase(config: TestDatabaseConfig): void {
  const problems: string[] = [];
  for (const [label, raw] of [
    ['TEST_DATABASE_URL', config.appUrl],
    ['TEST_MIGRATION_DATABASE_URL', config.ownerUrl],
  ] as const) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      problems.push(`${label} is not a valid URL`);
      continue;
    }
    // `pg` lets query parameters (?host=, ?port=, ?user=, ?dbname=) override the URL's own parts, which would
    // defeat every check below. Test URLs never need any.
    if (url.search !== '') {
      problems.push(`${label}: query parameters are not allowed`);
    }
    const name = databaseOf(url);
    if (!SAFE_DATABASE_NAME.test(name)) {
      problems.push(`${label}: database name "${name}" must end in _test or _test_<suffix>`);
    }
    if (name !== config.databaseName) {
      problems.push(`${label}: database "${name}" differs from the other URL`);
    }
    if (!LOCAL_HOSTS.has(url.hostname)) {
      problems.push(`${label}: host "${url.hostname}" must be localhost, 127.0.0.1 or ::1`);
    }
  }
  if (config.appRole === config.ownerRole) {
    problems.push('the app role and the owner role must be different roles');
  }
  if (problems.length > 0) {
    throw new Error(`refusing to run tests against this database:\n  - ${problems.join('\n  - ')}`);
  }
}
