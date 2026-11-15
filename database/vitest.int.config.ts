import { defineConfig } from 'vitest/config';

// Integration tests for the database package: schema, constraints, triggers, search spike.
// The global setup (re)creates the migrated test database; see tests/support/test-database-config.ts.
export default defineConfig({
  test: { globalSetup: ['./test/global-setup.ts'], fileParallelism: false },
});
