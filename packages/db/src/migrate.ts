import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { MigrationConfig } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as runMigrations } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const DEFAULT_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

// Arbitrary constant; serializes concurrent runs (two deploys, a retried job).
const LOCK_ID = 7_413_902_615;

/** The migrations the hand-written runner recorded before Drizzle took over, all in `baseline`. */
const LEGACY_MIGRATIONS = ["0001_better_auth.sql", "0002_extensions.sql", "0003_clippings.sql"];

export type MigrateOptions = {
  /** Neon's direct URL. The pooler is a transaction-mode PgBouncer, which can't hold the lock. */
  connectionString: string;
  migrationsFolder?: string;
};

async function appliedNames(client: pg.Client): Promise<string[]> {
  const exists = await client.query("select to_regclass('drizzle.__drizzle_migrations') as t");
  if (!exists.rows[0]?.t) return [];
  const { rows } = await client.query<{ name: string }>(
    "select name from drizzle.__drizzle_migrations order by id",
  );
  return rows.map((row) => row.name);
}

/**
 * Databases migrated by the old runner already have the schema the first Drizzle migration (the
 * baseline) creates. Record the baseline as applied, without running it, so only what comes after
 * it runs. A no-op once Drizzle has any history of its own.
 */
async function adoptLegacyDatabase(client: pg.Client, migrationsFolder: string) {
  const legacy = await client.query("select to_regclass('public.schema_migrations') as t");
  if (!legacy.rows[0]?.t) return;

  const { rows } = await client.query<{ name: string }>("select name from schema_migrations");
  const recorded = new Set(rows.map((row) => row.name));
  const missing = LEGACY_MIGRATIONS.filter((name) => !recorded.has(name));
  if (missing.length > 0) {
    throw new Error(
      `This database was migrated by the old runner and is missing ${missing.join(", ")}. ` +
        "Run the last release that has the old runner first, then migrate again.",
    );
  }

  const [baseline] = readdirSync(migrationsFolder).toSorted();
  if (!baseline) throw new Error(`No migrations in ${migrationsFolder}`);

  // `init` is the option behind `drizzle-kit pull --init`: it marks a lone migration applied when
  // Drizzle's table is empty. It is missing from the public type, so the adoption test in
  // migrate.test.ts is what notices if a Drizzle upgrade changes it. Hand it a folder holding
  // only the baseline.
  const scratch = mkdtempSync(join(tmpdir(), "clippings-baseline-"));
  try {
    cpSync(join(migrationsFolder, baseline), join(scratch, baseline), { recursive: true });
    await runMigrations(drizzle({ client }), {
      migrationsFolder: scratch,
      init: true,
    } as MigrationConfig);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Applies the Drizzle migrations in `migrationsFolder` that haven't run yet, in one transaction,
 * and returns their names. Migrations are written expand/contract, so the previous app version
 * keeps working while they run.
 */
export async function migrate({
  connectionString,
  migrationsFolder = DEFAULT_FOLDER,
}: MigrateOptions): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_ID]);

    await adoptLegacyDatabase(client, migrationsFolder);
    const before = new Set(await appliedNames(client));
    await runMigrations(drizzle({ client }), { migrationsFolder });

    return (await appliedNames(client)).filter((name) => !before.has(name));
  } finally {
    await client.end();
  }
}
