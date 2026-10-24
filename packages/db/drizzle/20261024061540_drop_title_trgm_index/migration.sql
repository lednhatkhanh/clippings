-- The previous app version typo-matched on "title"; v2 reads the shown title through
-- "clippings_shown_title_trgm_idx", and v2 is on production.
DROP INDEX IF EXISTS "clippings_title_trgm_idx";
