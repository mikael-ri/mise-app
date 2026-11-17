// Admin CLI: load recipe JSON files (fixture or export format) into a provisioned household (FR-32).
// An ops tool, not the importer. Not atomic per recipe: a failure midway can leave a partial recipe, which a rerun skips by title;
// the failed title is reported so the operator can fix it. `pnpm db:seed` runs this on
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
