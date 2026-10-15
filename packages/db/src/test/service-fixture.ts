import pg from "pg";

import { createClippingsService, type Clock, type JobPublisher } from "../clippings/service";
import { migrate } from "../migrate";
import { createPool } from "../pool";
import { createTempDatabase, type TempDatabase } from "./temp-database";

/**
 * A migrated, throwaway database with the Clippings service on top and in-memory ports: a clock
 * the test moves by hand and a publisher that records what it was asked to enrich.
 */
export async function createServiceFixture() {
  const database: TempDatabase = await createTempDatabase();
  await migrate({ connectionString: database.url });
  const pool: pg.Pool = createPool(database.url);

  let now = new Date("2026-10-01T09:00:00.000Z");
  const clock: Clock = { now: () => now };
  const enrichmentRequests: string[] = [];
  const jobs: JobPublisher = {
    requestEnrichment: async (clippingId) => {
      enrichmentRequests.push(clippingId);
    },
  };

  return {
    service: createClippingsService({ pool, jobs, clock }),
    enrichmentRequests,
    /** Moves the clock forward; every save is stamped with the clock's current time. */
    advanceClock: (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds);
    },
    /** Inserts a row in Better Auth's `user` table and returns its id. */
    createUser: async (id: string) => {
      await pool.query(
        `insert into "user" ("id", "name", "email", "emailVerified") values ($1, $1, $2, true)`,
        [id, `${id}@example.com`],
      );
      return id;
    },
    close: async () => {
      await pool.end();
      await database.drop();
    },
  };
}

export type ServiceFixture = Awaited<ReturnType<typeof createServiceFixture>>;
