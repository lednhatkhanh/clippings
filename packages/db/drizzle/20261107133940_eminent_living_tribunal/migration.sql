CREATE TABLE "research_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"brief_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_usage" ADD COLUMN "request_key" text;--> statement-breakpoint
ALTER TABLE "research_briefs" ADD COLUMN "writer_started_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "model_usage_request_key_uidx" ON "model_usage" ("request_key") WHERE "request_key" is not null;--> statement-breakpoint
CREATE INDEX "research_submissions_user_submitted_idx" ON "research_submissions" ("user_id","submitted_at");--> statement-breakpoint
CREATE INDEX "research_submissions_brief_idx" ON "research_submissions" ("brief_id");--> statement-breakpoint
ALTER TABLE "research_submissions" ADD CONSTRAINT "research_submissions_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "research_submissions" ADD CONSTRAINT "research_submissions_brief_id_research_briefs_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "research_briefs"("id") ON DELETE CASCADE;--> statement-breakpoint
-- The limit used to count research_briefs.submitted_at; carry each brief's last submission over so
-- today's count is the same after the deploy.
INSERT INTO "research_submissions" ("user_id", "brief_id", "submitted_at")
SELECT "user_id", "id", "submitted_at" FROM "research_briefs" WHERE "submitted_at" IS NOT NULL;
