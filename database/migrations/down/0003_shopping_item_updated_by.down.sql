-- Local/scratch rollback only; production is roll-forward (hard rule 6).
ALTER TABLE shopping_items DROP CONSTRAINT IF EXISTS shopping_items_updater_same_household_fk;
ALTER TABLE shopping_items DROP COLUMN IF EXISTS updated_by_member_id;
