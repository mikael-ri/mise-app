// Test database lifecycle through the OWNER connection (ADR-018). Used by the Vitest global setup and,
// for the server's integration tests, before every test file. Never imported by production code.
//
// Why a schema reset and not `TRUNCATE ... CASCADE`: migration 0001 puts a BEFORE TRUNCATE trigger on
// recipe_versions, and a cascade from households/members/recipes fires it (that is the immutability
// guarantee working). Dropping and re-migrating the schema needs no trigger to be disabled.
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import {
  assertSafeTestDatabase,
  type TestDatabaseConfig,
} from '../../tests/support/test-database-config';
import { applyAppGrants, quoteRole } from '../roles/grants';

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
      throw new Error(
        'test database not reachable: start it with `docker compose -f infra/compose.dev.yaml up -d`',
        { cause: err },
      );
    }
    // 28000/28P01: role or password rejected, 3D000: database missing. Typically the roles are not provisioned yet.
    if (code === '28000' || code === '28P01' || code === '3D000') {
      throw new Error(
        'test database rejected the connection: provision the roles with infra/postgres/provision-roles.sql (the `db-provision` service in infra/compose.dev.yaml runs it)',
        { cause: err },
      );
    }
    throw err;
  }
  return client;
}

/** Creates the test database if it is missing and limits CONNECT to the two test roles. */
export async function ensureTestDatabase(config: TestDatabaseConfig): Promise<void> {
  assertSafeTestDatabase(config);
  const maintenance = new URL(config.ownerUrl);
  maintenance.pathname = '/postgres';
  const client = await connect(maintenance.toString());
  try {
    const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      config.databaseName,
    ]);
    // The name passed assertSafeTestDatabase ([a-z0-9_] only), so quoting it is safe.
    if (found.rowCount === 0) await client.query(`CREATE DATABASE "${config.databaseName}"`);
    await client.query(`REVOKE ALL ON DATABASE "${config.databaseName}" FROM PUBLIC`);
    await client.query(
      `GRANT CONNECT ON DATABASE "${config.databaseName}" TO ${quoteRole(config.appRole)}`,
    );
  } finally {
    await client.end();
  }
}

/** Drops everything in the test database, re-applies all migrations, then the app role's grants. */
export async function resetTestDatabase(config: TestDatabaseConfig): Promise<void> {
  assertSafeTestDatabase(config);
  const client = await connect(config.ownerUrl);
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('CREATE SCHEMA public');
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
    await applyAppGrants(client, config.appRole);
  } finally {
    await client.end();
  }
}
