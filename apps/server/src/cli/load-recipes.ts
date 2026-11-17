// Admin CLI: load recipe JSON files (fixture or export format) into a provisioned household (FR-32).
// An ops tool, not the importer. Recipe + version 1 are atomic; a failure on a later version leaves a recipe with fewer versions
// than the file, which is reported by title and completed by a rerun. `pnpm db:seed` runs this on
// tests/fixtures/recipes. The owner is looked up when exactly one household with one owner exists;
// otherwise pass --member <id> (and optionally --household <id>). Refused when NODE_ENV=production.
// Usage:
//   pnpm db:seed [--household <id>] [--member <memberId>]
//   pnpm --filter @mise/server cli:load-recipes [--household <id>] [--member <memberId>] <file|dir>...
import { runLoadRecipes } from './recipe-tools-run.js';

const code = await runLoadRecipes(process.argv.slice(2), process.env, {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
});
process.exit(code);
