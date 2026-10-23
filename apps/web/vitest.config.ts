import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // The `@/` alias from tsconfig.json.
  resolve: { tsconfigPaths: true },
  test: {
    // Every package's Vitest shares one module cache in the root node_modules and clears it on
    // start after a lockfile change. Turbo starts them together, so one clear can hit another's
    // writes and fail the run (ENOTEMPTY) before any test runs.
    fsModuleCache: false,
    // One migrated template per run, copied for each database test.
    globalSetup: [fileURLToPath(import.meta.resolve("@clippings/db/test-global-setup"))],
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
  },
});
