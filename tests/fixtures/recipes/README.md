# Real recipe fixtures (add yours here)

Put 10-15 of your own recipes in this folder as `*.json`, one per file, Finnish content included (some English). They feed card A02 (search golden set), A05 (unit parsing cases), A17 (seed and export round trip) and later the importer tests.

Include variety: ingredient groups ("Kastike:"), ranges ("2-3 kpl"), `maun mukaan`, `rkl`/`tl`/`dl`/`prk`/`ps`, a recipe with no times, an English one, one with a long directions list, and one you have edited so version history can be tested.

The JSON shape follows the recipe content schema v1 defined in card A04 (`packages/contracts`). Until A04 lands, keep them as close as possible to: title, yield, tags, source, notes, ingredient lines (group, original text, amount, unit, name, note), steps.
