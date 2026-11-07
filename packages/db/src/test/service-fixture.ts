import { addMilliseconds, parseISO } from "date-fns";
import pg from "pg";

import { createChangesService } from "../changes/service.ts";
import {
  CapReachedError,
  type BudgetGate,
  type Clock,
  type Embedder,
  type EmbeddingPurpose,
  type FetchedPage,
  type JobPublisher,
  type PageFetcher,
  type PageSummary,
  type Summarizer,
} from "../clippings/ports.ts";
import { createClippingsService } from "../clippings/service.ts";
import { createConnectionsService } from "../connections/service.ts";
import { createLibrarianService } from "../librarian/service.ts";
import { createPool } from "../pool.ts";
import { EMBEDDING_DIMENSIONS } from "../schema.ts";
import { createSettingsService } from "../settings/service.ts";
import { createUsageService } from "../usage/service.ts";
import { createMigratedDatabase, type TempDatabase } from "./temp-database.ts";

/**
 * A migrated, throwaway database with the Clippings service on top and in-memory ports: a clock
 * the test moves by hand, a publisher that records what it was asked to enrich, and a fetcher and
 * summarizer that answer from `web`, which maps a URL to what reading it yields (its summary's
 * `suggestedTags` is what the model suggests), and an embedder
 * that knows what words mean only from `meanings`.
 */
