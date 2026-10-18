import pg from "pg";

import type { Clock, JobPublisher, PageFetcher, PageSummary, Summarizer } from "../clippings/ports";
import { createClippingsService } from "../clippings/service";
import { migrate } from "../migrate";
import { createPool } from "../pool";
import { createTempDatabase, type TempDatabase } from "./temp-database";

/**
 * A migrated, throwaway database with the Clippings service on top and in-memory ports: a clock
 * the test moves by hand, a publisher that records what it was asked to enrich, and a fetcher and
 * summarizer that answer from `web`, which maps a URL to what reading it yields.
 */
export async function createServiceFixture() {
  const database: TempDatabase = await createTempDatabase();
  await migrate({ connectionString: database.url });
  const pool: pg.Pool = createPool(database.url);

  let now = new Date("2026-10-01T09:00:00.000Z");
  const clock: Clock = { now: () => now };
  const enrichmentRequests: string[] = [];
  let publishing: "up" | "down" = "up";
  const jobs: JobPublisher = {
    requestEnrichment: async (clippingId) => {
      if (publishing === "down") throw new Error("the queue is unreachable");
      enrichmentRequests.push(clippingId);
    },
  };

  /** What reading each URL yields: a page and what the summarizer makes of it, or a failure. */
  const web = new Map<
    string,
    { page: { title: string | null; text: string }; summary: PageSummary } | { error: Error }
  >();
  const fetcher: PageFetcher = {
    fetchPage: async (url) => {
      const entry = web.get(url);
      if (!entry) throw new Error(`Nothing at ${url}`);
      if ("error" in entry) throw entry.error;
      return entry.page;
    },
  };
  const summarizer: Summarizer = {
    summarize: async ({ url }) => {
      const entry = web.get(url);
      if (!entry || "error" in entry) throw new Error(`Nothing to summarize at ${url}`);
      return entry.summary;
    },
  };

  return {
    service: createClippingsService({ pool, jobs, clock, fetcher, summarizer }),
    web,
    enrichmentRequests,
    /** Makes the publisher throw (or work again), the way an unreachable queue does. */
    setPublishing: (state: "up" | "down") => {
      publishing = state;
    },
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
