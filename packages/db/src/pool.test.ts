import { describe, expect, it, vi } from "vitest";

import { createPool } from "./pool.ts";
import { createTempDatabase, TEST_DATABASE_URL } from "./test/temp-database.ts";

describe.skipIf(!TEST_DATABASE_URL)("createPool", () => {
  it("survives the server closing an idle connection", async () => {
    const database = await createTempDatabase();
    const pool = createPool(database.url);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await pool.query("select 1");

    // `with (force)` terminates the pool's idle connection, as a server restart would.
    await database.drop();
    await vi.waitFor(() => expect(logged).toHaveBeenCalled());

    logged.mockRestore();
    await pool.end();
  });

  it("gives up on a query that runs past the timeout, and keeps serving", async () => {
    const database = await createTempDatabase();
    const pool = createPool(database.url, { queryTimeoutMs: 200 });

    await expect(pool.query("select pg_sleep(3)")).rejects.toThrow(/timeout/i);
    expect((await pool.query("select 1 as one")).rows).toEqual([{ one: 1 }]);

    await pool.end();
    await database.drop();
  });
});
