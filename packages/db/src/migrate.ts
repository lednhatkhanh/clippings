import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import pg from "pg";

const DEFAULT_DIRECTORY = fileURLToPath(new URL("../migrations", import.meta.url));

// Arbitrary constant; serializes concurrent runs (two deploys, a retried job).
const LOCK_ID = 7_413_902_615;

export type MigrateOptions = {
  /** Neon's direct URL. The pooler is a transaction-mode PgBouncer, which can't hold the lock. */
  connectionString: string;
  directory?: string;
};

/**
 * Applies the `*.sql` files in `directory` that haven't run yet, in filename order, each in its
 * own transaction. Returns the names it applied. Migrations are written expand/contract, so the
 * previous app version keeps working while they run.
 */
export async function migrate({
  connectionString,
  directory = DEFAULT_DIRECTORY,
}: MigrateOptions): Promise<string[]> {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(
      `create table if not exists schema_migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`,
    );

    const { rows } = await client.query<{ name: string }>("select name from schema_migrations");
    const appliedNames = new Set(rows.map((row) => row.name));

    const applied: string[] = [];
    for (const name of files) {
      if (appliedNames.has(name)) continue;

      const sql = await readFile(`${directory}/${name}`, "utf8");
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [name]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${name} failed: ${(error as Error).message}`, { cause: error });
      }
      applied.push(name);
    }
    return applied;
  } finally {
    await client.end();
  }
}
