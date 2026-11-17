// Runs once per `pnpm e2e`, after the web servers are up: resets and migrates the shared test database,
// provisions the household with its two members (the operator CLI's own code path), then signs both in
// through the real sign-in flow and stores each device session as Playwright storage state.
// Sign-in is done once per member because the login endpoints are rate limited.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { ensureTestDatabase, resetTestDatabase } from '../../database/test/reset';
import { runProvisionHousehold } from '../../apps/server/src/cli/provision-household-run.js';
import { TEST_ISSUER } from '../../apps/server/src/auth/test-idp.js';
import { E2E_ORIGIN } from './e2e-ports.js';
import { authStatePath, HOUSEHOLD_NAME, MEMBERS, signIn } from './auth.js';
import { assertSafeTestDatabase, loadE2eDatabaseConfig } from './test-database-config.js';

export default async function globalSetup(): Promise<void> {
  const db = loadE2eDatabaseConfig();
  assertSafeTestDatabase(db);
  await ensureTestDatabase(db);
  await resetTestDatabase(db);

  const errors: string[] = [];
  const code = await runProvisionHousehold(
    [
      '--name',
      HOUSEHOLD_NAME,
      '--issuer',
      TEST_ISSUER,
      '--owner-subject',
      MEMBERS.anna.subject,
      '--owner-name',
      MEMBERS.anna.displayName,
      '--member-subject',
      MEMBERS.ankka.subject,
      '--member-name',
      MEMBERS.ankka.displayName,
    ],
    { DATABASE_URL: db.appUrl },
    { log: () => undefined, error: (l) => errors.push(l) },
  );
  if (code !== 0) throw new Error(`provisioning the E2E household failed: ${errors.join('; ')}`);

  mkdirSync(new URL('../.auth', import.meta.url).pathname, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const key of ['anna', 'ankka'] as const) {
      const context = await browser.newContext({ baseURL: E2E_ORIGIN });
      const page = await context.newPage();
      await signIn(page, MEMBERS[key].subject);
      await context.storageState({ path: authStatePath(key) });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
