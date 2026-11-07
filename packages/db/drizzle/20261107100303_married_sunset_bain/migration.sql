CREATE TABLE "model_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"job_kind" text NOT NULL,
	"model" text NOT NULL,
	"batch" boolean DEFAULT false NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"web_searches" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "model_usage_cost_check" CHECK ("cost_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "daily_cap_micros" integer DEFAULT 3000000 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "research_jobs_per_day" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
CREATE INDEX "model_usage_user_created_idx" ON "model_usage" ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "model_usage" ADD CONSTRAINT "model_usage_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_daily_cap_check" CHECK ("daily_cap_micros" >= 0);--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_research_jobs_check" CHECK ("research_jobs_per_day" >= 0);