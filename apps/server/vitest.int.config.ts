import { defineConfig } from 'vitest/config';

// Integration tests need a real PostgreSQL with migrations applied (DATABASE_URL).
export default defineConfig({
  test: { include: ['src/**/*.int.test.ts'], fileParallelism: false },
});
