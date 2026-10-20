import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type BrowserContext, type Worker } from "@playwright/test";

import { createTestSession } from "@clippings/db/testing";
import { CLIPPINGS_EXTENSION_ID } from "@clippings/shared";

import { AUTH_SECRET, BASE_URL, EXTENSION_USER_EMAIL } from "./env.ts";
import { expect, signIn, test as base, type E2EUser } from "./fixtures.ts";

/** WXT's unpacked Chrome build (`pnpm e2e` builds it before Playwright starts). */
const BUILD_DIR = fileURLToPath(new URL("../../extension/.output/chrome-mv3/", import.meta.url));

/**
 * The build's manifest, checked before Chromium starts: an extension built for another origin
 * can't reach this app, and the failure would otherwise read as a sign-in that never finishes.
 */
function checkBuild() {
  const manifest = path.join(BUILD_DIR, "manifest.json");
  if (!existsSync(manifest)) {
    throw new Error(`No extension build at ${BUILD_DIR}. Run \`pnpm e2e\`, which builds it first.`);
  }
  const { host_permissions: hosts } = JSON.parse(readFileSync(manifest, "utf8")) as {
    host_permissions?: string[];
  };
  if (!hosts?.includes(`${BASE_URL}/*`)) {
    throw new Error(
      `The extension was built for ${hosts?.join(", ")}, not ${BASE_URL}. Rebuild it with CLIPPINGS_ORIGIN=${BASE_URL}.`,
    );
  }
}

interface ExtensionFixtures {
  /** The extension's id, read from its service worker. */
  extensionId: string;
  /** The extension's service worker: `evaluate` runs in the extension with `chrome.*`. */
  serviceWorker: Worker;
}

/**
 * Specs that run the built extension. The test's browser context is a persistent one with the
 * extension loaded: extensions need a persistent context, and the `chromium` channel is the new
 * headless mode, which runs them without a window.
 */
export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    checkBuild();
    const userDataDir = mkdtempSync(path.join(tmpdir(), "clippings-e2e-extension-"));
    const context: BrowserContext = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      args: [`--disable-extensions-except=${BUILD_DIR}`, `--load-extension=${BUILD_DIR}`],
    });
    await use(context);
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },

  serviceWorker: async ({ context }, use) => {
    const [existing] = context.serviceWorkers();
    await use(existing ?? (await context.waitForEvent("serviceworker")));
  },

  // The allowlisted address (`EXTENSION_USER_EMAIL`) as a fresh user: the last run's is deleted,
  // with its clippings and OAuth grants, so the spec starts from nothing.
  user: async ({ database, context }, use) => {
    await database.query(`delete from "user" where email = $1`, [EXTENSION_USER_EMAIL]);
    const id = `e2e-extension-${randomUUID().slice(0, 8)}`;
    const { cookieValue } = await createTestSession({
      db: database,
      secret: AUTH_SECRET,
      user: { id, name: id, email: EXTENSION_USER_EMAIL },
    });
    const user: E2EUser = { id, email: EXTENSION_USER_EMAIL, cookieValue };
    await signIn(context, user);
    await use(user);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const id = new URL(serviceWorker.url()).host;
    // The manifest key pins the id, which the web app trusts without any `EXTENSION_IDS`.
    expect(id).toBe(CLIPPINGS_EXTENSION_ID);
    await use(id);
  },
});

export { expect };
