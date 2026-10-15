import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";

/** The Drizzle client on a `pg` pool. One pool serves the app, Better Auth and the service. */
export function createDatabase(pool: pg.Pool) {
  return drizzle({ client: pool });
}

export type Database = ReturnType<typeof createDatabase>;
