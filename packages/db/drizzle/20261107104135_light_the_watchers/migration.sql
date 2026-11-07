CREATE TABLE "library_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"confidence" text,
	"status" text DEFAULT 'applied' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "library_changes_actor_check" CHECK ("actor" in ('auto_tag', 'librarian', 'user_via_mcp')),
	CONSTRAINT "library_changes_confidence_check" CHECK ("confidence" is null or "confidence" in ('high', 'low')),
	CONSTRAINT "library_changes_status_check" CHECK ("status" in ('applied', 'suggested', 'dismissed', 'undone'))
);
--> statement-breakpoint
ALTER TABLE "clippings" ADD COLUMN "kind" text DEFAULT 'link' NOT NULL;--> statement-breakpoint
ALTER TABLE "clippings" ADD COLUMN "body" text;--> statement-breakpoint
-- Auto-tagging is on for a new user and off for every user who exists now, who keeps suggestions
-- only until they turn it on. The column is added with default false (so every existing row is
-- false), the users with no settings row get one so the code's "no row means on" never reaches
-- them, and only then the default becomes true.
ALTER TABLE "user_settings" ADD COLUMN "auto_tag" boolean DEFAULT false NOT NULL;--> statement-breakpoint
INSERT INTO "user_settings" ("user_id", "auto_tag", "updated_at") SELECT "id", false, now() FROM "user" ON CONFLICT ("user_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "auto_tag" SET DEFAULT true;--> statement-breakpoint
-- A note's body is searched like the comment on a link. Changed in place, not dropped and re-added,
-- so the previous app version keeps its `search_tsv` (and the index on it) while this runs.
ALTER TABLE "clippings" ALTER COLUMN "search_tsv" SET EXPRESSION AS (setweight(to_tsvector('simple', "clippings"."title"), 'A') || setweight(to_tsvector('simple', coalesce("clippings"."user_title", '')), 'A') || setweight(to_tsvector('simple', "clippings"."note"), 'B') || setweight(to_tsvector('simple', coalesce("clippings"."body", '')), 'B') || setweight(to_tsvector('simple', coalesce("clippings"."excerpt", '')), 'C'));--> statement-breakpoint
ALTER TABLE "clippings" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clippings" ALTER COLUMN "url_normalized" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "library_changes_user_created_idx" ON "library_changes" ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "library_changes_suggested_idx" ON "library_changes" ("user_id","created_at" DESC NULLS LAST) WHERE "status" = 'suggested';--> statement-breakpoint
CREATE INDEX "library_changes_target_ids_idx" ON "library_changes" USING gin ("target_ids");--> statement-breakpoint
ALTER TABLE "library_changes" ADD CONSTRAINT "library_changes_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "clippings" ADD CONSTRAINT "clippings_kind_check" CHECK ("kind" in ('link', 'note'));--> statement-breakpoint
ALTER TABLE "clippings" ADD CONSTRAINT "clippings_kind_shape_check" CHECK (("kind" = 'link' and "url" is not null and "url_normalized" is not null and "body" is null) or ("kind" = 'note' and "url" is null and "url_normalized" is null and "body" is not null));