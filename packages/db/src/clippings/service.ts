import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import type pg from "pg";

import {
  MAX_NOTE_LENGTH,
  parseWebUrl,
  type Clipping,
  type ClippingSource,
} from "@clippings/shared";

import { createDatabase } from "../database";
import { clippings } from "../schema";
import type { Clock, JobPublisher, PageFetcher, PageSummary, Summarizer } from "./ports";

export const systemClock: Clock = { now: () => new Date() };

export interface SaveClippingInput {
  url: string;
  note?: string;
  source: ClippingSource;
  clientId?: string;
}

export type SaveClippingResult = { status: "created" | "existing"; clipping: Clipping };

export interface ListClippingsInput {
  cursor?: string;
  limit?: number;
}

export interface ClippingsPage {
  items: Clipping[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

export interface ClippingsServiceDeps {
  pool: pg.Pool;
  jobs: JobPublisher;
  clock: Clock;
  fetcher: PageFetcher;
  summarizer: Summarizer;
}

export interface EnrichClippingOptions {
  /**
   * This delivery is the last one the queue will make. A failure then marks the clipping
   * `failed` instead of throwing, which would only ask for a retry that never comes.
   */
  lastAttempt?: boolean;
}

/** How an `enrichClipping` call ended. */
export type EnrichmentOutcome =
  /** The page was read and the clipping is ready. */
  | "ready"
  /** The clipping was not pending (already read, failed, or gone), so nothing was done. */
  | "skipped"
  /** Reading failed on the last attempt, so the clipping is now failed. */
  | "failed";

type ClippingRow = typeof clippings.$inferSelect;

const toClipping = (row: ClippingRow): Clipping => ({
  id: row.id,
  url: row.url,
  title: row.title,
  note: row.note,
  summary: row.summary,
  excerpt: row.excerpt,
  status: row.status,
  source: row.source,
  clientId: row.clientId,
  createdAt: row.createdAt.toISOString(),
});

/** How long a clipping can sit pending or failed before the sweep requests it again. */
const STUCK_AFTER_MS = 60 * 60 * 1000;
const SWEEP_BATCH_SIZE = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A page boundary: the clipping the previous page ended on. Opaque to callers. */
const encodeCursor = (row: ClippingRow) =>
  Buffer.from(JSON.stringify({ at: row.createdAt.toISOString(), id: row.id })).toString(
    "base64url",
  );

function decodeCursor(cursor: string): { at: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      at?: unknown;
      id?: unknown;
    };
    const at = new Date(String(parsed.at));
    if (!Number.isNaN(at.getTime()) && typeof parsed.id === "string" && UUID.test(parsed.id)) {
      return { at, id: parsed.id };
    }
  } catch {
    // fall through to the error below
  }
  throw new InvalidCursorError();
}

export class InvalidCursorError extends Error {
  constructor() {
    super("Not a page cursor");
    this.name = "InvalidCursorError";
  }
}

export class NoteTooLongError extends Error {
  constructor() {
    super(`A note can be at most ${MAX_NOTE_LENGTH} characters`);
    this.name = "NoteTooLongError";
  }
}

export class InvalidUrlError extends Error {
  constructor(url: string) {
    super(`Not a web address: ${url}`);
    this.name = "InvalidUrlError";
  }
}

/**
 * The rules about clippings. Every operation takes the acting user and scopes its queries by
 * them, so no caller can reach another user's rows.
 */
