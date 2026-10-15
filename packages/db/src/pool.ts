import pg from "pg";

/**
 * A pool on Neon's pooled URL. The pooler is PgBouncer in transaction mode, so callers must not
 * rely on session state (`SET`, advisory locks, `LISTEN`).
 */
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 5 });
}
