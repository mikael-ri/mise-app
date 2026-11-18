# UI: import

Follows `conventions.md`. Mobile first.

## Entry
```
+------------------------------------+
| Add a recipe                       |
| [ Link ] [ Text ] [ Photo ]        |
|                                    |
| https://...........................|
|                       [ Import ]   |
| Or paste the recipe text instead   |
+------------------------------------+
```
Photo mode: take or choose a photo (JPEG, PNG, WebP). HEIC shows: "This format is not supported. Choose another photo or convert it first."

## Progress
"Reading the page..." with a Cancel button. Nothing is saved while this runs.

## Review
```
+------------------------------------+
| Review before saving               |
| ! Possible duplicate: "Lihapullat" |
|   [Open existing]                  |
| Title   [ Lihapullat ............] |
| Yield   [ 4 ]  Time [ 45 min ]     |
| Ingredients (3 need checking)      |
|  ! [ 2 dl ] [ kermaa ] (unsure)    |
| Steps ...                          |
| [ ] Keep the photo                 |
|     [ Discard ]      [ Save ]      |
+------------------------------------+
```
Uncertain fields are marked and editable. Save is explicit; leaving the screen keeps the draft for 7 days.

## Failures
- Fetch failed: "We could not read that page. Paste the recipe text instead." with the paste mode opened.
- Extraction failed: show what was found if anything, otherwise offer the text mode.
- AI limit reached: "The AI limit for today is used. You can still enter the recipe by hand or paste a page that has structured data." No error codes shown.
- Drafts list: pending drafts with age and Resume or Discard.
