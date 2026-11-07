CREATE TABLE "research_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"clipping_id" uuid NOT NULL CONSTRAINT "research_briefs_clipping_id_key" UNIQUE,
	"domain" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"mode" text DEFAULT 'batch' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"batch_id" text,
	"body" text,
	"sources" jsonb DEFAULT '[]' NOT NULL,
	"note" text,
	"source" text DEFAULT 'ai' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "research_briefs_status_check" CHECK ("status" in ('queued', 'submitted', 'writing', 'ready', 'dropped')),
	CONSTRAINT "research_briefs_mode_check" CHECK ("mode" in ('batch', 'now')),
	CONSTRAINT "research_briefs_source_check" CHECK ("source" in ('ai')),
	CONSTRAINT "research_briefs_body_check" CHECK (char_length("body") <= 40000)
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "research_profile" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "research_domains" text[] DEFAULT '{shipping,logistics}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "research_briefs_submitted_idx" ON "research_briefs" ("status","batch_id") WHERE "status" = 'submitted';--> statement-breakpoint
CREATE INDEX "research_briefs_user_status_idx" ON "research_briefs" ("user_id","status","created_at");--> statement-breakpoint
ALTER TABLE "research_briefs" ADD CONSTRAINT "research_briefs_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "research_briefs" ADD CONSTRAINT "research_briefs_clipping_fkey" FOREIGN KEY ("clipping_id","user_id") REFERENCES "clippings"("id","user_id") ON DELETE CASCADE;