import { defineConfig } from "drizzle-kit";

// Used by `pnpm --filter @clippings/db studio`. Migrations are the hand-written SQL files in
// ./migrations, applied by `src/migrate.ts`, so `out` is scratch space nobody commits.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./.drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  // Better Auth's tables are not in the schema file; keep Studio to ours.
  tablesFilter: ["clippings"],
});
