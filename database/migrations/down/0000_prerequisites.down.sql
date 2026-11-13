-- Local/scratch rollback only; production is roll-forward (hard rule 6).
DROP FUNCTION IF EXISTS fold(text);
DROP EXTENSION IF EXISTS pg_trgm;
