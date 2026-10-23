ALTER TABLE "clipping_texts" ADD COLUMN "origin" text DEFAULT 'fetch' NOT NULL;--> statement-breakpoint
ALTER TABLE "clipping_texts" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "clipping_texts" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clipping_texts" ADD CONSTRAINT "clipping_texts_origin_check" CHECK ("origin" in ('fetch', 'browser'));