import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every package's Vitest shares one module cache in the root node_modules and clears it on
    // start after a lockfile change. Turbo starts them together, so one clear can hit another's
    // writes and fail the run (ENOTEMPTY) before any test runs.
    fsModuleCache: false,
    include: ["src/**/*.test.ts"],
  },
});
