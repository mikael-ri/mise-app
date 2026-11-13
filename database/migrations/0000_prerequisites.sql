-- Hand-written (A04). Must precede 0001: the trigram index uses gin_trgm_ops and the generated
-- recipes.search_fold column calls fold().
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
-- ADR-010 addendum (A02): folding (ä/ö/å -> a/o/a, lower case) is used ONLY by the substring/trigram
-- fallback. The primary tsvector is built from unfolded text so a/ä and o/ö stay distinct.
CREATE FUNCTION fold(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT translate(lower(t), 'äöå', 'aoa') $$;
