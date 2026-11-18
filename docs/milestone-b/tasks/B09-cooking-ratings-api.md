# B09: Cooking events and ratings API

**Depends on:** B03, B01 · **Size:** M · **Model tier:** Regular · **Autonomy:** auto

## Covers
FR-13, FR-14, FR-31, database section 5.4.

## Do
- Create, list, edit and delete cooking events; members can change only their own events.
- Fields: date, tested, optional rating, optional note, attribution to the member.
- Recipe list filters: tested, rating range, time ranges, member filter for ratings.
- Aggregate fields on `RecipeSummary`: household average (unrated is not zero), count, last cooked.

## Done when
Integration tests cover attribution, own-event rules, filters, aggregates with unrated events, and household isolation.
