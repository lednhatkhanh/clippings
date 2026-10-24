import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The repository root: the servers start from there, and `scripts/local` lives in it. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export const WEB_DIR = fileURLToPath(new URL("../../web/", import.meta.url));

/**
 * The production app's port. Not the dev server's (3100) or the local trial build's (3200), so
 * `pnpm e2e` never collides with a server a person left running. `E2E_PORT` moves it, for two runs
 * side by side.
 */
export const APP_PORT = Number(process.env.E2E_PORT ?? 3300);
export const BASE_URL = `http://localhost:${APP_PORT}`;

/** The fakes' ports (`scripts/local/fakes.mjs`): QStash, Anthropic, Voyage AI. */
export const FAKES_READY_PORT = 8082;

/** The dedicated end-to-end database: CI's service container, or the local Postgres container. */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:55432/clippings_e2e";

/**
 * The one user the extension spec signs in as. The consent page and the extension API admit only
 * allowlisted addresses, by exact match, so this address is on the app's allowlist.
 */
export const EXTENSION_USER_EMAIL = "e2e-extension@example.com";

/** The most workers a local run uses: the allowlist holds addresses for each. */
export const MAX_WORKERS = 8;

/** The most users one test creates: its own, and the others in specs about several people. */
export const USERS_PER_TEST = 4;

/**
 * The address of the `n`th user a test creates on worker `worker` (Playwright's `parallelIndex`).
 * The app checks the allowlist on every session, not only at sign-in, so the web specs' users
 * have to be on it too: each test reuses its worker's addresses, as fresh users.
 */
export function e2eUserEmail(worker: number, n: number): string {
  return `e2e-${worker}-${n}@example.com`;
}

const E2E_USER_EMAILS = Array.from({ length: MAX_WORKERS }, (_, worker) =>
  Array.from({ length: USERS_PER_TEST }, (_, n) => e2eUserEmail(worker, n)),
).flat();

/** `scripts/local/local.env`: dummy values for everything the app calls out to. */
function readLocalEnv(): Record<string, string> {
  const raw = readFileSync(new URL("../../../scripts/local/local.env", import.meta.url), "utf8");
  return Object.fromEntries(
    raw
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

const localEnv = readLocalEnv();

/** What the production app runs with: the local fakes, on the end-to-end database and port. */
export const APP_ENV: Record<string, string> = {
  ...localEnv,
  DATABASE_URL: E2E_DATABASE_URL,
  BETTER_AUTH_URL: BASE_URL,
  // `next start` reads the config again: this points it at the end-to-end build's directory.
  EXPOSE_TESTING_API: "1",
  ALLOWED_EMAILS: [localEnv.ALLOWED_EMAILS, EXTENSION_USER_EMAIL, ...E2E_USER_EMAILS]
    .filter(Boolean)
    .join(","),
};

/** The secret the app signs its session cookies with, so the fixture can sign the same way. */
export const AUTH_SECRET = APP_ENV.BETTER_AUTH_SECRET!;
