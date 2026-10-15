import type pg from "pg";

import {
  MAX_NOTE_LENGTH,
  parseWebUrl,
  type Clipping,
  type ClippingSource,
  type ClippingStatus,
} from "@clippings/shared";

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

interface ClippingRow {
  id: string;
  user_id: string;
  url: string;
  title: string;
  note: string;
  status: ClippingStatus;
  source: ClippingSource;
  client_id: string | null;
  created_at: Date;
}

const toClipping = (row: ClippingRow): Clipping => ({
  id: row.id,
  url: row.url,
  title: row.title,
  note: row.note,
  status: row.status,
  source: row.source,
  clientId: row.client_id,
  createdAt: row.created_at.toISOString(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A page boundary: the clipping the previous page ended on. Opaque to callers. */
const encodeCursor = (row: ClippingRow) =>
  Buffer.from(JSON.stringify({ at: row.created_at.toISOString(), id: row.id })).toString(
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
    const inserted = await pool.query<ClippingRow>(
      `insert into clippings
         (user_id, url, url_normalized, title, note, source, client_id, created_at, updated_at)
       values ($1, $2, $3, $2, $4, $5, $6, $7, $7)
       on conflict (user_id, url_normalized) do nothing
       returning *`,
      [userId, url, normalized, note, input.source, input.clientId ?? null, now],
    );

    const row = inserted.rows[0];
    if (row) {
      await jobs.requestEnrichment(row.id);
      return { status: "created", clipping: toClipping(row) };
    }

    const existing = await pool.query<ClippingRow>(
      "select * from clippings where user_id = $1 and url_normalized = $2",
      [userId, normalized],
    );
    return { status: "existing", clipping: toClipping(existing.rows[0]!) };
  }

  async function listClippings(
    userId: string,
    { cursor, limit = 20 }: ListClippingsInput,
  ): Promise<ClippingsPage> {
    const after = cursor ? decodeCursor(cursor) : null;
    // One extra row says whether another page follows without a second query.
    const { rows } = await pool.query<ClippingRow>(
      `select * from clippings
       where user_id = $1
         and ($2::timestamptz is null or (created_at, id) < ($2::timestamptz, $3::uuid))
       order by created_at desc, id desc
       limit $4`,
      [userId, after?.at ?? null, after?.id ?? null, limit + 1],
    );

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
    const { rows } = await pool.query<ClippingRow>(
      `update clippings set note = $3, updated_at = $4
       where id = $2 and user_id = $1
       returning *`,
      [userId, clippingId, note, clock.now()],
    );
    return rows[0] ? toClipping(rows[0]) : null;
  }

  return { saveClipping, listClippings, updateNote };
}

export type ClippingsService = ReturnType<typeof createClippingsService>;
