// Logic of the recipe export and load CLIs (FR-32), separate from the entry points so it can be
// tested. Messages carry counts and file names only, never recipe content or connection strings.
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { HouseholdId, MemberId } from '@mise/contracts';
import { createHouseholdsService } from '../households/index.js';
import type { HouseholdsService } from '../households/index.js';
import { createRecipesService, parseLoadDocument } from '../recipes/index.js';
import type { RecipesService } from '../recipes/index.js';
import { AppError, ConfigError, createPool, loadDatabaseConfig } from '../platform/index.js';
import type { Pool } from '../platform/index.js';
import type { CliIo } from './provision-household-run.js';

export interface RecipeCliDeps {
  createPool: (databaseUrl: string, max: number) => Pool;
  createService: (pool: Pool) => RecipesService;
  createHouseholds: (pool: Pool) => HouseholdsService;
}

const defaultDeps: RecipeCliDeps = {
  createPool,
  createService: createRecipesService,
  createHouseholds: createHouseholdsService,
};

type Env = Readonly<Record<string, string | undefined>>;

async function withService(
  env: Env,
  io: CliIo,
  deps: RecipeCliDeps,
  action: (service: RecipesService, pool: Pool) => Promise<string>,
): Promise<number> {
  try {
    const config = loadDatabaseConfig(env);
    const pool = deps.createPool(config.databaseUrl, 2);
    try {
      io.log(await action(deps.createService(pool), pool));
      return 0;
    } finally {
      await pool.end();
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      io.error(`invalid input: ${err.issues.map((i) => i.path.join('.')).join(', ') || 'file'}`);
    } else if (err instanceof AppError || err instanceof ConfigError) io.error(err.message);
    else io.error('command failed');
    return 1;
  }
}

const ExportArgs = z.strictObject({
  household: HouseholdId,
  format: z.enum(['json', 'md']).default('json'),
  out: z.string().min(1).optional(),
});

/** `export-recipes --household <id> [--format json|md] [--out <file>]`; writes to stdout without --out. */
export async function runExportRecipes(
  argv: readonly string[],
  env: Env,
  io: CliIo,
  deps: RecipeCliDeps = defaultDeps,
): Promise<number> {
  let args: z.infer<typeof ExportArgs>;
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: {
        household: { type: 'string' },
        format: { type: 'string' },
        out: { type: 'string' },
      },
      allowPositionals: false,
      strict: true,
    });
    const parsed = ExportArgs.safeParse(values);
    if (!parsed.success) {
      io.error(`invalid input: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
      return 1;
    }
    args = parsed.data;
  } catch {
    io.error('invalid arguments');
    return 1;
  }
  return withService(env, io, deps, async (service) => {
    const actor = { householdId: args.household };
    const text =
      args.format === 'md'
        ? await service.exportRecipesMarkdown(actor)
        : `${JSON.stringify(await service.exportRecipes(actor), null, 2)}\n`;
    if (args.out === undefined) {
      io.log(text.trimEnd());
      return '';
    }
    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, text, 'utf8');
    return `exported to ${args.out} (${args.format})`;
  });
}

const LoadArgs = z.strictObject({
  household: HouseholdId.optional(),
  member: MemberId.optional(),
});

export interface MemberCandidate {
  householdId: string;
  memberId: string;
  role: 'owner' | 'member';
}

const pick = (c: MemberCandidate) => ({
  householdId: HouseholdId.parse(c.householdId),
  memberId: MemberId.parse(c.memberId),
});

/**
 * Picks the member the loaded recipes are attributed to. `--member` wins (it must exist, within
 * `--household` when given). Otherwise exactly one household with exactly one owner is required;
 * anything else is ambiguous and the error lists the candidates by id and role (no names).
 */
export function resolveLoadActor(
  candidates: readonly MemberCandidate[],
  args: { household?: string | undefined; member?: string | undefined },
): { householdId: HouseholdId; memberId: MemberId } {
  const inScope = candidates.filter(
    (c) => args.household === undefined || c.householdId === args.household,
  );
  if (args.member !== undefined) {
    const found = inScope.find((c) => c.memberId === args.member);
    if (!found) throw new AppError('not_found', 'member not found');
    return pick(found);
  }
  const owners = inScope.filter((c) => c.role === 'owner');
  const households = new Set(inScope.map((c) => c.householdId));
  const [only] = owners;
  if (households.size === 1 && owners.length === 1 && only) {
    return pick(only);
  }
  const list = inScope.map((c) => `${c.householdId}/${c.memberId} (${c.role})`).join(', ');
  throw new AppError(
    'validation_failed',
    `cannot determine the owner; pass --member <id> (candidates household/member: ${list || 'none'})`,
  );
}

/** Expands directories to their `*.json` files (sorted); keeps explicit files as given. */
async function expandPaths(paths: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const p of paths) {
    if ((await stat(p)).isDirectory()) {
      const names = (await readdir(p)).filter((n) => extname(n) === '.json').sort();
      files.push(...names.map((n) => join(p, n)));
    } else files.push(p);
  }
  return files;
}

/**
 * `load-recipes [--household <id>] [--member <memberId>] <file|dir>...`: loads fixture-format (or
 * export) JSON into an already provisioned household through the normal recipe service. The member
 * defaults to the owner when that is unambiguous. Refused when NODE_ENV=production. Re-running
 * skips recipes already present.
 */
export async function runLoadRecipes(
  argv: readonly string[],
  env: Env,
  io: CliIo,
  deps: RecipeCliDeps = defaultDeps,
): Promise<number> {
  if (env['NODE_ENV'] === 'production') {
    io.error('refusing to load recipes when NODE_ENV=production');
    return 1;
  }
  let args: z.infer<typeof LoadArgs>;
  let paths: string[];
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      options: { household: { type: 'string' }, member: { type: 'string' } },
      allowPositionals: true,
      strict: true,
    });
    const parsed = LoadArgs.safeParse(values);
    if (!parsed.success || positionals.length === 0) {
      io.error('expected [--household <id>] [--member <id>] and at least one file or directory');
      return 1;
    }
    args = parsed.data;
    paths = positionals;
  } catch {
    io.error('invalid arguments');
    return 1;
  }
  return withService(env, io, deps, async (service, pool) => {
    const candidates = await deps.createHouseholds(pool).listProvisionedMembers(args.household);
    const actor = resolveLoadActor(candidates, args);
    let created = 0;
    let skipped = 0;
    const failed: string[] = [];
    for (const file of await expandPaths(paths)) {
      let entries;
      try {
        entries = parseLoadDocument(JSON.parse(await readFile(file, 'utf8')));
      } catch {
        failed.push(file); // reason withheld: it could quote recipe content
        continue;
      }
      for (const entry of entries) {
        try {
          if ((await service.loadRecipe(actor, entry)) === 'created') created += 1;
          else skipped += 1;
        } catch {
          // Loading is not atomic: a half-built recipe stays and a rerun skips it by title.
          failed.push(`"${entry.title}"`);
        }
      }
    }
    if (failed.length > 0) {
      for (const f of failed)
        io.error(`could not load ${f}${f.startsWith('"') ? ' (check for a partial recipe)' : ''}`);
      io.log(`loaded ${created} recipe(s), skipped ${skipped} existing, failed ${failed.length}`);
      throw new AppError('validation_failed', `${failed.length} file(s) failed`);
    }
    return `loaded ${created} recipe(s), skipped ${skipped} existing`;
  });
}
