CREATE TABLE "device_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"device_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"authenticated_at" timestamp with time zone NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "device_sessions_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "device_sessions_token_hash_len_ck" CHECK (octet_length("device_sessions"."token_hash") = 32),
	CONSTRAINT "device_sessions_expiry_order_ck" CHECK ("device_sessions"."idle_expires_at" <= "device_sessions"."absolute_expires_at"),
	CONSTRAINT "device_sessions_absolute_after_created_ck" CHECK ("device_sessions"."absolute_expires_at" > "device_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_members_household_user_uq" UNIQUE("household_id","user_id"),
	CONSTRAINT "household_members_user_uq" UNIQUE("user_id"),
	CONSTRAINT "household_members_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "household_members_role_ck" CHECK ("household_members"."role" IN ('owner', 'member'))
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Helsinki' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "households_timezone_nonempty_ck" CHECK ("households"."timezone" <> '')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oidc_issuer" text NOT NULL,
	"oidc_subject" text NOT NULL,
	"display_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_oidc_identity_uq" UNIQUE("oidc_issuer","oidc_subject"),
	CONSTRAINT "users_oidc_nonempty_ck" CHECK ("users"."oidc_issuer" <> '' AND "users"."oidc_subject" <> '')
);
--> statement-breakpoint
CREATE TABLE "recipe_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"change_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_versions_recipe_version_no_uq" UNIQUE("recipe_id","version_no"),
	CONSTRAINT "recipe_versions_recipe_id_id_uq" UNIQUE("recipe_id","id"),
	CONSTRAINT "recipe_versions_version_no_ck" CHECK ("recipe_versions"."version_no" >= 1),
	CONSTRAINT "recipe_versions_schema_version_ck" CHECK ("recipe_versions"."schema_version" >= 1),
	CONSTRAINT "recipe_versions_content_schema_version_ck" CHECK (jsonb_typeof("recipe_versions"."content") = 'object' AND ("recipe_versions"."content" -> 'schema_version') IS NOT DISTINCT FROM to_jsonb("recipe_versions"."schema_version"))
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"current_version_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"general_notes" text,
	"archived_at" timestamp with time zone,
	"source_type" text,
	"source_url" text,
	"created_by_member_id" uuid NOT NULL,
	"search_title" text DEFAULT '' NOT NULL,
	"search_ingredients" text DEFAULT '' NOT NULL,
	"search_body" text DEFAULT '' NOT NULL,
	"search_document" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('finnish'::regconfig, search_title), 'A') || setweight(to_tsvector('simple'::regconfig, search_title), 'A') || setweight(to_tsvector('finnish'::regconfig, search_ingredients), 'B') || setweight(to_tsvector('simple'::regconfig, search_ingredients), 'B') || setweight(to_tsvector('finnish'::regconfig, search_body), 'C') || setweight(to_tsvector('simple'::regconfig, search_body), 'C')) STORED NOT NULL,
	"search_fold" text GENERATED ALWAYS AS (fold(search_title || ' ' || search_ingredients || ' ' || search_body)) STORED NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipes_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "recipes_title_nonempty_ck" CHECK (btrim("recipes"."title") <> ''),
	CONSTRAINT "recipes_revision_ck" CHECK ("recipes"."revision" >= 1),
	CONSTRAINT "recipes_source_type_ck" CHECK ("recipes"."source_type" IS NULL OR "recipes"."source_type" IN ('manual', 'url', 'text', 'photo'))
);
--> statement-breakpoint
CREATE TABLE "household_ingredient_settings" (
	"household_id" uuid NOT NULL,
	"normalized_key" text NOT NULL,
	"is_staple" boolean DEFAULT false NOT NULL,
	"shopping_category_id" uuid,
	"preferred_label" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_ingredient_settings_pk" PRIMARY KEY("household_id","normalized_key"),
	CONSTRAINT "household_ingredient_settings_key_ck" CHECK ("household_ingredient_settings"."normalized_key" <> '' AND "household_ingredient_settings"."normalized_key" = btrim("household_ingredient_settings"."normalized_key")),
	CONSTRAINT "household_ingredient_settings_revision_ck" CHECK ("household_ingredient_settings"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "shopping_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"system_code" text,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"is_system_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_categories_system_code_uq" UNIQUE("system_code"),
	CONSTRAINT "shopping_categories_household_name_uq" UNIQUE("household_id","name"),
	CONSTRAINT "shopping_categories_scope_ck" CHECK (("shopping_categories"."is_system_default" AND "shopping_categories"."household_id" IS NULL AND "shopping_categories"."system_code" IS NOT NULL) OR (NOT "shopping_categories"."is_system_default" AND "shopping_categories"."household_id" IS NOT NULL AND "shopping_categories"."system_code" IS NULL)),
	CONSTRAINT "shopping_categories_system_code_ck" CHECK ("shopping_categories"."system_code" IS NULL OR "shopping_categories"."system_code" IN ('vegetables', 'fruit', 'dairy', 'meat', 'dry_goods', 'household_supplies', 'other')),
	CONSTRAINT "shopping_categories_name_nonempty_ck" CHECK (btrim("shopping_categories"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "shopping_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"shopping_list_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"name" text NOT NULL,
	"normalized_key" text,
	"amount_min" numeric,
	"amount_max" numeric,
	"unit_code" text,
	"original_quantity_text" text,
	"note" text,
	"category_id" uuid,
	"picked" boolean DEFAULT false NOT NULL,
	"picked_at" timestamp with time zone,
	"picked_by_member_id" uuid,
	"user_modified" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_items_origin_ck" CHECK ("shopping_items"."origin" IN ('user', 'generated')),
	CONSTRAINT "shopping_items_name_nonempty_ck" CHECK (btrim("shopping_items"."name") <> ''),
	CONSTRAINT "shopping_items_normalized_key_ck" CHECK ("shopping_items"."normalized_key" IS NULL OR ("shopping_items"."normalized_key" <> '' AND "shopping_items"."normalized_key" = btrim("shopping_items"."normalized_key"))),
	CONSTRAINT "shopping_items_amounts_ck" CHECK (("shopping_items"."amount_min" IS NULL OR "shopping_items"."amount_min" >= 0) AND ("shopping_items"."amount_max" IS NULL OR ("shopping_items"."amount_min" IS NOT NULL AND "shopping_items"."amount_max" >= "shopping_items"."amount_min"))),
	CONSTRAINT "shopping_items_picked_ck" CHECK (("shopping_items"."picked" AND "shopping_items"."picked_at" IS NOT NULL AND "shopping_items"."picked_by_member_id" IS NOT NULL) OR (NOT "shopping_items"."picked" AND "shopping_items"."picked_at" IS NULL AND "shopping_items"."picked_by_member_id" IS NULL)),
	CONSTRAINT "shopping_items_revision_ck" CHECK ("shopping_items"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "shopping_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"change_seq" bigint DEFAULT 0 NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_lists_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "shopping_lists_status_ck" CHECK ("shopping_lists"."status" IN ('active', 'archived')),
	CONSTRAINT "shopping_lists_change_seq_ck" CHECK ("shopping_lists"."change_seq" >= 0),
	CONSTRAINT "shopping_lists_revision_ck" CHECK ("shopping_lists"."revision" >= 1),
	CONSTRAINT "shopping_lists_name_nonempty_ck" CHECK (btrim("shopping_lists"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"actor_member_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_summary_object_ck" CHECK (jsonb_typeof("audit_events"."summary") = 'object')
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"actor_member_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"request_key" text NOT NULL,
	"request_hash" "bytea" NOT NULL,
	"result_ref" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_scope_uq" UNIQUE("household_id","actor_member_id","operation","request_key"),
	CONSTRAINT "idempotency_keys_operation_ck" CHECK ("idempotency_keys"."operation" ~ '^[a-z][a-z0-9_.]{0,63}$'),
	CONSTRAINT "idempotency_keys_request_key_ck" CHECK ("idempotency_keys"."request_key" ~ '^[A-Za-z0-9_-]{16,128}$'),
	CONSTRAINT "idempotency_keys_request_hash_len_ck" CHECK (octet_length("idempotency_keys"."request_hash") = 32),
	CONSTRAINT "idempotency_keys_expiry_ck" CHECK ("idempotency_keys"."expires_at" > "idempotency_keys"."created_at")
);
--> statement-breakpoint
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_created_by_member_id_household_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."household_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_current_version_same_recipe_fk" FOREIGN KEY ("id","current_version_id") REFERENCES "public"."recipe_versions"("recipe_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_creator_same_household_fk" FOREIGN KEY ("household_id","created_by_member_id") REFERENCES "public"."household_members"("household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_ingredient_settings" ADD CONSTRAINT "household_ingredient_settings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_ingredient_settings" ADD CONSTRAINT "household_ingredient_settings_shopping_category_id_shopping_categories_id_fk" FOREIGN KEY ("shopping_category_id") REFERENCES "public"."shopping_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_categories" ADD CONSTRAINT "shopping_categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_category_id_shopping_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."shopping_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_list_same_household_fk" FOREIGN KEY ("household_id","shopping_list_id") REFERENCES "public"."shopping_lists"("household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_picker_same_household_fk" FOREIGN KEY ("household_id","picked_by_member_id") REFERENCES "public"."household_members"("household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_creator_same_household_fk" FOREIGN KEY ("household_id","created_by_member_id") REFERENCES "public"."household_members"("household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_same_household_fk" FOREIGN KEY ("household_id","actor_member_id") REFERENCES "public"."household_members"("household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_actor_same_household_fk" FOREIGN KEY ("household_id","actor_member_id") REFERENCES "public"."household_members"("household_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_sessions_user_idx" ON "device_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recipes_search_document_gin" ON "recipes" USING gin ("search_document");--> statement-breakpoint
CREATE INDEX "recipes_search_fold_trgm" ON "recipes" USING gin ("search_fold" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "shopping_items_list_idx" ON "shopping_items" USING btree ("shopping_list_id");--> statement-breakpoint
CREATE INDEX "shopping_lists_household_status_idx" ON "shopping_lists" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "audit_events_household_created_idx" ON "audit_events" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
-- ===== Hand-written (A04) below this line; everything above is generated by drizzle-kit. =====
-- recipe_versions rows are immutable after insert (DB §5.1, ADR-002 addendum).
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
--> statement-breakpoint
-- System-default shopping categories (FR-36). `name` is a fallback label; the web shows the i18n
-- string for system_code. `other` is the fallback category.
INSERT INTO shopping_categories (system_code, name, sort_order, is_system_default) VALUES
  ('vegetables', 'Vegetables', 10, true),
  ('fruit', 'Fruit', 20, true),
  ('dairy', 'Dairy', 30, true),
  ('meat', 'Meat', 40, true),
  ('dry_goods', 'Dry goods', 50, true),
  ('household_supplies', 'Household supplies', 60, true),
  ('other', 'Other', 1000, true);
