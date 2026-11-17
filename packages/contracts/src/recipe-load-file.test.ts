import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RecipeLoadFile } from './recipes.js';

const dir = new URL('../../../tests/fixtures/recipes/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('RecipeLoadFile (FR-32)', () => {
  it('finds the fixture recipes', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files)('FR-32: fixture %s matches the loader file schema', (name) => {
    const json: unknown = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
    expect(RecipeLoadFile.safeParse(json).error?.issues).toBeUndefined();
  });

  it('FR-32: rejects unknown keys', () => {
    expect(RecipeLoadFile.safeParse({ title: 'x', surprise: 1 }).success).toBe(false);
  });
});
