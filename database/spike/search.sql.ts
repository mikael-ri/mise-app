// A02 spike (ADR-010): search projection and query SQL. Lives in a scratch schema, not in database/schema/.

export const SCHEMA = 'spike_a02';

// Folding (ä/ö/å -> a/o/a, lower case) is used ONLY by the trigram/substring fallback.
// The primary tsvector is built from unfolded text so a/ä and o/ö stay distinct.
export const setupSql = `
DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;
CREATE SCHEMA ${SCHEMA};
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE FUNCTION ${SCHEMA}.fold(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT translate(lower(t), 'äöå', 'aoa') $$;

-- The service writes the three flattened columns in the same transaction as the version insert.
CREATE TABLE ${SCHEMA}.recipes (
  id text PRIMARY KEY,
  search_title text NOT NULL,
  search_ingredients text NOT NULL DEFAULT '',
  search_body text NOT NULL DEFAULT '',   -- directions + notes
  search_document tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('finnish',  search_title),       'A')
   || setweight(to_tsvector('simple',   search_title),       'A')
   || setweight(to_tsvector('finnish',  search_ingredients), 'B')
   || setweight(to_tsvector('simple',   search_ingredients), 'B')
   || setweight(to_tsvector('finnish',  search_body),        'C')
   || setweight(to_tsvector('simple',   search_body),        'C')
  ) STORED,
  search_fold text GENERATED ALWAYS AS (
    ${SCHEMA}.fold(search_title || ' ' || search_ingredients || ' ' || search_body)
  ) STORED
);
CREATE INDEX recipes_search_document_gin ON ${SCHEMA}.recipes USING gin (search_document);
CREATE INDEX recipes_search_fold_trgm ON ${SCHEMA}.recipes USING gin (search_fold gin_trgm_ops);
`;

// $1 = text[] of query words. Every word must match (AND). A word matches via the primary
// full-text index (finnish stems or simple lexemes) or as a substring of the folded text
// (compounds, ä/ö-less typing; served by the trigram index).
// Score per word: weighted ts_rank_cd (A/B/C) normalised to 0..1, plus substring bonuses by field
// so a compound hit in the title (jauhelihakeitto) beats a step mention.
export const strictSearchSql = `
WITH q AS (
  SELECT w,
         -- Substring patterns: the folded word, plus its Finnish stem when >= 5 chars. The stemmer maps
         -- porkkana -> 'pork' but porkkanaa/porkkanat -> 'porkkan'; the stem pattern bridges that.
         ARRAY(SELECT DISTINCT '%' || ${SCHEMA}.fold(x) || '%'
               FROM unnest(ARRAY[w, (tsvector_to_array(to_tsvector('finnish', w)))[1]]) AS x
               WHERE x IS NOT NULL AND (x = w OR length(x) >= 5)) AS pats,
         plainto_tsquery('finnish', w) AS fi,
         plainto_tsquery('simple', w)  AS si
  FROM unnest($1::text[]) AS w
), scored AS (
  SELECT r.id, q.w,
    greatest(ts_rank_cd('{0.02,0.1,0.3,1.0}', r.search_document, q.fi, 32),
             ts_rank_cd('{0.02,0.1,0.3,1.0}', r.search_document, q.si, 32))
      + CASE WHEN ${SCHEMA}.fold(r.search_title)       LIKE ANY (q.pats) THEN 0.6  ELSE 0 END
      + CASE WHEN ${SCHEMA}.fold(r.search_ingredients) LIKE ANY (q.pats) THEN 0.2  ELSE 0 END
      + CASE WHEN ${SCHEMA}.fold(r.search_body)        LIKE ANY (q.pats) THEN 0.05 ELSE 0 END AS score
  FROM ${SCHEMA}.recipes r CROSS JOIN q
  WHERE r.search_document @@ q.fi OR r.search_document @@ q.si OR r.search_fold LIKE ANY (q.pats)
)
SELECT id, sum(score) AS score
FROM scored
GROUP BY id
HAVING count(*) = (SELECT count(*) FROM q)
ORDER BY score DESC, id
LIMIT 20`;

// Typo tolerance via strict word similarity; callers append these after the strict results.
export const fuzzySearchSql = `
WITH q AS (SELECT w, ${SCHEMA}.fold(w) AS f FROM unnest($1::text[]) AS w)
SELECT r.id, sum(word_similarity(q.f, r.search_fold)) AS score
FROM ${SCHEMA}.recipes r CROSS JOIN q
-- The <% operator uses pg_trgm.word_similarity_threshold (default 0.6) and the index; the explicit check pins 0.6.
WHERE q.f <% r.search_fold AND word_similarity(q.f, r.search_fold) >= 0.6
GROUP BY r.id
HAVING count(*) = (SELECT count(*) FROM q)
ORDER BY score DESC, r.id
LIMIT 20`;
