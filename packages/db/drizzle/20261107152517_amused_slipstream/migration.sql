CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"status" text NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"tag_id" uuid,
	"body" text,
	"quiz" jsonb,
	"recap" text DEFAULT '' NOT NULL,
	"source_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"skip_kind" text,
	"skip_reason" text,
	"source" text DEFAULT 'ai' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"writer_started_at" timestamp with time zone,
	CONSTRAINT "lessons_user_id_day_key" UNIQUE("user_id","day"),
	CONSTRAINT "lessons_status_check" CHECK ("status" in ('writing', 'ready', 'skipped')),
	CONSTRAINT "lessons_skip_kind_check" CHECK ("skip_kind" is null or "skip_kind" in ('cap_reached', 'nothing_to_teach', 'failed')),
	CONSTRAINT "lessons_source_check" CHECK ("source" in ('ai')),
	CONSTRAINT "lessons_body_check" CHECK (char_length("body") <= 30000),
	CONSTRAINT "lessons_recap_check" CHECK (char_length("recap") <= 3000),
	CONSTRAINT "lessons_topic_check" CHECK (char_length("topic") <= 120)
);
--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;