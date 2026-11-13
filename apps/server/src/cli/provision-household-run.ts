// Logic of the provisioning CLI, separate from the entry point so it can be tested (no process.exit here).
import { parseArgs } from 'node:util';
import { ZodError } from 'zod';
import { createHouseholdsService } from '../households/index.js';
import type { HouseholdsService } from '../households/index.js';
import { AppError, ConfigError, createPool, loadDatabaseConfig } from '../platform/index.js';
import type { Pool } from '../platform/index.js';

export interface CliIo {
  log: (line: string) => void;
  error: (line: string) => void;
}

export interface CliDeps {
  createPool: (databaseUrl: string, max: number) => Pool;
  createService: (pool: Pool) => HouseholdsService;
}

const defaultDeps: CliDeps = { createPool, createService: createHouseholdsService };

const OPTIONS = {
  name: { type: 'string' },
  issuer: { type: 'string' },
  'owner-subject': { type: 'string' },
  'owner-name': { type: 'string' },
  'member-subject': { type: 'string' },
  'member-name': { type: 'string' },
  timezone: { type: 'string' },
} as const;

/** Returns the process exit code. Messages name fields/codes only; never subjects or connection strings. */
export async function runProvisionHousehold(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: CliIo,
  deps: CliDeps = defaultDeps,
): Promise<number> {
  try {
    let values;
    try {
      ({ values } = parseArgs({
        args: [...argv],
        options: OPTIONS,
        allowPositionals: false,
        strict: true,
      }));
    } catch {
      io.error('invalid arguments');
      return 1;
    }
    const config = loadDatabaseConfig(env);
    const pool = deps.createPool(config.databaseUrl, 2);
    try {
      const issuer = values.issuer ?? '';
      const household = await deps.createService(pool).provisionHousehold({
        name: values.name ?? '',
        ...(values.timezone === undefined ? {} : { timezone: values.timezone }),
        members: [
          {
            oidcIssuer: issuer,
            oidcSubject: values['owner-subject'] ?? '',
            displayName: values['owner-name'] ?? '',
          },
          {
            oidcIssuer: issuer,
            oidcSubject: values['member-subject'] ?? '',
            displayName: values['member-name'] ?? '',
          },
        ],
      });
      io.log(`created household ${household.id} (${household.timezone})`);
      return 0;
    } finally {
      await pool.end();
    }
  } catch (err) {
    if (err instanceof ZodError) {
      io.error(`invalid input: ${err.issues.map((i) => i.path.join('.')).join(', ')}`);
    } else if (err instanceof AppError || err instanceof ConfigError) {
      io.error(err.message);
    } else {
      io.error('provisioning failed');
    }
    return 1;
  }
}
