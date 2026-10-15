import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    server: {
      deps: {
        // 0.4.0 ships ESM imports without `.js` extensions, which plain Node can't resolve.
        inline: ["@material/material-color-utilities"],
      },
    },
  },
});
