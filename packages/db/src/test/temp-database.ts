import { randomUUID } from "node:crypto";

import pg from "pg";

/**
 * A throwaway Postgres server: CI's service container, or locally
 * `docker run --rm -d -e POSTGRES_PASSWORD=postgres -p 55432:5432 pgvector/pgvector:pg18` with
 * `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres`. Without it the
 * database tests are skipped.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export type TempDatabase = {
  url: string;
  drop: () => Promise<void>;
};

/** A fresh, empty database on the test server, so tests never share migration state. */
export async function createTempDatabase(): Promise<TempDatabase> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");

  const name = `clippings_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;

  return {
    url: url.toString(),
    drop: async () => {
      const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await client.connect();
      await client.query(`drop database ${name} with (force)`);
      await client.end();
    },
  };
}
