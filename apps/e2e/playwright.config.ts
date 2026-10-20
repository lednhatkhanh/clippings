import { defineConfig, devices } from "@playwright/test";

import {
  APP_ENV,
  APP_PORT,
  BASE_URL,
  FAKES_READY_PORT,
  REPO_ROOT,
  WEB_DIR,
} from "./support/env.ts";

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  // Every test signs in as a fresh user, so tests never depend on each other.
  fullyParallel: true,
  forbidOnly: ci,
  workers: ci ? 1 : undefined,
  retries: ci ? 1 : 0,
  // Under the CI job's 20 minute limit, so a hung run still uploads its report.
  globalTimeout: ci ? 15 * 60_000 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: ci
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    // Only a spec that needs the service worker turns it on.
    serviceWorkers: "block",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "**/extension/**",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // The built extension in its own persistent context (`support/extension.ts`), so its specs
      // live apart in `specs/extension/` and the web specs never see its browser.
      name: "extension",
      testMatch: "**/extension/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      // QStash (signed deliveries and retries), Anthropic and Voyage AI: no test calls a paid service.
      command: "node scripts/local/fakes.mjs",
      cwd: REPO_ROOT,
      port: FAKES_READY_PORT,
      reuseExistingServer: !ci,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
    {
      // The production build, made beforehand (`pnpm e2e` builds it through Turborepo). Started
      // without pnpm in between, so stopping it needs no wrapper to forward the signal.
      command: `node node_modules/next/dist/bin/next start --port ${APP_PORT}`,
      cwd: WEB_DIR,
      env: APP_ENV,
      url: `${BASE_URL}/api/health`,
      reuseExistingServer: !ci,
      timeout: 60_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    },
  ],
});
