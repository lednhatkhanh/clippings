CREATE TABLE "clipping_tag_suggestions" (
	"clipping_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"origin" text NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "clipping_tag_suggestions_origin_check" CHECK ("origin" in ('model', 'neighbours'))
);
--> statement-breakpoint
ALTER TABLE "clippings" ADD COLUMN "user_title" text;--> statement-breakpoint
ALTER TABLE "clippings" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "suggest_tags" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Both titles weigh A. Changed in place, not dropped and re-added, so the previous app version
-- keeps its `search_tsv` (and the index on it) while this runs; Postgres rewrites the column.
ALTER TABLE "clippings" ALTER COLUMN "search_tsv" SET EXPRESSION AS (setweight(to_tsvector('simple', "clippings"."title"), 'A') || setweight(to_tsvector('simple', coalesce("clippings"."user_title", '')), 'A') || setweight(to_tsvector('simple', "clippings"."note"), 'B') || setweight(to_tsvector('simple', coalesce("clippings"."excerpt", '')), 'C'));--> statement-breakpoint
ANALYZE "clippings";--> statement-breakpoint
CREATE UNIQUE INDEX "clipping_tag_suggestions_name_key" ON "clipping_tag_suggestions" ("clipping_id",lower("name"));--> statement-breakpoint
-- Beside "clippings_title_trgm_idx", which stays for the previous app version's typo match (and a
-- rollback to it). The next release drops it, once nothing reads it.
CREATE INDEX "clippings_shown_title_trgm_idx" ON "clippings" USING gin (coalesce("user_title", "title") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clippings_user_pinned_idx" ON "clippings" ("user_id","pinned_at" DESC NULLS LAST) WHERE "pinned_at" is not null and "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "clippings_pending_imports_idx" ON "clippings" ("status_changed_at","created_at") WHERE "source" = 'import' and "status" = 'pending' and "deleted_at" is null;--> statement-breakpoint
ALTER TABLE "clipping_tag_suggestions" ADD CONSTRAINT "clipping_tag_suggestions_clipping_fkey" FOREIGN KEY ("clipping_id","user_id") REFERENCES "clippings"("id","user_id") ON DELETE CASCADE;--> statement-breakpoint
-- Widened only: the previous app version never writes 'import'.
ALTER TABLE "clippings" DROP CONSTRAINT "clippings_source_check", ADD CONSTRAINT "clippings_source_check" CHECK ("source" in ('web', 'extension', 'mcp', 'digest', 'import'));
