CREATE TABLE "rateLimit" (
	"id" text PRIMARY KEY,
	"key" text NOT NULL CONSTRAINT "rateLimit_key_key" UNIQUE,
	"count" integer NOT NULL,
	"lastRequest" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clippings" ADD COLUMN "sweep_attempts" integer DEFAULT 0 NOT NULL;