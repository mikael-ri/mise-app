DROP TRIGGER IF EXISTS recipe_versions_no_truncate ON recipe_versions;
DROP TRIGGER IF EXISTS recipe_versions_no_update_delete ON recipe_versions;
DROP FUNCTION IF EXISTS recipe_versions_immutable();
