import pg from "pg";

/** How long a query may run before the pool gives up on it (client side; see `createPool`). */
const QUERY_TIMEOUT_MS = 15_000;
/** How long a caller waits for a connection, a new one or a free one, before the pool errors. */
const CONNECTION_TIMEOUT_MS = 5_000;

/**
 * A pool on Neon's pooled URL. The pooler is PgBouncer in transaction mode, so callers must not
 * rely on session state (`SET`, `LISTEN`, session-level advisory locks). Transaction-scoped
 * advisory locks (`pg_advisory_xact_lock`) are fine: they live and die with the transaction.
 *
 * An idle connection the server closes (Neon scaling to zero, a restart, a dropped test database)
 * makes the pool emit `error`. Without a listener that crashes the process; with one the pool just
 * drops the connection and opens a new one on the next query.
 *
 * Ten connections, not five: a page runs several queries at once (`Promise.all`), and Neon's
 * pooler multiplexes them onto far fewer server connections, so a wider pool costs nothing there.
 *
 * Timeouts keep a stalled database from holding a serverless function until Vercel kills it:
 * `connectionTimeoutMillis` for getting a connection, and `query_timeout` for each query. The
 * query timeout is the client's, not Postgres's `statement_timeout`: PgBouncer refuses a
 * connection that sends `statement_timeout` or `idle_in_transaction_session_timeout` as a startup
 * parameter ("unsupported startup parameter"). A query that times out destroys its connection,
 * which makes the server stop it. Neon already ends a session idle in a transaction after 5 minutes.
 * The migration runner opens its own client, so none of this applies to it.
 */
export function createPool(
  connectionString: string,
  { queryTimeoutMs = QUERY_TIMEOUT_MS }: { queryTimeoutMs?: number } = {},
): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: queryTimeoutMs,
  });
  pool.on("error", (error) => console.error("An idle database connection closed", error));
  return pool;
}
