import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertContentValid } from './content-rules.js';
import { parseLoadDocument } from './loader.js';

const dir = new URL('../../../../tests/fixtures/recipes/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const read = (f: string): unknown => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));

describe('fixture loader conversion (FR-32)', () => {
  it('FR-32: a file without a yield loads with a null yield, none is invented', () => {
    const nulls = files.filter(
      (f) => (read(f) as { content: { yield: unknown } }).content.yield === null,
    );
    expect(nulls.length).toBeGreaterThan(0);
    for (const f of nulls)
      expect(parseLoadDocument(read(f))[0]?.versions[0]?.content.yield).toBeNull();
  });

  it.each(files)('FR-32: %s converts to valid recipe content', (f) => {
    const [entry] = parseLoadDocument(read(f));
    expect(entry?.versions).toHaveLength(1);
    expect(() => assertContentValid(entry!.versions[0]!.content)).not.toThrow();
  });

  it('FR-32: ids are deterministic and original text is untouched', () => {
    const json = read(files[0]!);
    const a = parseLoadDocument(json)[0]!.versions[0]!.content;
    const b = parseLoadDocument(json)[0]!.versions[0]!.content;
    expect(a).toEqual(b);
    const src = json as { content: { ingredients: { original_quantity_text: string | null }[] } };
    expect(a.ingredients.map((l) => l.original_quantity_text)).toEqual(
      src.content.ingredients.map((l) => l.original_quantity_text),
    );
  });

  it('FR-32: rejects a malformed file', () => {
    expect(() => parseLoadDocument({ title: 'x' })).toThrow();
  });
});
