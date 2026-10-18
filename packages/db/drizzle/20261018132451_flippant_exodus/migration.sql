ALTER TABLE "clippings" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "clippings" ADD COLUMN "excerpt" text;--> statement-breakpoint
ALTER TABLE "clippings" ADD COLUMN "status_changed_at" timestamp with time zone DEFAULT now() NOT NULL;