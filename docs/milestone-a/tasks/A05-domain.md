# A05 — Domain: quantities, units, scaling

**Depends on:** A00 · **Size:** M · **Model tier:** Regular
**Covers:** FR-05, FR-06; AC-14
**Read only:** tech §5.1, §6; spec FR-05, FR-06; DB §5.2; rule file domain.md

## Goal
A pure, thoroughly tested package for ingredient maths.

## Do
- Choose and record a decimal/rational helper; no JS floats for quantity arithmetic.
- Quantity and range types; unit table with `kpl`, `rkl`, `tl`, `dl`, `prk`, `ps`, `maun mukaan`.
- Safe conversions only within one dimension; count, mass and volume are never equated; package units untouched.
- `scale()` honouring `scale_policy` (`linear`, `round_to_whole`, `to_taste`, `not_scalable`), ranges stay ranges, original unit kept.
- Friendly fraction formatting and a warning when rounding materially changes yield.
- Placeholder normalized key: lowercase + trim.

## Not in scope
- Calendar helpers, nutrition, anything with I/O.

## Done when
- Table-driven tests with Finnish cases; fixtures in `tests/fixtures/units.json`.
- A property test: scaling by f then 1/f returns the original for linear lines.

Finish with: what changed, FR/AC IDs covered, test results, open questions.
