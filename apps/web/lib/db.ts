import { createDatabase, createPool } from "@clippings/db";

let pool: ReturnType<typeof createPool> | undefined;
let database: ReturnType<typeof createDatabase> | undefined;

/** One pool per server instance, on Neon's pooled URL. Lazy, so `next build` needs no secrets. */
export function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = createPool(url);
  }
  return pool;
}

/** The Drizzle client on that pool, shared by Better Auth and the Clippings service. */
export function getDatabase() {
  return (database ??= createDatabase(getPool()));
}
