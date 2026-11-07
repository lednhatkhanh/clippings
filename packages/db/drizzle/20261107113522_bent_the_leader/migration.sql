CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "folders_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "folders_color_check" CHECK ("color" in ('none', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink')),
	CONSTRAINT "folders_name_check" CHECK (char_length("name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "item_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "item_links_no_self_check" CHECK ("from_id" <> "to_id"),
	CONSTRAINT "item_links_created_by_check" CHECK ("created_by" in ('librarian', 'user_via_mcp', 'user')),
	CONSTRAINT "item_links_reason_check" CHECK (char_length("reason") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "topic_pages" (
	"tag_id" uuid PRIMARY KEY,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"source" text DEFAULT 'ai' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "topic_pages_source_check" CHECK ("source" in ('ai')),
	CONSTRAINT "topic_pages_body_check" CHECK (char_length("body") <= 8000)
);
--> statement-breakpoint
ALTER TABLE "clippings" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "library_changes" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "color_overridden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "tags" SET "color_overridden" = true WHERE "color" <> 'none';--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
CREATE INDEX "clippings_folder_idx" ON "clippings" ("folder_id") WHERE "folder_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "folders_user_id_name_key" ON "folders" ("user_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "item_links_user_pair_key" ON "item_links" ("user_id",least("from_id", "to_id"),greatest("from_id", "to_id"));--> statement-breakpoint
CREATE INDEX "item_links_from_idx" ON "item_links" ("from_id");--> statement-breakpoint
CREATE INDEX "item_links_to_idx" ON "item_links" ("to_id");--> statement-breakpoint
CREATE INDEX "tags_folder_idx" ON "tags" ("folder_id") WHERE "folder_id" is not null;--> statement-breakpoint
ALTER TABLE "clippings" ADD CONSTRAINT "clippings_folder_fkey" FOREIGN KEY ("folder_id","user_id") REFERENCES "folders"("id","user_id") ON DELETE SET NULL ("folder_id");--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "item_links" ADD CONSTRAINT "item_links_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "item_links" ADD CONSTRAINT "item_links_from_fkey" FOREIGN KEY ("from_id","user_id") REFERENCES "clippings"("id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "item_links" ADD CONSTRAINT "item_links_to_fkey" FOREIGN KEY ("to_id","user_id") REFERENCES "clippings"("id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_folder_fkey" FOREIGN KEY ("folder_id","user_id") REFERENCES "folders"("id","user_id") ON DELETE SET NULL ("folder_id");--> statement-breakpoint
ALTER TABLE "topic_pages" ADD CONSTRAINT "topic_pages_tag_fkey" FOREIGN KEY ("tag_id","user_id") REFERENCES "tags"("id","user_id") ON DELETE CASCADE;