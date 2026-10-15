import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "./migrate";
import { TEST_DATABASE_URL, createTempDatabase, type TempDatabase } from "./test/temp-database";

async function migrationsDir(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "clippings-migrations-"));
  for (const [name, sql] of Object.entries(files)) await writeFile(join(dir, name), sql);
  return dir;
}

async function tableNames(url: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' order by 1",
  );
  await client.end();
  return rows.map((row) => row.table_name);
}

describe.skipIf(!TEST_DATABASE_URL)("migrate", () => {
  let database: TempDatabase;

  beforeEach(async () => {
    database = await createTempDatabase();
  });

  afterEach(async () => {
    await database.drop();
  });

  it("applies migrations in filename order and records them", async () => {
    const directory = await migrationsDir({
      "0002_b.sql": "create table b (id int primary key);",
      "0001_a.sql": "create table a (id int primary key);",
    });

    const applied = await migrate({ connectionString: database.url, directory });

    expect(applied).toEqual(["0001_a.sql", "0002_b.sql"]);
    expect(await tableNames(database.url)).toEqual(
      expect.arrayContaining(["a", "b", "schema_migrations"]),
    );
  });

  it("applies only the migrations that have not run yet", async () => {
    const directory = await migrationsDir({ "0001_a.sql": "create table a (id int primary key);" });
    await migrate({ connectionString: database.url, directory });
    await writeFile(join(directory, "0002_b.sql"), "create table b (id int primary key);");

    const applied = await migrate({ connectionString: database.url, directory });

    expect(applied).toEqual(["0002_b.sql"]);
  });

  it("rolls back a failing migration and leaves it unrecorded", async () => {
    const directory = await migrationsDir({
      "0001_a.sql": "create table a (id int primary key);",
      "0002_bad.sql": "create table c (id int primary key); select * from missing_table;",
    });

    await expect(migrate({ connectionString: database.url, directory })).rejects.toThrow(
      /0002_bad\.sql/,
    );

    const tables = await tableNames(database.url);
    expect(tables).toContain("a");
    expect(tables).not.toContain("c");

    await writeFile(join(directory, "0002_bad.sql"), "create table c (id int primary key);");
    expect(await migrate({ connectionString: database.url, directory })).toEqual(["0002_bad.sql"]);
  });

  it("creates the Better Auth tables with the shipped migrations", async () => {
    await migrate({ connectionString: database.url });

    expect(await tableNames(database.url)).toEqual(
      expect.arrayContaining(["user", "session", "account", "verification"]),
    );
  });
});
