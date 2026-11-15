import { defineConfig } from 'vitest/config';

// Integration tests need a real PostgreSQL server (DATABASE_URL, role with CREATEDB). The global setup
// creates a fresh database from the migrations for the run and drops it afterwards.
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    fileParallelism: false,
    globalSetup: ['./test/global-db.ts'],
  },
});
