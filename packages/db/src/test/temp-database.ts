import { randomUUID } from "node:crypto";

import pg from "pg";

import { migrate } from "../migrate.ts";

/**
 * A throwaway Postgres server: CI's service container, or locally
 * `docker run --rm -d -e POSTGRES_PASSWORD=postgres -p 55432:5432 pgvector/pgvector:pg18` with
 * `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres`. Without it the
 * database tests are skipped.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Names the migrated template `global-setup.ts` makes for the run, read by the test workers. */
export const TEMPLATE_DATABASE_ENV = "CLIPPINGS_TEST_TEMPLATE_DATABASE";

export type TempDatabase = {
  name: string;
  url: string;
  drop: () => Promise<void>;
};

const adminQuery = async (sql: string) => {
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(sql);
  } finally {
    await admin.end();
  }
};

/**
 * A fresh database on the test server, so tests never share state: empty, or a copy of
 * `template`, which must have no open connections.
 */
export async function createTempDatabase({
  template,
}: { template?: string } = {}): Promise<TempDatabase> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");

  const name = `clippings_test_${randomUUID().replaceAll("-", "")}`;
  await adminQuery(`create database ${name}${template ? ` template ${template}` : ""}`);

  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;

  return {
    name,
    url: url.toString(),
    drop: () => adminQuery(`drop database ${name} with (force)`),
  };
}

/**
 * A fresh database with every migration applied. Copying the run's template is a file copy,
 * much faster than migrating each one; without a template (no global setup) it migrates.
 */
export async function createMigratedDatabase(): Promise<TempDatabase> {
  const template = process.env[TEMPLATE_DATABASE_ENV];
  if (template) return createTempDatabase({ template });
  const database = await createTempDatabase();
  await migrate({ connectionString: database.url });
  return database;
}
