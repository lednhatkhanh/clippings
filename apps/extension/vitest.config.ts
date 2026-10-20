import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  // The extension's `browser` becomes WXT's in-memory fake, reset between tests.
  plugins: [WxtVitest()],
  test: {
    // See packages/shared/vitest.config.ts: Turbo starts every package's Vitest at once.
    fsModuleCache: false,
    // Fixed at build time in the extension (`wxt.config.ts`): the tests' Clippings.
    env: { CLIPPINGS_ORIGIN: "http://localhost:3100" },
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".output/**", ".wxt/**"],
  },
});
