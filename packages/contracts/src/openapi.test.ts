import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderOpenApiDocument } from './openapi.js';

const target = new URL('../../../docs/api/openapi.json', import.meta.url);

// `pnpm --filter @mise/contracts openapi:generate` sets MISE_WRITE_OPENAPI=1 to rewrite the file.
// Otherwise this test is the CI freshness gate: it fails when the committed file is stale.
describe('docs/api/openapi.json', () => {
  it('is generated from the current contracts', () => {
    const generated = renderOpenApiDocument();
    if (process.env['MISE_WRITE_OPENAPI'] === '1') writeFileSync(target, generated);
    let committed = '';
    try {
      committed = readFileSync(target, 'utf8');
    } catch {
      // missing file: fall through to the failing assertion
    }
    expect(committed, 'stale: run pnpm --filter @mise/contracts openapi:generate').toBe(generated);
  });

  it('documents every A endpoint with standard errors', () => {
    const doc = JSON.parse(renderOpenApiDocument()) as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };
    const patch = doc.paths['/api/v1/recipes/{id}']?.['patch'];
    expect(patch?.responses).toHaveProperty('409');
    expect(patch?.responses).toHaveProperty('428');
    expect(patch?.responses).not.toHaveProperty('412');
    expect(doc.paths['/api/v1/recipes']?.['post']?.responses).toHaveProperty('422');
    // Item detail edits need If-Match even though checkoffs do not (ADR-013 addendum, FR-37).
    expect(doc.paths['/api/v1/shopping-items/{id}']?.['patch']?.responses).toHaveProperty('428');
  });
});
