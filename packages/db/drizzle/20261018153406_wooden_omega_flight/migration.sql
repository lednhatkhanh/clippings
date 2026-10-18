CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY,
	"theme" text DEFAULT 'system' NOT NULL,
	"palette" text DEFAULT 'olive' NOT NULL,
	"contrast" text DEFAULT 'system' NOT NULL,
	"density" text DEFAULT 'comfortable' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_settings_theme_check" CHECK ("theme" in ('system', 'light', 'dark')),
	CONSTRAINT "user_settings_palette_check" CHECK ("palette" in ('olive', 'ochre', 'terracotta', 'ink')),
	CONSTRAINT "user_settings_contrast_check" CHECK ("contrast" in ('system', 'standard', 'medium', 'high')),
	CONSTRAINT "user_settings_density_check" CHECK ("density" in ('comfortable', 'compact'))
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;