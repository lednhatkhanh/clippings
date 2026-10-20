import { addMilliseconds, parseISO } from "date-fns";
import pg from "pg";

import type {
  Clock,
  Embedder,
  EmbeddingPurpose,
  JobPublisher,
  PageFetcher,
  PageSummary,
  Summarizer,
} from "../clippings/ports.ts";
import { createClippingsService } from "../clippings/service.ts";
import { createConnectionsService } from "../connections/service.ts";
import { migrate } from "../migrate.ts";
import { createPool } from "../pool.ts";
import { EMBEDDING_DIMENSIONS } from "../schema.ts";
import { createSettingsService } from "../settings/service.ts";
import { createTempDatabase, type TempDatabase } from "./temp-database.ts";

/**
 * A migrated, throwaway database with the Clippings service on top and in-memory ports: a clock
 * the test moves by hand, a publisher that records what it was asked to enrich, and a fetcher and
 * summarizer that answer from `web`, which maps a URL to what reading it yields, and an embedder
 * that knows what words mean only from `meanings`.
 */
export async function createServiceFixture() {
  const database: TempDatabase = await createTempDatabase();
  await migrate({ connectionString: database.url });
  const pool: pg.Pool = createPool(database.url);

  let now = parseISO("2026-10-01T09:00:00.000Z");
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

  /** Word → the meaning it carries. Words that share a meaning embed close together. */
  const meanings = new Map<string, string>();
  const embedded: { text: string; purpose: EmbeddingPurpose }[] = [];
  let embedding: "up" | "down" = "up";
  const embedder: Embedder = {
    embed: async (text, purpose) => {
      if (embedding === "down") throw new Error("the embedder is unreachable");
      embedded.push({ text, purpose });
      return fakeEmbedding(text, meanings, embedded.length);
    },
  };

  return {
    /** The throwaway database's URL, for code that opens its own pool (Better Auth in web tests). */
    databaseUrl: database.url,
    service: createClippingsService({ pool, jobs, clock, fetcher, summarizer, embedder }),
    settings: createSettingsService({ pool, clock }),
    connections: createConnectionsService({ pool, clock }),
    /** The fixture's pool, for tests that set up rows no service writes (Better Auth's). */
    pool,
    web,
    enrichmentRequests,
    /** Makes the publisher throw (or work again), the way an unreachable queue does. */
    setPublishing: (state: "up" | "down") => {
      publishing = state;
    },
    meanings,
    /** Every text the embedder was asked for, in order. */
    embedded,
    /** Makes the embedder throw (or work again), the way an unreachable provider does. */
    setEmbedding: (state: "up" | "down") => {
      embedding = state;
    },
    /** Moves the clock forward; every save is stamped with the clock's current time. */
    advanceClock: (milliseconds: number) => {
      now = addMilliseconds(now, milliseconds);
    },
    /** Inserts a row in Better Auth's `user` table and returns its id. */
    createUser: async (id: string) => {
      await pool.query(
        `insert into "user" ("id", "name", "email", "emailVerified") values ($1, $1, $2, true)`,
        [id, `${id}@example.com`],
      );
      return id;
    },
    /** Deletes a user from Better Auth's `user` table, as account deletion does. */
    deleteUser: async (id: string) => {
      await pool.query(`delete from "user" where "id" = $1`, [id]);
    },
    close: async () => {
      await pool.end();
      await database.drop();
    },
  };
}

/**
 * One axis per meaning, so texts that share a meaning point the same way and texts that share
 * none are orthogonal. A text with no known meaning gets an axis of its own (the `nth` text
 * embedded), unrelated to every other text, so tests that set no meanings search by words alone.
 */
function fakeEmbedding(text: string, meanings: ReadonlyMap<string, string>, nth: number): number[] {
  const vector: number[] = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  const half = EMBEDDING_DIMENSIONS / 2;
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const known = words.flatMap((word) => meanings.get(word) ?? []);
  for (const meaning of known) vector[hash(meaning) % half]! += 1;
  if (known.length === 0) vector[half + (nth % half)] = 1;
  return vector;
}

/** FNV-1a: a stable hash, so a meaning lands on the same axis every run. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (const char of text) {
    value ^= char.codePointAt(0)!;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

export type ServiceFixture = Awaited<ReturnType<typeof createServiceFixture>>;
