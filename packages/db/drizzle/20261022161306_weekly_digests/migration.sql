CREATE TABLE "weekly_digests" (
	"user_id" text,
	"week_start" date,
	"digest" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "weekly_digests_pkey" PRIMARY KEY("user_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "weekly_digests" ADD CONSTRAINT "weekly_digests_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;