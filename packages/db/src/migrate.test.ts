import { cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "./migrate";
import { TEST_DATABASE_URL, createTempDatabase, type TempDatabase } from "./test/temp-database";

const SHIPPED = fileURLToPath(new URL("../drizzle", import.meta.url));
const LEGACY = fileURLToPath(new URL("./test/legacy-migrations", import.meta.url));
// What the old runner's three files add up to; it is adopted as already applied.
const BASELINE = "20261015180735_baseline";

async function withClient<T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const tableNames = (url: string) =>
  withClient(url, async (client) => {
    const { rows } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    return rows.map((row) => row.table_name);
  });

/** What the old hand-written runner left behind: its SQL files applied and recorded by name. */
async function applyLegacyRunner(url: string, names: string[]) {
  await withClient(url, async (client) => {
    await client.query(
      "create table schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    for (const name of names) {
      await client.query(readFileSync(join(LEGACY, name), "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [name]);
    }
  });
}

/** A copy of the shipped migrations plus one that comes after them. */
function foldersWithExtraMigration(sql: string) {
  const folder = mkdtempSync(join(tmpdir(), "clippings-migrations-"));
  for (const name of readdirSync(SHIPPED)) {
    cpSync(join(SHIPPED, name), join(folder, name), { recursive: true });
  }
  const extra = "29990101000000_add_probe";
  mkdirSync(join(folder, extra));
  writeFileSync(join(folder, extra, "migration.sql"), sql);
  return { folder, extra };
}

describe.skipIf(!TEST_DATABASE_URL)("migrate", () => {
  let database: TempDatabase;

  beforeEach(async () => {
    database = await createTempDatabase();
  });

  afterEach(async () => {
    await database.drop();
  });

  it("builds the whole schema and the extensions on an empty database, once", async () => {
    const first = await migrate({ connectionString: database.url });
    const second = await migrate({ connectionString: database.url });

    expect(first).toEqual(readdirSync(SHIPPED).toSorted());
    expect(second).toEqual([]);
    expect(await tableNames(database.url)).toEqual(
      expect.arrayContaining(["user", "session", "account", "verification", "clippings"]),
    );
    const extensions = await withClient(database.url, async (client) => {
      const { rows } = await client.query<{ extname: string }>("select extname from pg_extension");
      return rows.map((row) => row.extname);
    });
    expect(extensions).toEqual(expect.arrayContaining(["pg_trgm", "vector"]));
  });

  it("adopts a database the old runner migrated: keeps its data, runs only what comes after", async () => {
    await applyLegacyRunner(database.url, [
      "0001_better_auth.sql",
      "0002_extensions.sql",
      "0003_clippings.sql",
    ]);
    await withClient(database.url, async (client) => {
      await client.query(
        `insert into "user" ("id", "name", "email", "emailVerified") values ('u1', 'U', 'u@example.com', true)`,
      );
      await client.query(
        `insert into clippings (user_id, url, url_normalized, title, source, created_at, updated_at)
         values ('u1', 'https://example.com', 'https://example.com', 'https://example.com', 'web', now(), now())`,
      );
    });
    const { folder, extra } = foldersWithExtraMigration(
      "alter table clippings add column probe text;",
    );

    const applied = await migrate({ connectionString: database.url, migrationsFolder: folder });
    const again = await migrate({ connectionString: database.url, migrationsFolder: folder });

    expect(applied).toEqual([
      ...readdirSync(SHIPPED)
        .filter((name) => name !== BASELINE)
        .toSorted(),
      extra,
    ]);
    expect(again).toEqual([]);
    await withClient(database.url, async (client) => {
      const { rows } = await client.query("select probe, title from clippings");
      expect(rows).toEqual([{ probe: null, title: "https://example.com" }]);
    });
  });

  it("refuses a database the old runner left before its last migration", async () => {
    await applyLegacyRunner(database.url, ["0001_better_auth.sql"]);

    await expect(migrate({ connectionString: database.url })).rejects.toThrow(/old runner/);
  });
});
