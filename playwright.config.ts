import { randomBytes } from 'node:crypto';
import { defineConfig } from '@playwright/test';
import {
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  TEST_ISSUER,
} from './apps/server/src/auth/test-idp.js';
import {
  E2E_API_PORT,
  E2E_OIDC_PORT,
  E2E_ORIGIN,
  E2E_PROXY_CONTROL_PORT,
  E2E_PROXY_PORT,
  E2E_VITE_PORT,
} from './tests/support/e2e-ports.js';
import { loadE2eDatabaseConfig } from './tests/support/test-database-config.js';

// `pnpm e2e` starts the whole stack itself: fake OIDC provider, API and Vite. The database and its roles
// are the shared test config's (same as unit and integration tests); see tests/support/global-setup.ts.
// No secret value is committed: the session and CSRF secrets live only for this run. AI is not configured
// at all (no provider key), which is the "AI disabled" run AC-10 needs.
const ORIGIN = E2E_ORIGIN;
const OIDC_PORT = E2E_OIDC_PORT;
const API_PORT = E2E_API_PORT;
const VITE_PORT = E2E_VITE_PORT;
const db = loadE2eDatabaseConfig();

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/support/global-setup.ts',
  // One household and one database are shared by every spec; specs create their own data and run serially.
  workers: 1,
  fullyParallel: false,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: ORIGIN },
  webServer: [
    {
      name: 'fake-oidc',
      command: 'pnpm --filter @mise/server exec tsx ../../tests/support/fake-oidc-server.ts',
      url: `http://127.0.0.1:${OIDC_PORT}/jwks.json`,
      reuseExistingServer: false,
      env: { FAKE_OIDC_PORT: String(OIDC_PORT) },
    },
    {
      name: 'api',
      command: 'pnpm --filter @mise/server exec tsx src/main.ts',
      url: `http://127.0.0.1:${API_PORT}/api/v1/health/live`,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: String(API_PORT),
        LOG_LEVEL: 'silent',
        DATABASE_URL: db.appUrl,
        MIGRATION_DATABASE_URL: db.ownerUrl,
        PUBLIC_ORIGIN: ORIGIN,
        CSRF_SECRET: randomBytes(32).toString('hex'),
        SESSION_SECRET: randomBytes(32).toString('hex'),
        OIDC_ISSUER: TEST_ISSUER,
        OIDC_INTERNAL_URL: `http://127.0.0.1:${OIDC_PORT}`,
        OIDC_CLIENT_ID: TEST_CLIENT_ID,
        OIDC_CLIENT_SECRET: TEST_CLIENT_SECRET,
        OIDC_POST_LOGIN_LOGOUT_URL: `${TEST_ISSUER}/logout`,
      },
    },
    {
      name: 'web',
      command: `pnpm --filter @mise/web exec vite --host 127.0.0.1 --port ${VITE_PORT} --strictPort`,
      url: `http://127.0.0.1:${VITE_PORT}`,
      reuseExistingServer: false,
      env: { MISE_API_ORIGIN: `http://127.0.0.1:${API_PORT}` },
    },
    {
      name: 'connection-proxy',
      command: 'pnpm --filter @mise/server exec tsx ../../tests/support/connection-proxy.ts',
      url: ORIGIN,
      reuseExistingServer: false,
      env: {
        PROXY_LISTEN_PORT: String(E2E_PROXY_PORT),
        PROXY_TARGET_PORT: String(VITE_PORT),
        PROXY_CONTROL_PORT: String(E2E_PROXY_CONTROL_PORT),
      },
    },
  ],
});