export async function createServiceFixture() {
  const database: TempDatabase = await createMigratedDatabase();
  const pool: pg.Pool = createPool(database.url);

  let now = parseISO("2026-10-01T09:00:00.000Z");
  const clock: Clock = { now: () => now };
  const enrichmentRequests: string[] = [];
  const batchedEnrichmentRequests: { ids: string[]; spreadOverSeconds: number }[] = [];
  let publishing: "up" | "down" = "up";
  const jobs: JobPublisher = {
    requestEnrichment: async (clippingId) => {
      if (publishing === "down") throw new Error("the queue is unreachable");
      enrichmentRequests.push(clippingId);
    },
    requestEnrichments: async (clippingIds, { spreadOverSeconds }) => {
      if (publishing === "down") throw new Error("the queue is unreachable");
      batchedEnrichmentRequests.push({ ids: [...clippingIds], spreadOverSeconds });
    },
  };

  /**
   * What reading each URL yields: a page and what the summarizer makes of it, or a failure. A
   * failure may carry the `summary` the summarizer makes of a page the fetcher can't reach, for
   * a clipping saved with the browser's own text.
   */
  const web = new Map<
    string,
    { page: FetchedPage; summary: PageSummary } | { error: Error; summary?: PageSummary }
  >();
  /** What a link check finds at each URL: "alive" unless set otherwise. */
  const links = new Map<string, "alive" | "dead" | "unknown">();
  /** The URLs `checkLink` was asked about, in order. */
  const checkedLinks: string[] = [];
  /** Runs while a check of the URL is in flight, before it answers: what happens meanwhile. */
  const duringLinkCheck = new Map<string, () => Promise<void>>();
  /** The URLs `fetchPage` was asked for, in order. */
  const fetchedPages: string[] = [];
  const fetcher: PageFetcher = {
    fetchPage: async (url) => {
      fetchedPages.push(url);
      const entry = web.get(url);
      if (!entry) throw new Error(`Nothing at ${url}`);
      if ("error" in entry) throw entry.error;
      return entry.page;
    },
    checkLink: async (url) => {
      checkedLinks.push(url);
      await duringLinkCheck.get(url)?.();
      return links.get(url) ?? "alive";
    },
  };
  /** The `userTags` each summarize call got, in order: undefined when suggestions were off. */
  const summarizedWithTags: (readonly string[] | undefined)[] = [];
  /** The page (URL, title and text) each summarize call got, in order. */
  const summarizedPages: { url: string; title: string | null; text: string }[] = [];
  /** Whether the model gateway refuses calls, as it does for a user past their daily cap. */
  let capped = false;
  /** What the summarizer makes of a note, by its body; a body not in it gets a reading of its own. */
  const noteReadings = new Map<string, PageSummary>();
  /** The body of each note the summarizer was asked to read, in order. */
  const summarizedNotes: string[] = [];
  /** Runs while the summarizer reads the note with this body, before it answers. */
  const duringNoteReading = new Map<string, () => Promise<void>>();
  const summarizer: Summarizer = {
    summarize: async ({ kind, url, title, text, userTags }) => {
      if (capped) throw new CapReachedError();
      summarizedWithTags.push(userTags);
      if (kind === "note") {
        summarizedNotes.push(text);
        await duringNoteReading.get(text)?.();
        return (
          noteReadings.get(text) ?? {
            title: "A title the model wrote",
            summary: `About: ${text.slice(0, 40)}`,
            excerpt: text.slice(0, 40),
          }
        );
      }
      summarizedPages.push({ url: url!, title, text });
      const entry = web.get(url!);
      if (!entry?.summary) throw new Error(`Nothing to summarize at ${url}`);
      return entry.summary;
    },
  };

  /** Word → the meaning it carries. Words that share a meaning embed close together. */
  const meanings = new Map<string, string>();
  const embedded: { text: string; purpose: EmbeddingPurpose }[] = [];
  /** Who each embedding call was made for, in order. */
  const embeddedFor: { userId: string; jobKind: string }[] = [];
  /** The size of each `embedMany` call, in order. */
  const embeddedBatches: number[] = [];
  /** Runs while a batched embedding call carrying this text is in flight, before it answers. */
  const duringEmbedding = new Map<string, () => Promise<void>>();
  let embedding: "up" | "down" = "up";
  /** Whether only the embedder refuses (the summarizer still answers), and for whom. */
  let embeddingCapped = false;
  const cappedEmbeddingUsers = new Set<string>();
  const embedderRefuses = (userId: string) =>
    capped || embeddingCapped || cappedEmbeddingUsers.has(userId);
  const embedder: Embedder = {
    embed: async (text, purpose, owner) => {
      if (embedderRefuses(owner.userId)) throw new CapReachedError();
      if (embedding === "down") throw new Error("the embedder is unreachable");
      embeddedFor.push(owner);
      embedded.push({ text, purpose });
      return fakeEmbedding(text, meanings, embedded.length);
    },
    embedMany: async (texts, purpose, owner) => {
      if (embedderRefuses(owner.userId)) throw new CapReachedError();
      if (embedding === "down") throw new Error("the embedder is unreachable");
      for (const text of texts) await duringEmbedding.get(text)?.();
      embeddedBatches.push(texts.length);
      embeddedFor.push(owner);
      return texts.map((text) => {
        embedded.push({ text, purpose });
        return fakeEmbedding(text, meanings, embedded.length);
      });
    },
  };

  /** The users whose budget gate is shut, and what it was asked about. */
  const shutBudgets = new Set<string>();
  const budgetAsked: { userId: string; jobKind: string }[] = [];
  const budget: BudgetGate = {
    canSpend: async (userId, jobKind) => {
      budgetAsked.push({ userId, jobKind });
      return !shutBudgets.has(userId);
    },
  };

  const service = createClippingsService({
    pool,
    jobs,
    clock,
    fetcher,
    summarizer,
    embedder,
    budget,
  });

  return {
    /** The throwaway database's URL, for code that opens its own pool (Better Auth in web tests). */
    databaseUrl: database.url,
    service,
    /** The clock the services read, for a service the test builds itself. */
    clock,
    settings: createSettingsService({ pool, clock }),
    changes: createChangesService({ pool }),
    librarian: createLibrarianService({ pool, clock }),
    usage: createUsageService({ pool, clock }),
    connections: createConnectionsService({ pool, clock }),
    /** The fixture's pool, for tests that set up rows no service writes (Better Auth's). */
    pool,
    web,
    /** What a link check finds at each URL; a URL not in it is alive. */
    links,
    /** Every URL a link check was run on, in order. */
    checkedLinks,
    /** Something to do while a check of a URL is in flight, before it answers. */
    duringLinkCheck,
    enrichmentRequests,
    /** Every URL the fetcher was asked to read, in order. */
    fetchedPages,
    /** The page each summarize call got, in order. */
    summarizedPages,
    /** What the summarizer makes of a note, by its body. */
    noteReadings,
    /** The body of each note the summarizer read, in order. */
    summarizedNotes,
    /** Something to do while the summarizer reads the note with this body, before it answers. */
    duringNoteReading,
    /** Every `requestEnrichments` call: the ids in order and the window they were spread over. */
    batchedEnrichmentRequests,
    /**
     * The tag names the summarizer received per call, in order; undefined for a call made with
     * suggestions off. Set a page's `summary.suggestedTags` in `web` to change what it suggests.
     */
    summarizedWithTags,
    /** Makes the publisher throw (or work again), the way an unreachable queue does. */
    setPublishing: (state: "up" | "down") => {
      publishing = state;
    },
    meanings,
    /** Every text the embedder was asked for, in order. */
    embedded,
    /** Something to do while a batched embedding call carrying this text is in flight. */
    duringEmbedding,
    /** Who each embedding call was made for, in order. */
    embeddedFor,
    /** Makes only the embedder refuse (or work again), as a reached spend cap does. */
    setEmbeddingCapReached: (reached: boolean) => {
      embeddingCapped = reached;
    },
    /** Makes the embedder refuse this user's calls only. */
    capEmbeddingFor: (userId: string) => {
      cappedEmbeddingUsers.add(userId);
    },
    /**
     * Shuts (or opens) the budget gate for a user, as a spent cap does: `canSpend` says no, though
     * the summarizer and embedder, which stand for the gateway's own check, still answer.
     */
    setBudgetShut: (userId: string, shut: boolean) => {
      if (shut) shutBudgets.add(userId);
      else shutBudgets.delete(userId);
    },
    /** Every `canSpend` question the service asked, in order. */
    budgetAsked,
    /** Makes the summarizer and embedder refuse (or work again), as a reached spend cap does. */
    setCapReached: (reached: boolean) => {
      capped = reached;
    },
    /** How many texts each batched embedding call carried, in order. */
    embeddedBatches,
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
