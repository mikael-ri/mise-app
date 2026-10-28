# Mise UI — conventions, navigation and shared patterns (Milestone A)

Low-fidelity wireframes. They fix **structure, behaviour and states**, not visual style. Visual styling comes from the component library and design tokens chosen in card A11. If a screen has no wireframe, keep it plain and ask before inventing layout.

Screen files: `auth-and-devices.md`, `recipes.md`, `shopping.md`.
Mobile (390 px wide) is the primary layout. Wireframes use ASCII only: `[ ]` unchecked, `[x]` checked, `( )` chip, `[ Text ]` button or input, `...` more content.

## 1. Sitemap and routes

| Route | Screen | Cards |
|---|---|---|
| `/signin` | Signed-out landing, session-expired, access-denied | A11 |
| `/` | Redirects to `/recipes` (the Today view arrives in Milestone C) | A11 |
| `/recipes` | Recipe list and search | A12 |
| `/recipes/new` | Create recipe | A12 |
| `/recipes/:id` | Recipe detail with servings converter | A12 |
| `/recipes/:id/edit` | Edit recipe | A12 |
| `/recipes/:id/versions` | Version history | A12 |
| `/recipes/:id/versions/:versionId` | Read-only older version | A12 |
| `/shopping` | Shopping lists index | A15 |
| `/shopping/:listId` | Shopping list | A15 |
| `/settings` | Settings home | A11 |
| `/settings/devices` | Signed-in devices | A11 |

There is no Mise password screen: sign-in is a redirect to Authelia. Deep links to protected routes redirect to `/signin` and return to the original path after sign-in (same-origin paths only).

## 2. Navigation

```
MOBILE (< 1024 px)
+--------------------------------------+
| Page title                  [ ... ]  |  header: title, back arrow when nested, overflow menu
+--------------------------------------+
|                                      |
|            page content             |
|                                      |
+--------------------------------------+
| [Recipes]   [Shopping]   [Settings]  |  bottom tab bar, 3 tabs in Milestone A
+--------------------------------------+

DESKTOP (>= 1024 px)
+-----------+--------------------------+
| Mise      | Page title      [ ... ]  |
| Recipes   |                          |
| Shopping  |   content, max width     |
| Settings  |   960 px (list view:     |
|           |   640 px, centred)       |
| Anna  [v] |                          |
+-----------+--------------------------+
```

Only tabs that exist in the current milestone are shown. Never show disabled placeholders for later milestones.

## 3. Shared patterns

| Pattern | Behaviour |
|---|---|
| Loading | Skeleton rows for lists, spinner only inside buttons. Never block the whole page on a refetch. |
| Empty | Plain explanation plus one primary action, e.g. "No recipes yet" + `[ New recipe ]`. |
| No results | "No recipes match 'x'" + `[ Clear search ]`. |
| Error | Inline message with `[ Try again ]`. Show the `correlationId` in small text for support. No stack traces. |
| Conflict (`409`) | Never silent. Explain who changed it and offer explicit choices (see recipe and shopping files). |
| Session ended (`401`) | Full-screen "Your session has ended" with `[ Sign in ]`. Open SSE streams close. |
| Destructive actions | Confirm dialog naming the object and the consequence (archive, revoke device, restore version). No confirm for checkoff or undo-able actions. |
| Toasts | Short confirmation at the bottom above the tab bar, 4 s, one at a time. Not for errors that need action. |
| Reconnecting | Small status indicator in the shopping list header (see `shopping.md`), not a modal. |

## 4. Forms

- Label above each input, visible at all times; placeholder is never the label.
- Validate on blur and on submit; messages next to the field; first invalid field gets focus.
- Primary action is one clear button; it shows a spinner and is disabled while saving.
- Unsaved changes on a form: warn on leaving.

## 5. Responsive and touch

- Touch targets at least 44 x 44 px. Checkbox hit area covers the whole left part of the row, not only the box.
- Shopping list is designed for one-handed use: primary controls in the lower half; add-item bar sticky above the tab bar.
- No hover-only features. Desktop gets denser spacing and sidebar navigation, nothing more.

## 6. Accessibility

- Real `<input type="checkbox">`, `<button>`, `<a>`, `<label>`, headings in order.
- Visible focus ring, full keyboard operation, dialogs trap focus and restore it on close.
- State is never conveyed by colour alone (picked = checked box + struck text; error = icon + text).
- Contrast meets WCAG AA. Support light and dark via design tokens (`prefers-color-scheme`); useful in dim shops.
- Live changes from the other member are announced politely (`aria-live="polite"`) without moving focus.

## 7. i18n and formatting

- All text via i18n keys named `feature.screen.element`, e.g. `recipes.list.empty.title`. English labels in P0; recipe content is Finnish.
- Use ICU plurals for counts ("1 item", "3 items"). Never concatenate translated fragments.
- Format numbers and dates with `Intl` using the household locale (default `fi-FI`, so `1,5 dl`). Quantities come from `packages/domain` formatting.

## 8. Test IDs (for E2E, card A16)

`data-testid` values: `recipe-card`, `recipe-search-input`, `servings-input`, `servings-reset`, `ingredient-line`, `version-row`, `shopping-list-card`, `shopping-item` (with `data-item-id`), `item-checkbox`, `add-item-input`, `picked-section`, `sync-status`, `device-row`, `revoke-device`.

## 9. Component primitives needed (choose the library in A11)

Accessible dialog, bottom sheet, dropdown menu, tabs or tab bar, toast, checkbox, select, chip input, collapsible section, skeleton. Do not hand-roll these.
