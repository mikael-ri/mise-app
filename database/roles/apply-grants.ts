// Applies the app role's privileges to the database in MIGRATION_DATABASE_URL (run after `db:migrate`).
// Usage: APP_DB_ROLE=mise_app MIGRATION_DATABASE_URL=... pnpm --filter @mise/database db:grants
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { applyAppGrants } from './grants.ts';

// Run only when executed directly (not when imported by the test setup).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env['MIGRATION_DATABASE_URL'];
  const appRole = process.env['APP_DB_ROLE'];
  if (!url || !appRole) {
    console.error('MIGRATION_DATABASE_URL and APP_DB_ROLE are required');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await applyAppGrants(client, appRole);
    console.log(`granted app privileges to ${appRole}`);
  } finally {
    await client.end();
  }
}