export function createClippingsService({
  pool,
  jobs,
  clock,
  fetcher,
  summarizer,
}: ClippingsServiceDeps) {
  const db = createDatabase(pool);

  async function saveClipping(
    userId: string,
    input: SaveClippingInput,
  ): Promise<SaveClippingResult> {
    const parsed = parseWebUrl(input.url);
    if (!parsed) throw new InvalidUrlError(input.url);
    const note = input.note ?? "";
    if (note.length > MAX_NOTE_LENGTH) throw new NoteTooLongError();

    const now = clock.now();
    const { url, normalized } = parsed;
    const [created] = await db
      .insert(clippings)
      .values({
        userId,
        url,
        urlNormalized: normalized,
        title: url,
        note,
        source: input.source,
        clientId: input.clientId ?? null,
        createdAt: now,
        updatedAt: now,
        statusChangedAt: now,
      })
      .onConflictDoNothing({ target: [clippings.userId, clippings.urlNormalized] })
      .returning();

    if (created) {
      // The save stands even if the queue is down: the daily sweep requests the job again.
      await jobs.requestEnrichment(created.id).catch((error: unknown) => {
        console.error(`Couldn't request enrichment of clipping ${created.id}`, error);
      });
      return { status: "created", clipping: toClipping(created) };
    }

    const [existing] = await db
      .select()
      .from(clippings)
      .where(and(eq(clippings.userId, userId), eq(clippings.urlNormalized, normalized)));
    return { status: "existing", clipping: toClipping(existing!) };
  }

  async function listClippings(
    userId: string,
    { cursor, limit = 20 }: ListClippingsInput,
  ): Promise<ClippingsPage> {
    const after = cursor ? decodeCursor(cursor) : null;
    // One extra row says whether another page follows without a second query.
    const rows = await db
      .select()
      .from(clippings)
      .where(
        and(
          eq(clippings.userId, userId),
          after
            ? or(
                lt(clippings.createdAt, after.at),
                and(eq(clippings.createdAt, after.at), lt(clippings.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(clippings.createdAt), desc(clippings.id))
      .limit(limit + 1);

    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(toClipping),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
  }

  /** Sets the note, or returns null when the user has no such clipping. */
  async function updateNote(
    userId: string,
    clippingId: string,
    note: string,
  ): Promise<Clipping | null> {
    if (note.length > MAX_NOTE_LENGTH) throw new NoteTooLongError();
    if (!UUID.test(clippingId)) return null;
    const [updated] = await db
      .update(clippings)
      .set({ note, updatedAt: clock.now() })
      .where(and(eq(clippings.id, clippingId), eq(clippings.userId, userId)))
      .returning();
    return updated ? toClipping(updated) : null;
  }

  /** One of the user's clippings, or null when they have no such clipping. */
  async function getClipping(userId: string, clippingId: string): Promise<Clipping | null> {
    if (!UUID.test(clippingId)) return null;
    const [row] = await db
      .select()
      .from(clippings)
      .where(and(eq(clippings.id, clippingId), eq(clippings.userId, userId)));
    return row ? toClipping(row) : null;
  }

  /**
   * Reads a pending clipping's page and fills in its title, summary and excerpt. Safe to repeat:
   * only a pending clipping is touched, so a redelivered job does nothing, and the user's note
   * is never written.
   */
  async function enrichClipping(
    clippingId: string,
    { lastAttempt = false }: EnrichClippingOptions = {},
  ): Promise<EnrichmentOutcome> {
    if (!UUID.test(clippingId)) return "skipped";
    const [row] = await db.select().from(clippings).where(eq(clippings.id, clippingId));
    if (!row || row.status !== "pending") return "skipped";

    let read: PageSummary;
    try {
      const page = await fetcher.fetchPage(row.url);
      read = await summarizer.summarize({ url: row.url, ...page });
    } catch (error) {
      if (!lastAttempt) throw error;
      const now = clock.now();
      await db
        .update(clippings)
        .set({ status: "failed", statusChangedAt: now, updatedAt: now })
        .where(and(eq(clippings.id, clippingId), eq(clippings.status, "pending")));
      return "failed";
    }
    const now = clock.now();
    const [updated] = await db
      .update(clippings)
      .set({
        title: read.title,
        summary: read.summary,
        excerpt: read.excerpt,
        status: "ready",
        statusChangedAt: now,
        updatedAt: now,
      })
      .where(and(eq(clippings.id, clippingId), eq(clippings.status, "pending")))
      .returning({ id: clippings.id });
    return updated ? "ready" : "skipped";
  }

  /**
   * Starts a failed clipping over: back to pending, and the job is requested again. Returns the
   * clipping as it stands (unchanged when it wasn't failed), or null when the user has no such
   * clipping.
   */
  async function retryEnrichment(userId: string, clippingId: string): Promise<Clipping | null> {
    if (!UUID.test(clippingId)) return null;
    const now = clock.now();
    const [restarted] = await db
      .update(clippings)
      .set({ status: "pending", statusChangedAt: now, updatedAt: now })
      .where(
        and(
          eq(clippings.id, clippingId),
          eq(clippings.userId, userId),
          eq(clippings.status, "failed"),
        ),
      )
      .returning();
    if (!restarted) return getClipping(userId, clippingId);

    try {
      await jobs.requestEnrichment(restarted.id);
    } catch (error) {
      // Don't leave it pending with no job behind it, and let the caller see the failure.
      await db
        .update(clippings)
        .set({ status: "failed" })
        .where(and(eq(clippings.id, restarted.id), eq(clippings.status, "pending")));
      throw error;
    }
    return toClipping(restarted);
  }

  /**
   * For the daily cron: requests enrichment again for clippings that have been pending or failed
   * for more than an hour, starting failed ones over. Returns the ids it requested. A batch is
   * capped, so a backlog drains over several days instead of one long run.
   */
  async function sweepStuck(): Promise<string[]> {
    const now = clock.now();
    const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS);
    const stuck = db
      .select({ id: clippings.id })
      .from(clippings)
      .where(
        and(
          inArray(clippings.status, ["pending", "failed"]),
          lt(clippings.statusChangedAt, stuckBefore),
        ),
      )
      .limit(SWEEP_BATCH_SIZE);
    const restarted = await db
      .update(clippings)
      .set({ status: "pending", statusChangedAt: now, updatedAt: now })
      .where(inArray(clippings.id, stuck))
      .returning({ id: clippings.id });

    const ids = restarted.map((row) => row.id);
    const results = await Promise.allSettled(ids.map((id) => jobs.requestEnrichment(id)));
    for (const result of results) {
      if (result.status === "rejected") console.error("Couldn't request enrichment", result.reason);
    }
    return ids;
  }

  return {
    saveClipping,
    listClippings,
    updateNote,
    getClipping,
    enrichClipping,
    retryEnrichment,
    sweepStuck,
  };
}

export type ClippingsService = ReturnType<typeof createClippingsService>;
