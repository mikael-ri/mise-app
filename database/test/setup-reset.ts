// Vitest setup file for the server's integration tests: every test file starts from a freshly migrated,
// empty database, so files cannot see each other's rows and nothing has to be deleted afterwards
// (deleting from protected tables is exactly what the app role is not allowed to do).
import { beforeAll } from 'vitest';
import { loadTestDatabaseConfig } from '../../tests/support/test-database-config';
import { resetTestDatabase } from './reset';

beforeAll(async () => {
  await resetTestDatabase(loadTestDatabaseConfig());
});
