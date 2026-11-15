// Logic of the auth operator CLIs (`provision-user`, `revoke-sessions`), separate from the entry
// points so it can be tested. Neither command ever creates a device session (ADR-003, runbook).
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createOperatorService } from '../auth/index.js';
import type { OperatorService } from '../auth/index.js';
import { MemberId, nonEmptyText } from '@mise/contracts';
import { AppError, ConfigError, createPool, loadDatabaseConfig } from '../platform/index.js';
import type { Pool } from '../platform/index.js';
import type { CliIo } from './provision-household-run.js';

export interface OperatorCliDeps {
  createPool: (databaseUrl: string, max: number) => Pool;
  createService: (pool: Pool) => OperatorService;
}

const defaultDeps: OperatorCliDeps = {
  createPool,
  createService: (pool) => createOperatorService(pool),
};

type Env = Readonly<Record<string, string | undefined>>;

const LinkArgs = z.strictObject({
  member: MemberId,
  issuer: z.url({ protocol: /^https$/ }).max(512),
  subject: nonEmptyText(255),
});

const MemberIds = z.array(MemberId).min(1);

/** Messages name fields and counts only; never subjects or connection strings. */
async function run(
  env: Env,
  io: CliIo,
  deps: OperatorCliDeps,
  action: (service: OperatorService) => Promise<string>,
): Promise<number> {
  try {
    const config = loadDatabaseConfig(env);
    const pool = deps.createPool(config.databaseUrl, 2);
    try {
      io.log(await action(deps.createService(pool)));
      return 0;
    } finally {
      await pool.end();
    }
  } catch (err) {
    if (err instanceof AppError || err instanceof ConfigError) io.error(err.message);
    else io.error('command failed');
    return 1;
  }
}

/**
 * `provision-user --member <memberId> --issuer <url> --subject <sub>`: links a household member to
 * an OIDC subject and revokes that member's existing sessions.
 */
export async function runProvisionUser(
  argv: readonly string[],
  env: Env,
  io: CliIo,
  deps: OperatorCliDeps = defaultDeps,
): Promise<number> {
  let parsed;
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: {
        member: { type: 'string' },
        issuer: { type: 'string' },
        subject: { type: 'string' },
      },
      allowPositionals: false,
      strict: true,
    });
    parsed = LinkArgs.safeParse(values);
  } catch {
    io.error('invalid arguments');
    return 1;
  }
  if (!parsed.success) {
    io.error(`invalid input: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
    return 1;
  }
  const a = parsed.data;
  return run(env, io, deps, async (s) => {
    const { revoked } = await s.linkIdentity(a.member, a.issuer, a.subject);
    return `linked member ${a.member}; revoked ${revoked} session(s)`;
  });
}

/** `revoke-sessions --member <memberId> [--member <id>...] | --all` (lost-device runbook). */
export async function runRevokeSessions(
  argv: readonly string[],
  env: Env,
  io: CliIo,
  deps: OperatorCliDeps = defaultDeps,
): Promise<number> {
  let members: string[] | null;
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { member: { type: 'string', multiple: true }, all: { type: 'boolean' } },
      allowPositionals: false,
      strict: true,
    });
    if (values.all === true && values.member === undefined) members = null;
    else if (values.all === undefined) members = MemberIds.parse(values.member);
    else throw new Error('both');
  } catch {
    io.error('expected --member <id> (repeatable) or --all, not both');
    return 1;
  }
  return run(env, io, deps, async (s) => {
    const { revoked } = await s.revokeSessions(members);
    return `revoked ${revoked} session(s)`;
  });
}
