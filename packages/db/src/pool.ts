import pg from "pg";

/**
 * A pool on Neon's pooled URL. The pooler is PgBouncer in transaction mode, so callers must not
 * rely on session state (`SET`, advisory locks, `LISTEN`).
 *
 * An idle connection the server closes (Neon scaling to zero, a restart, a dropped test database)
 * makes the pool emit `error`. Without a listener that crashes the process; with one the pool just
 * drops the connection and opens a new one on the next query.
 */
export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 5 });
  pool.on("error", (error) => console.error("An idle database connection closed", error));
  return pool;
}
