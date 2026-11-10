// Spike A03: separate Playwright config so the evidence suite never runs as part of `pnpm e2e`.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spike.ts',
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { ignoreHTTPSErrors: true },
});
