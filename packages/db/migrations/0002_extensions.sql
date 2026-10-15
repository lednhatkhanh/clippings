-- Extensions the clippings features build on: trigram matching for search, pgvector for
-- related clippings. Both ship with Neon.
create extension if not exists pg_trgm;
create extension if not exists vector;
