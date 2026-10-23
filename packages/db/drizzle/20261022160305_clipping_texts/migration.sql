CREATE TABLE "clipping_texts" (
	"clipping_id" uuid PRIMARY KEY,
	"user_id" text NOT NULL,
	"text" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clipping_texts" ADD CONSTRAINT "clipping_texts_clipping_fkey" FOREIGN KEY ("clipping_id","user_id") REFERENCES "clippings"("id","user_id") ON DELETE CASCADE;