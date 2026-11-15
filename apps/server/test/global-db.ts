// vitest globalSetup for integration tests: one fresh database per run, dropped afterwards.
// DATABASE_URL names the server (and a role with CREATEDB); tests receive the run database's URL.
import { createRunDatabase, dropRunDatabase } from './test-database.js';

export default async function setup(): Promise<() => Promise<void>> {
  const adminUrl = process.env['DATABASE_URL'];
  if (!adminUrl) throw new Error('DATABASE_URL is required for integration tests');
  const run = await createRunDatabase(adminUrl);
  process.env['DATABASE_URL'] = run.url; // inherited by the test workers started after this
  return async () => {
    await dropRunDatabase(adminUrl, run.name);
  };
}
