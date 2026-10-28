-- Hand-written. recipe_versions rows are immutable after insert (DB §5.1).
CREATE FUNCTION recipe_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'recipe_versions rows are immutable (% blocked)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recipe_versions_no_update_delete
  BEFORE UPDATE OR DELETE ON recipe_versions
  FOR EACH ROW EXECUTE FUNCTION recipe_versions_immutable();
--> statement-breakpoint
CREATE TRIGGER recipe_versions_no_truncate
  BEFORE TRUNCATE ON recipe_versions
  FOR EACH STATEMENT EXECUTE FUNCTION recipe_versions_immutable();
