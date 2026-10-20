import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The repository root: the servers start from there, and `scripts/local` lives in it. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export const WEB_DIR = fileURLToPath(new URL("../../web/", import.meta.url));

/**
 * The production app's port. Not the dev server's (3100) or the local trial build's (3200), so
 * `pnpm e2e` never collides with a server a person left running.
 */
export const APP_PORT = Number(process.env.E2E_PORT ?? 3300);
export const BASE_URL = `http://localhost:${APP_PORT}`;

/** The fakes' ports (`scripts/local/fakes.mjs`): QStash, Anthropic, Voyage AI. */
export const FAKES_READY_PORT = 8082;

/** The dedicated end-to-end database: CI's service container, or the local Postgres container. */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:55432/clippings_e2e";

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
};

/** The secret the app signs its session cookies with, so the fixture can sign the same way. */
export const AUTH_SECRET = APP_ENV.BETTER_AUTH_SECRET!;
