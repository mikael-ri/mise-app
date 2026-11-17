// Admin CLI: export a household's recipes (all versions) as JSON or Markdown (FR-32).
// Usage: pnpm --filter @mise/server cli:export-recipes --household <id> [--format json|md] [--out <file>]
import { runExportRecipes } from './recipe-tools-run.js';

const code = await runExportRecipes(process.argv.slice(2), process.env, {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
});
process.exit(code);
