# Recipe screens (cards A10, A12)

Covers FR-01 to FR-07, AC-02, AC-03, AC-14, AC-18. Not in Milestone A: import, photos, cooking history, ratings, tested-status filters, favourites.

## R1. Recipe list and search `/recipes`

```
+--------------------------------------+
| Recipes                    [ ... ]   |  overflow: Show archived
+--------------------------------------+
| [ Search recipes and ingredients ]   |  sticky, debounced 250 ms
| (Dinner) (Soup) (Fish) (Vegetarian)->|  tag chips, horizontal scroll, multi-select
| (Under 30 min) (Under 60 min)        |  total-time filter, single select
+--------------------------------------+
| Kasvissosekeitto                     |
| Soup, Vegetarian      35 min  4 serv.|
+--------------------------------------+
| Uunilohi ja perunat                  |
| Fish, Dinner          50 min  4 serv.|
+--------------------------------------+
| ...                                  |
|                                 [ + ]|  floating button: New recipe
+--------------------------------------+
| [Recipes]   [Shopping]   [Settings]  |
+--------------------------------------+
```

Behaviour:
- One search box covers titles, ingredients, directions and notes (FR-02, FR-07). Results come ranked from the API; do not re-sort on the client.
- Tag chips are built from existing tags. A recipe card opens `R2`.
- "Show archived" switches to archived recipes, each with `[ Restore ]`. Archived recipes are hidden by default.
- Pagination: load more on scroll (or a `[ Load more ]` button); keep scroll position when returning from detail.
- Desktop: two-column card grid.
- States: skeleton; empty "No recipes yet" + `[ New recipe ]`; no results with `[ Clear search ]`; error with `[ Try again ]`.

## R2. Recipe detail `/recipes/:id`

```
+--------------------------------------+
| < Recipes                    [ ... ] |  overflow: Edit, History, Archive
+--------------------------------------+
| Uunilohi ja perunat                  |
| Fish, Dinner                         |
| 50 min   Source: example.fi/uunilohi |
| Last changed by Anna, 27 Oct (v3)    |
+--------------------------------------+
| Servings  [ - ]  4  [ + ]  [ Reset ] |  FR-06 converter
| Preview only, not saved.             |  shown only when different from the recipe's yield
+--------------------------------------+
| Ingredients                          |
|  FISH                                |  group header
|  600 g      lohifile                 |
|  800 g      perunaa, kuorittuna      |
|  SAUCE                               |
|  2 dl       ruokakermaa              |
|  1-2 kpl    sitruuna                 |  range stays a range
|  to taste   suolaa                   |  "maun mukaan", never scaled
+--------------------------------------+
| Directions                           |
|  1. Heat the oven to 200 C.          |
|  2. ...                              |
+--------------------------------------+
| Notes                                |
|  Works with trout as well.  [ Edit ] |
+--------------------------------------+
```

Behaviour:
- Converter (AC-14): stepper plus direct number input; scaling uses `packages/domain`; nothing is saved and nothing is sent to the API. Reset returns to the recipe's yield. The preview state is not persisted across navigation.
- Scaled values keep the original unit. Vague amounts stay unchanged and keep their text. When rounding changes a quantity noticeably, prefix `~` and show a small hint: "Rounded for practicality".
- Ingredient lines show original text where the structured form is ambiguous; never display invented package sizes.
- Notes are mutable metadata: editing them does not create a version.
- Overflow: **Edit** opens `R3`, **History** opens `R4`, **Archive** opens a confirm dialog ("Archive 'Uunilohi ja perunat'? It will be hidden from lists but can be restored.").
- Desktop: ingredients and directions side by side.
- States: skeleton; not found or archived message (archived recipe shows a banner with `[ Restore ]`).

## R3. Create and edit `/recipes/new`, `/recipes/:id/edit`

