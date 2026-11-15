// Vitest global setup for every integration run. The ONLY place the safety guard is applied up front:
// it refuses to continue unless both test URLs point at a *_test database on a loopback host.
import {
  assertSafeTestDatabase,
  loadTestDatabaseConfig,
} from '../../tests/support/test-database-config';
import { ensureTestDatabase, resetTestDatabase } from './reset';

export default async function setup(): Promise<void> {
  try {
    const config = loadTestDatabaseConfig();
    assertSafeTestDatabase(config);
    await ensureTestDatabase(config);
    await resetTestDatabase(config);
  } catch (err) {
    // Vitest 5 / Vite 8 crash while printing a stack from a global setup ("code.charCodeAt is not a
    // function") and then report "No test files found", hiding the real reason. Say it plainly, and
    // rethrow without a stack so the message is what the developer sees.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nIntegration test setup failed: ${message}\n`);
    throw Object.assign(new Error(message), { stack: `Error: ${message}` });
  }
}
