# Shopping screens (cards A13, A14, A15)

Covers FR-34 to FR-37, FR-39, NFR-05, NFR-09, AC-08, AC-10. Designed for one-handed use in a shop. Nothing here depends on AI. Not in Milestone A: plan-generated items, reconciliation, skipped-staples review, offline write queue.

## S1. Lists index `/shopping`

```
+--------------------------------------+
| Shopping                             |
+--------------------------------------+
| Weekend shop                         |
| 3 of 8 picked up      updated 10:42  |
+--------------------------------------+
| Hardware store                       |
| 0 of 2 picked up      updated Mon    |
+--------------------------------------+
| Archived lists (3)               [>] |  collapsed
+--------------------------------------+
|                          [ + New list]|
+--------------------------------------+
| [Recipes]   [Shopping]   [Settings]  |
+--------------------------------------+
```

- Active lists first, newest activity on top. Tap a card to open `S2`.
- `[ + New list ]` asks for a name only (default: "Shopping" plus date) and opens the empty list.
- Archived lists: expandable section; each can be opened read-only and has `[ Restore ]`.
- States: skeleton; empty "No lists yet" + `[ New list ]`; error with try again.

## S2. List view `/shopping/:listId`

```
+--------------------------------------+
| < Lists   Weekend shop      [ ... ]  |  overflow: Rename, Manage categories, Archive list
| (o) Live                  3 of 8     |  sync status and progress
+--------------------------------------+
| VEGETABLES & FRUIT (2)            v  |  category header, collapsible
| [ ] Carrots                 1 kg     |
| [ ] Cucumber                2 pcs    |
| DAIRY (1)                         v  |
| [ ] Milk                    2 l      |
| OTHER (1)                         v  |
| [ ] Batteries AA            4 pcs    |
|                                      |
| PICKED UP (4)                     >  |  collapsed by default, tap to expand
+--------------------------------------+
| [ Add item...                  ] [+] |  sticky above the tab bar
+--------------------------------------+
| [Recipes]   [Shopping]   [Settings]  |
+--------------------------------------+
```

Behaviour:
- Items are grouped by category (FR-36) in the household's category order, `Other` last. Empty categories are not shown.
- Row: checkbox (large hit area), name, quantity and unit muted on the right, note on a second muted line if present. Tapping the checkbox toggles picked; tapping the row opens `S4`.
- Picked items move to the collapsed **Picked up** section (still grouped by category when expanded) and appear struck through there. Un-picking moves them back.
- Checkoff is **optimistic**: the row updates immediately and shows a subtle pending mark until the server confirms. Two people ticking the same item converge without any error message (desired state, not toggle).
- When the other member changes anything, the list updates in place without a refresh and without moving the user's scroll position. Announce changes politely for screen readers.
- Header status indicator:

| State | Display |
|---|---|
| Connected | `(o) Live` |
| Reconnecting | `(!) Reconnecting...` with the list still visible; on reconnect the list refetches silently |
| Not saved | The affected row shows a warning icon and `[ Retry ]`; the optimistic change is reverted if not retried |
| Session ended | Full-screen sign-in message (see conventions) |

- Offline writes are not queued in Milestone A: if the network is down, taps fail visibly rather than silently.
- Desktop: centred column, max width 640 px.
- States: skeleton; empty list "Nothing here yet. Add your first item below."; all picked: "Everything is picked up" with the Picked up section still available.
- Archived list: read-only banner and `[ Restore list ]`.

## S3. Adding an item (sticky bar)

```
Step 1: type and press Enter / [+]
+--------------------------------------+
| [ Maito                        ] [+] |
+--------------------------------------+

Step 2: item appears immediately in its category; a toast offers a change
+--------------------------------------+
| Added "Maito" to Dairy.  [ Change ]  |
+--------------------------------------+
```

- One field and one action: type the name and press Enter. No free-text parsing of quantities in Milestone A.
- The category comes from the household's remembered category for that normalized name (lowercased, trimmed); if none, `Other`. `[ Change ]` opens `S4` focused on the category.
- The field stays focused after adding so several items can be entered quickly. Empty or duplicate-looking names are allowed (the user decides), but a whitespace-only name is rejected.
- Quantity, unit, note and non-food items are all handled the same way: it is just an item. Edit details in `S4`.

## S4. Item details (bottom sheet)

```
+--------------------------------------+
| Maito                           [ X ]|
+--------------------------------------+
| Name       [ Maito                 ] |
| Quantity   [ 2     ]  Unit [ l    v] |
| Note       [ rasvaton              ] |
| Category   [ Dairy               v ] |
| [x] Picked up                        |
|                                      |
| Added by Ankka, Mon 08:15            |
| Picked up by Anna, 10:42             |
|                                      |
| [ Delete item ]            [ Save ]  |
+--------------------------------------+
```

Behaviour:
- Quantity and unit are optional and free (`2`, `l`; or only a note). Units are a select with free text allowed.
- Changing the category of an item stores the choice for that normalized name for the whole household (FR-36). Say so in small text under the field: "Remember this category for 'maito'".
- Delete asks for confirmation only if the item is already picked up; otherwise it deletes immediately with an `[ Undo ]` toast.
- Stale edit (`409`): the sheet stays open and shows "Changed by Anna while you were editing. [ Show latest ]". Showing latest replaces the form values; nothing is overwritten silently.
- Attribution lines are informational; they do not appear in the list rows.

## S5. Manage categories (from list overflow)

```
+--------------------------------------+
| < Weekend shop    Categories         |
+--------------------------------------+
| :: Vegetables & fruit        [ ... ] |
| :: Dairy                     [ ... ] |
| :: Meat & fish               [ ... ] |
| :: Dry goods                 [ ... ] |
| :: Household supplies        [ ... ] |
| :: Other (fixed)                     |
| [ + Add category ]                   |
+--------------------------------------+
```

- Categories belong to the household, not to one list. Row menu: Rename, Hide, Delete (items fall back to `Other`).
- `Other` cannot be renamed or deleted. Reordering with the drag handle and up/down actions applies if the Milestone A schema includes a sort order (confirm in A04); otherwise show categories in a fixed default order and omit reordering.
- Default set follows FR-36 examples: vegetables, fruit, dairy, meat, dry goods, household supplies, plus `Other`. Merging fruit into "Vegetables & fruit" is acceptable if A04 provides it.

## Messages (copy for i18n keys)

| Key | English text |
|---|---|
| `shopping.sync.live` | Live |
| `shopping.sync.reconnecting` | Reconnecting... |
| `shopping.item.saveFailed` | Not saved. Retry |
| `shopping.item.conflict` | Changed by {name} while you were editing. |
| `shopping.list.empty` | Nothing here yet. Add your first item below. |
| `shopping.list.allPicked` | Everything is picked up |
