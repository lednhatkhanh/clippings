ALTER TABLE "clippings" ADD COLUMN "link_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clippings" ADD COLUMN "link_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clippings" ADD COLUMN "link_dead_since" timestamp with time zone;