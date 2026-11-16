import { expect } from 'vitest';
import { axe } from 'vitest-axe';

/** Fails with the violation ids and nodes when axe finds accessibility problems. */
export async function expectNoAxeViolations(container: Element): Promise<void> {
  const results = await axe(container);
  const summary = results.violations.map((v) => ({
    id: v.id,
    nodes: v.nodes.map((n) => n.html),
  }));
  expect(summary).toEqual([]);
}
