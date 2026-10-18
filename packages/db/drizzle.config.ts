import { defineConfig } from "drizzle-kit";

// `pnpm --filter @clippings/db generate` turns a change in src/schema.ts into a SQL migration in
// ./drizzle. `migrate` (src/migrate-cli.ts) applies them; `studio` browses DATABASE_URL.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
