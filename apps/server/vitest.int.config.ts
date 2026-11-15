import { defineConfig } from 'vitest/config';

// Integration tests run against the shared test database (tests/support/test-database-config.ts):
// the global setup guards, creates and migrates it; the setup file resets it before every test file.
// Tests connect as the least-privilege app role (ADR-018), so a missing grant fails a test.
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    fileParallelism: false,
    globalSetup: ['../../database/test/global-setup.ts'],
    setupFiles: ['../../database/test/setup-reset.ts'],
  },
});
