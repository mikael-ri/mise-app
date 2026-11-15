// Test-only helpers (outside src/, so never part of a server build). Integration runs get a fresh,
// disposable database created from the migrations, so no test ever needs to delete protected rows
// (recipe_versions is immutable by trigger, and TRUNCATE is blocked by a second trigger).
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

/** Every database this code may create, drop or write test data into must match this. */
const TEST_DATABASE_NAME = /^[a-z][a-z0-9_]*_test$/;

export function assertTestDatabaseName(name: string): void {
  if (!TEST_DATABASE_NAME.test(name)) {
    throw new Error(`refusing to touch database "${name}": its name must end in _test`);
  }
}

/** The same connection settings, pointed at another database. */
export function urlForDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/** Guard for tests that write data: fails unless the connected database is a `_test` database. */
export async function assertConnectedToTestDatabase(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ name: string }>('SELECT current_database() AS name');
  assertTestDatabaseName(rows[0]!.name);
}

async function withAdmin<T>(adminUrl: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Creates `mise_run_<random>_test` and applies every migration to it. Needs CREATEDB. */
export async function createRunDatabase(adminUrl: string): Promise<{ name: string; url: string }> {
  const name = `mise_run_${randomBytes(6).toString('hex')}_test`;
  assertTestDatabaseName(name);
  // `name` is generated above and validated by the pattern, so quoting it is safe.
  await withAdmin(adminUrl, (c) => c.query(`CREATE DATABASE "${name}"`));
  const url = urlForDatabase(adminUrl, name);
  try {
    execFileSync('pnpm', ['--filter', '@mise/database', 'db:migrate'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
  } catch (err) {
    await dropRunDatabase(adminUrl, name);
    throw err;
  }
  return { name, url };
}

/** Refuses unless the name ends in `_test` and is not the database it is connected through. */
export async function dropRunDatabase(adminUrl: string, name: string): Promise<void> {
  assertTestDatabaseName(name);
  if (new URL(adminUrl).pathname === `/${name}`) {
    throw new Error('refusing to drop the database the admin connection uses');
  }
  await withAdmin(adminUrl, (c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
}
