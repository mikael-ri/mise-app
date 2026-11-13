-- Local/scratch rollback only; production is roll-forward (hard rule 6).
DROP TABLE IF EXISTS
  idempotency_keys, audit_events, shopping_items, shopping_lists, household_ingredient_settings,
  shopping_categories, recipes, recipe_versions, device_sessions, household_members, households, users
  CASCADE;
DROP FUNCTION IF EXISTS recipe_versions_immutable();
