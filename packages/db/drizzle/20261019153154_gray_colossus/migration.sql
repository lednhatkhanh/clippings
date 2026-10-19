CREATE TABLE "clipping_tags" (
	"clipping_id" uuid,
	"tag_id" uuid,
	"user_id" text NOT NULL,
	CONSTRAINT "clipping_tags_pkey" PRIMARY KEY("clipping_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tags_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "tags_color_check" CHECK ("color" in ('none', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'))
);
--> statement-breakpoint
ALTER TABLE "clippings" ADD CONSTRAINT "clippings_id_user_id_key" UNIQUE("id","user_id");--> statement-breakpoint
CREATE INDEX "clipping_tags_tag_id_idx" ON "clipping_tags" ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_id_name_key" ON "tags" ("user_id",lower("name"));--> statement-breakpoint
ALTER TABLE "clipping_tags" ADD CONSTRAINT "clipping_tags_clipping_fkey" FOREIGN KEY ("clipping_id","user_id") REFERENCES "clippings"("id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "clipping_tags" ADD CONSTRAINT "clipping_tags_tag_fkey" FOREIGN KEY ("tag_id","user_id") REFERENCES "tags"("id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;