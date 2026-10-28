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
	CONSTRAINT "recipe_versions_recipe_id_id_uq" UNIQUE("recipe_id","id")
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"current_version_id" uuid,
	"title" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"archived_at" timestamp with time zone,
	"search_text" text DEFAULT '' NOT NULL,
	"search_document" "tsvector" GENERATED ALWAYS AS (to_tsvector('finnish'::regconfig, search_text)) STORED,
	"revision" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_current_version_same_recipe_fk" FOREIGN KEY ("id","current_version_id") REFERENCES "public"."recipe_versions"("recipe_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipes_search_document_gin" ON "recipes" USING gin ("search_document");--> statement-breakpoint
CREATE INDEX "recipes_search_text_trgm" ON "recipes" USING gin ("search_text" gin_trgm_ops);