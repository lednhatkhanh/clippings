import { getTableColumns } from "drizzle-orm";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "./migrate";
import { clippings } from "./schema";
import { TEST_DATABASE_URL, createTempDatabase, type TempDatabase } from "./test/temp-database";

interface ColumnShape {
  name: string;
  notNull: boolean;
}

async function migratedColumns(url: string, table: string): Promise<ColumnShape[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ column_name: string; is_nullable: "YES" | "NO" }>(
      `select column_name, is_nullable from information_schema.columns
       where table_schema = 'public' and table_name = $1`,
      [table],
    );
    return rows.map((row) => ({ name: row.column_name, notNull: row.is_nullable === "NO" }));
  } finally {
    await client.end();
  }
}

const byName = (a: ColumnShape, b: ColumnShape) => a.name.localeCompare(b.name);

// The schema is written by hand beside the SQL migrations. This is what stops them drifting.
describe.skipIf(!TEST_DATABASE_URL)("Drizzle schema", () => {
  let database: TempDatabase;

  beforeEach(async () => {
    database = await createTempDatabase();
    await migrate({ connectionString: database.url });
  });

  afterEach(async () => {
    await database.drop();
  });

  it("declares the clippings table the migrations create", async () => {
    const declared = Object.values(getTableColumns(clippings)).map((column): ColumnShape => ({
      name: column.name,
      notNull: column.notNull,
    }));

    const actual = await migratedColumns(database.url, "clippings");

    expect(declared.toSorted(byName)).toEqual(actual.toSorted(byName));
  });
});
