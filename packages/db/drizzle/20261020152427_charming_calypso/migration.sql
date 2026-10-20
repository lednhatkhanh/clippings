CREATE TABLE "oauth_connections" (
	"user_id" text,
	"client_id" text,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "oauth_connections_pkey" PRIMARY KEY("user_id","client_id")
);
--> statement-breakpoint
CREATE INDEX "oauth_connections_client_id_idx" ON "oauth_connections" ("client_id");--> statement-breakpoint
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_client_id_oauthClient_clientId_fkey" FOREIGN KEY ("client_id") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE;