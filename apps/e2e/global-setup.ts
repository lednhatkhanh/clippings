import { execFile } from "node:child_process";
import { promisify } from "node:util";

import pg from "pg";

import { E2E_DATABASE_URL, REPO_ROOT } from "./support/env.ts";

const run = promisify(execFile);

/** Creates the end-to-end database on its server when it isn't there yet. */
async function ensureDatabase(url: string) {
  const target = new URL(url);
  const name = target.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Unsupported database name "${name}"`);

  const admin = new pg.Client({ connectionString: new URL("/postgres", target).href });
  await admin.connect();
  try {
    const found = await admin.query("select 1 from pg_database where datname = $1", [name]);
    if (found.rowCount === 0) await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }
}

/** Creates the end-to-end database if needed and brings it to the latest migration. */
export default async function globalSetup() {
  await ensureDatabase(E2E_DATABASE_URL);
  // The deploy's own migration CLI, so the suite runs on the schema a release would.
  await run("pnpm", ["--filter", "@clippings/db", "migrate"], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL_DIRECT: E2E_DATABASE_URL },
  });
}
