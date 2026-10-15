import { and, desc, eq, lt, or } from "drizzle-orm";
import type pg from "pg";

import {
  MAX_NOTE_LENGTH,
  parseWebUrl,
  type Clipping,
  type ClippingSource,
} from "@clippings/shared";

import { createDatabase } from "../database";
import { clippings } from "../schema";

/** Time, injected so tests decide what "now" is. */
export interface Clock {
  now: () => Date;
}

/** Starts background enrichment of a clipping. */
export interface JobPublisher {
  requestEnrichment: (clippingId: string) => Promise<void>;
}

/** The publisher until enrichment lands: nothing reads the page yet. */
export const noopJobPublisher: JobPublisher = { requestEnrichment: async () => {} };

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
}

type ClippingRow = typeof clippings.$inferSelect;

const toClipping = (row: ClippingRow): Clipping => ({
  id: row.id,
  url: row.url,
  title: row.title,
  note: row.note,
  status: row.status,
  source: row.source,
  clientId: row.clientId,
  createdAt: row.createdAt.toISOString(),
});

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
export function createClippingsService({ pool, jobs, clock }: ClippingsServiceDeps) {
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
      })
      .onConflictDoNothing({ target: [clippings.userId, clippings.urlNormalized] })
      .returning();

    if (created) {
      await jobs.requestEnrichment(created.id);
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

  return { saveClipping, listClippings, updateNote };
}

export type ClippingsService = ReturnType<typeof createClippingsService>;