```
+--------------------------------------+
| X  Edit recipe              [ Save ] |
+--------------------------------------+
| Title                                |
| [ Uunilohi ja perunat              ] |
| Yield            Prep      Cook      |
| [ 4 ] [servings] [ 15 min ] [ 35 ]  |
| Tags                                 |
| [ Fish x  Dinner x  add tag...     ] |
| Source                               |
| [ https://...                      ] |
+--------------------------------------+
| Ingredients                          |
| :: Group  [ Fish                  ]  |  group header row
| :: [ 600 ] [ g    v] [ lohifile   ]  |  amount, unit, name
|    [ note: pilkottuna          ] [..]|  optional preparation note, row menu
| :: [ 800 ] [ g    v] [ perunaa    ]  |
| [ + Ingredient ]  [ + Group ]        |
+--------------------------------------+
| Directions                           |
| :: 1 [ Heat the oven to 200 C.     ] |
| :: 2 [ ...                         ] |
| [ + Step ]                           |
+--------------------------------------+
| Notes (saved without a new version)  |
| [ Works with trout as well.        ] |
+--------------------------------------+
| What changed? (optional)             |
| [ Reduced fish from 800 to 600 g   ] |  shown only when cooking content changed
|                                      |
| [ Save new version ]                 |  label is [ Save ] when only tags/notes/source changed
+--------------------------------------+
```

Behaviour:
- `::` is a drag handle; every row also has up/down actions in its row menu for touch and keyboard.
- Ingredient row menu: Make range (min-max), Scaling (`linear` default, `round to whole`, `to taste`, `do not scale`), Delete. Unit is a select of known units (`g`, `kg`, `ml`, `dl`, `l`, `tl`, `rkl`, `kpl`, `prk`, `ps`) with free text allowed. Free text such as `maun mukaan` is accepted and stored as entered.
- The form preserves what the user typed; it never rewrites units or invents quantities.
- Save button reads **Save new version** only if ingredients, directions or yield changed; otherwise **Save**. The API call carries the expected current version.
- Validation: title required; yield positive; at least one ingredient or step (decided in A09); inline messages.
- Leaving with unsaved edits asks for confirmation.
- Create (`/recipes/new`) is the same form with an empty state and the button **Create recipe**; it creates version 1.
- Desktop: same single column, max width 720 px.

### R3a. Conflict dialog (`409`)

Shown when Save returns a stale-version conflict.

```
+--------------------------------------+
| Anna saved a newer version           |
| while you were editing.              |
|                                      |
| [ Open latest version ]              |  opens in the same tab; your draft is kept locally
| [ Save mine as newest ]              |  creates a new version on top of Anna's
| [ Discard my changes ]               |
+--------------------------------------+
```

"Save mine as newest" requires a second confirmation line ("This replaces the current content with your edits; Anna's version stays in history.").

## R4. Version history `/recipes/:id/versions`

```
+--------------------------------------+
| < Uunilohi ja perunat   History      |
+--------------------------------------+
| v3  CURRENT                          |
| Anna, 27 Oct 2026 18:12              |
| Reduced fish from 800 to 600 g       |
|                         [ View ]     |
+--------------------------------------+
| v2                                   |
| Ankka, 24 Oct 2026 20:03             |
| Added lemon                          |
|              [ View ] [ Restore ]    |
+--------------------------------------+
| v1                                   |
| Ankka, 20 Oct 2026 19:40             |
| (no reason given)                    |
|              [ View ] [ Restore ]    |
+--------------------------------------+
```

Behaviour:
- Shows author, time and change reason (FR-03). Newest first. Either member can view and restore (AC-03).
- **View** opens `/recipes/:id/versions/:versionId`: the R2 layout, read-only, with a banner "You are viewing v2 (not current)" and `[ Restore this version ]`. The servings converter still works.
- **Restore** confirms ("Restore v2? This creates a new version v4 with v2's content. Nothing is deleted.") and then shows the new current version.
- Version comparison and diff are out of Milestone A.
