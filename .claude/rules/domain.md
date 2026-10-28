---
globs:
  - 'packages/domain/**'
---

# Domain rules

- Pure logic, no I/O, no imports from other repo packages.
- Decimal/rational maths only, never floats. Never convert count, mass and volume into each other.
- Preserve original ingredient text and units. Never invent package sizes.
- Table-driven tests for every rule.
