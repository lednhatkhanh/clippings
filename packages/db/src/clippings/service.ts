import { constructNow, isValid, parseISO, subHours } from "date-fns";
import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  getColumns,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import type pg from "pg";

import {
  formatIsoUtc,
  MAX_NOTE_LENGTH,
  MAX_QUERY_LENGTH,
  parseWebUrl,
  SEARCH_RESULT_LIMIT,
  type Clipping,
  type ClippingSource,
  type SearchHit,
  type SearchSort,
  type TextSegment,
} from "@clippings/shared";

import { createDatabase } from "../database.ts";
import { clippings, EMBEDDING_DIMENSIONS } from "../schema.ts";
import type {
  Clock,
  Embedder,
  EmbeddingPurpose,
  JobPublisher,
  PageFetcher,
  PageSummary,
  Summarizer,
} from "./ports.ts";

export const systemClock: Clock = { now: () => constructNow(undefined) };

export interface SaveClippingInput {
  url: string;
  note?: string;
  source: ClippingSource;
  clientId?: string;
}

export type SaveClippingResult = { status: "created" | "existing"; clipping: Clipping };

/** What the user can change on a clipping. A field left out stays as it is. */
export interface UpdateClippingInput {
  note?: string;
}

export interface ListClippingsInput {
  cursor?: string;
  limit?: number;
  /** Only clippings saved from these; all of them when empty or left out. */
  sources?: readonly ClippingSource[];
}

export interface SearchClippingsInput {
  /** Words to find, in web-search syntax: `"a phrase"`, `-without`, `this or that`. */
  q: string;
  /** Only clippings saved from these; all of them when empty or left out. */
  sources?: readonly ClippingSource[];
  sort?: SearchSort;
  limit?: number;
}

export interface SearchResults {
  items: SearchHit[];
}

export interface ClippingsPage {
  items: Clipping[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

/** A clipping as it appears in the user's data export. */
export type ExportedClipping = Clipping & { tags: string[] };

/** Everything the user has saved, for them to keep. */
export interface ClippingsExport {
  exportedAt: string;
  clippings: ExportedClipping[];
}

export interface ClippingsServiceDeps {
  pool: pg.Pool;
  jobs: JobPublisher;
  clock: Clock;
  fetcher: PageFetcher;
  summarizer: Summarizer;
  embedder: Embedder;
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

// Every column but `search_tsv` and `embedding`, which only search reads.
const { searchTsv, embedding, ...clippingColumns } = getColumns(clippings);

type ClippingRow = Omit<typeof clippings.$inferSelect, "searchTsv" | "embedding">;

/** Not deleted: every read and edit the user makes sees only these. */
const live = isNull(clippings.deletedAt);

/** The columns every status change writes together. */
const statusChange = (status: ClippingRow["status"], at: Date) => ({
  status,
  statusChangedAt: at,
  updatedAt: at,
});

const toClipping = (row: ClippingRow): Clipping => ({
  id: row.id,
  url: row.url,
  urlNormalized: row.urlNormalized,
  title: row.title,
  note: row.note,
  summary: row.summary,
  excerpt: row.excerpt,
  status: row.status,
  source: row.source,
  clientId: row.clientId,
  createdAt: formatIsoUtc(row.createdAt),
});

const fromSources = (sources: readonly ClippingSource[] = []) =>
  sources.length > 0 ? inArray(clippings.source, [...sources]) : undefined;

/**
 * The query as Postgres reads it: web-search syntax, with the last word also matching as a
 * prefix, so results appear while it is still being typed. A last word that is an operator, a
 * negation or inside an open quote is left to web-search syntax.
 */
function keywordQuery(text: string): SQL {
  const words = text.split(/\s+/);
  const last = words.at(-1) ?? "";
  const inOpenQuote = (text.split('"').length - 1) % 2 === 1;
  if (!/^[\p{L}\p{N}]+$/u.test(last) || last.toLowerCase() === "or" || inOpenQuote) {
    return sql`websearch_to_tsquery('simple', ${text})`;
  }
  const prefix = sql`to_tsquery('simple', ${`${last}:*`})`;
  const head = words.slice(0, -1).join(" ");
  return head ? sql`(websearch_to_tsquery('simple', ${head}) && ${prefix})` : prefix;
}

/**
 * A title close to every word of the query, a typo or so apart (`<%`, word similarity of at
 * least 0.6). Undefined for a query with a phrase or an excluded word, whose meaning plain words
 * can't carry, and for one with no words.
 */
function typoInTitle(text: string): SQL | undefined {
  if (text.includes('"') || text.split(/\s+/).some((word) => word.startsWith("-")))
    return undefined;
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  return and(...words.map((word) => sql`${word} <% ${clippings.title}`));
}

// `ts_headline` marks each matched term with these; neither occurs in text people write.
const MARK_START = "\u0001";
const MARK_END = "\u0002";
const MARKS = `StartSel=${MARK_START}, StopSel=${MARK_END}`;
const TITLE_HEADLINE = `${MARKS}, HighlightAll=true`;
const SNIPPET_HEADLINE = `${MARKS}, MaxWords=24, MinWords=12`;

/** The text without the marker characters, so a page that contains them can't fake a match. */
const unmarked = (text: SQLWrapper) => sql`translate(${text}, ${MARK_START + MARK_END}, '')`;

/** Splits a headline from `ts_headline` into runs of text, marking the matched terms. */
function toSegments(headline: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const push = (text: string | undefined, match: boolean) => {
    if (text) segments.push({ text, match });
  };
  headline.split(MARK_START).forEach((chunk, index) => {
    if (index === 0) return push(chunk, false);
    const [marked, rest] = chunk.split(MARK_END);
    push(marked, true);
    push(rest, false);
  });
  return segments;
}

/**
 * Reciprocal rank fusion's k: a result's score is the sum of 1 / (k + its rank) over the
 * rankings it appears in. 60 is the value from the original paper, and it keeps one ranking's top
 * result from drowning out a result that both rankings place well.
 */
const RRF_K = 60;
/** Most clippings the meaning half of search contributes, nearest first. */
const SEMANTIC_CANDIDATES = 50;
/**
 * Farthest cosine distance (1 − similarity) at which a clipping still counts as close in meaning:
 * past it, the nearest neighbours of a query are only the least unrelated. A first guess for
 * voyage-4 (ADR 0001), to tune against real searches.
 */
const MAX_SEMANTIC_DISTANCE = 0.6;
/** Most related clippings the detail page shows. */
const RELATED_LIMIT = 5;
// One call each, in turn: 50 fit the sweep route's 60 s with room to spare.
const EMBED_BATCH_SIZE = 50;

/** Has an embedding within `MAX_SEMANTIC_DISTANCE` of the vector `distance` measures from. */
const closeInMeaning = (distance: SQL) =>
  and(isNotNull(embedding), sql`${distance} < ${MAX_SEMANTIC_DISTANCE}`);

/** What enrichment embeds: what the page is, not the user's note, which they can edit at will. */
const documentText = ({
  title,
  summary,
  excerpt,
}: Pick<ClippingRow, "title" | "summary" | "excerpt">) =>
  [title, summary, excerpt].filter(Boolean).join("\n\n");

/** How long a clipping can sit pending or failed before the sweep requests it again. */
const STUCK_AFTER_HOURS = 1;
const SWEEP_BATCH_SIZE = 100;
/**
 * How long a deleted clipping is kept before the purge removes it for good: far past the Undo
 * toast's 8 seconds, so a purge never races an Undo.
 */
const PURGE_AFTER_HOURS = 24;
const PURGE_BATCH_SIZE = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A page boundary: the clipping the previous page ended on. Opaque to callers. */
const encodeCursor = (row: ClippingRow) =>
  Buffer.from(JSON.stringify({ at: formatIsoUtc(row.createdAt), id: row.id })).toString(
    "base64url",
  );

function decodeCursor(cursor: string): { at: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      at?: unknown;
      id?: unknown;
    };
    const at = parseISO(String(parsed.at));
    if (isValid(at) && typeof parsed.id === "string" && UUID.test(parsed.id)) {
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
 * The rules about clippings. Every operation a user triggers takes the acting user and scopes its
 * queries by them, so no caller can reach another user's rows. `enrichClipping`, `sweepStuck`,
 * `embedMissing` and `purgeDeleted` are the exceptions: they are system jobs, reached only through the signed QStash
 * handler and the cron secret, and they act across users.
 */
export function createClippingsService({
  pool,
  jobs,
  clock,
  fetcher,
  summarizer,
  embedder,
}: ClippingsServiceDeps) {
  const db = createDatabase(pool);

  /** The embedder's vector, checked to fit the column, so a wrong model fails here and not in SQL. */
  async function embed(text: string, purpose: EmbeddingPurpose): Promise<number[]> {
    const vector = await embedder.embed(text, purpose);
    if (vector.length !== EMBEDDING_DIMENSIONS || !vector.every(Number.isFinite)) {
      throw new Error(`Expected ${EMBEDDING_DIMENSIONS} numbers, got ${vector.length}`);
    }
    return vector;
  }

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
    const fresh = {
      url,
      title: url,
      note,
      summary: null,
      excerpt: null,
      source: input.source,
      clientId: input.clientId ?? null,
      deletedAt: null,
      createdAt: now,
      ...statusChange("pending", now),
    };
    const [created] = await db
      .insert(clippings)
      .values({ userId, urlNormalized: normalized, ...fresh })
      // A deleted clipping of the same page still holds its row: saving again starts it over.
      .onConflictDoUpdate({
        target: [clippings.userId, clippings.urlNormalized],
        set: fresh,
        setWhere: isNotNull(clippings.deletedAt),
      })
      .returning(clippingColumns);

    if (created) {
      // The save stands even if the queue is down: the daily sweep requests the job again.
      await jobs.requestEnrichment(created.id).catch((error: unknown) => {
        console.error(`Couldn't request enrichment of clipping ${created.id}`, error);
      });
      return { status: "created", clipping: toClipping(created) };
    }

    const [existing] = await db
      .select(clippingColumns)
      .from(clippings)
      .where(and(eq(clippings.userId, userId), eq(clippings.urlNormalized, normalized)));
    return { status: "existing", clipping: toClipping(existing!) };
  }

  async function listClippings(
    userId: string,
    { cursor, limit = 20, sources }: ListClippingsInput,
  ): Promise<ClippingsPage> {
    const after = cursor ? decodeCursor(cursor) : null;
    // One extra row says whether another page follows without a second query.
    const rows = await db
      .select(clippingColumns)
      .from(clippings)
      .where(
        and(
          eq(clippings.userId, userId),
          live,
          fromSources(sources),
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

  /**
   * The user's clippings that match `q` by its words or by its meaning, best match first or newest
   * first. Words rank title over note over excerpt, and a title one typo away from the query
   * matches too, after every exact match. Words match as written, in any language: nothing is
   * stemmed. Meaning ranks by how close the clipping's embedding is to the query's. The two
   * rankings are merged by reciprocal rank fusion, so a clipping that matches both comes first.
   * When the query can't be embedded, search falls back to words alone.
   */
  async function searchClippings(
    userId: string,
    { q, sources, sort = "relevance", limit = SEARCH_RESULT_LIMIT }: SearchClippingsInput,
  ): Promise<SearchResults> {
    const text = q.trim().slice(0, MAX_QUERY_LENGTH).trim();
    if (!text) return { items: [] };

    const queryVector = await embed(text, "query").catch((error: unknown) => {
      console.error("Couldn't embed the search query; searching by words alone", error);
      return null;
    });

    const query = keywordQuery(text);
    const scope = and(eq(clippings.userId, userId), live, fromSources(sources));

    // Every clipping that matches the words, ranked.
    const byWords = db.$with("by_words").as(
      db
        .select({
          id: clippings.id,
          rank: sql<number>`row_number() over (order by ts_rank_cd(${searchTsv}, ${query}) desc, word_similarity(${text}, ${clippings.title}) desc, ${clippings.createdAt} desc, ${clippings.id} desc)`.as(
            "words_rank",
          ),
        })
        .from(clippings)
        .where(and(scope, or(sql`${searchTsv} @@ ${query}`, typoInTitle(text)))),
    );

    // The clippings nearest the query in meaning, close enough to count, ranked.
    const distance = queryVector ? cosineDistance(embedding, queryVector) : sql`null::float8`;
    const byMeaning = db.$with("by_meaning").as(
      db
        .select({
          id: clippings.id,
          rank: sql<number>`row_number() over (order by ${distance}, ${clippings.createdAt} desc, ${clippings.id} desc)`.as(
            "meaning_rank",
          ),
        })
        .from(clippings)
        .where(queryVector ? and(scope, closeInMeaning(distance)) : sql`false`)
        .orderBy(distance, desc(clippings.createdAt), desc(clippings.id))
        .limit(SEMANTIC_CANDIDATES),
    );

    const fused = sql<number>`coalesce(1.0 / (${RRF_K} + ${byWords.rank}), 0) + coalesce(1.0 / (${RRF_K} + ${byMeaning.rank}), 0)`;
    const matches = (column: SQLWrapper) => sql`to_tsvector('simple', ${column}) @@ ${query}`;
    const excerpt = sql`coalesce(${clippings.excerpt}, '')`;
    const rows = await db
      .with(byWords, byMeaning)
      .select({
        ...clippingColumns,
        titleHeadline: sql<string>`ts_headline('simple', ${unmarked(clippings.title)}, ${query}, ${TITLE_HEADLINE})`,
        snippetHeadline: sql<string | null>`case
          when ${matches(clippings.note)}
            then ts_headline('simple', ${unmarked(clippings.note)}, ${query}, ${SNIPPET_HEADLINE})
          when ${matches(excerpt)}
            then ts_headline('simple', ${unmarked(excerpt)}, ${query}, ${SNIPPET_HEADLINE})
        end`,
      })
      .from(clippings)
      .leftJoin(byWords, eq(byWords.id, clippings.id))
      .leftJoin(byMeaning, eq(byMeaning.id, clippings.id))
      .where(and(eq(clippings.userId, userId), or(isNotNull(byWords.id), isNotNull(byMeaning.id))))
      .orderBy(
        // On a tie, a match on the words wins: it is the one the user can see.
        ...(sort === "relevance" ? [desc(fused), sql`${byWords.rank} asc nulls last`] : []),
        desc(clippings.createdAt),
        desc(clippings.id),
      )
      .limit(limit);

    return {
      items: rows.map(({ titleHeadline, snippetHeadline, ...row }) => ({
        clipping: toClipping(row),
        highlights: {
          title: toSegments(titleHeadline),
          snippet: snippetHeadline === null ? null : toSegments(snippetHeadline),
        },
      })),
    };
  }

  /**
   * The user's other clippings nearest in meaning to this one, nearest first, by exact cosine
   * distance (no ANN index, ADR 0001). Empty when the user has no such clipping or it has no
   * embedding yet.
   */
  async function relatedClippings(userId: string, clippingId: string): Promise<Clipping[]> {
    if (!UUID.test(clippingId)) return [];
    const target = db
      .select({ embedding })
      .from(clippings)
      .where(and(eq(clippings.id, clippingId), eq(clippings.userId, userId), live));
    const distance = cosineDistance(embedding, target);
    const rows = await db
      .select(clippingColumns)
      .from(clippings)
      .where(
        and(
          eq(clippings.userId, userId),
          live,
          sql`${clippings.id} <> ${clippingId}`,
          closeInMeaning(distance),
        ),
      )
      .orderBy(asc(distance), desc(clippings.createdAt), desc(clippings.id))
      .limit(RELATED_LIMIT);
    return rows.map(toClipping);
  }

  /**
   * All of the user's live clippings with their notes, newest first and unpaged, stamped with the
   * time of the export.
   */
  async function exportClippings(userId: string): Promise<ClippingsExport> {
    const exportedAt = formatIsoUtc(clock.now());
    const rows = await db
      .select(clippingColumns)
      .from(clippings)
      .where(and(eq(clippings.userId, userId), live))
      .orderBy(desc(clippings.createdAt), desc(clippings.id));
    return {
      exportedAt,
      // Tags fill in once the tags table lands (#11).
      clippings: rows.map((row) => ({ ...toClipping(row), tags: [] })),
    };
  }

  /**
   * Changes what the user wrote on their clipping. Returns it as it now stands, or null when the
   * user has no such clipping.
   */
  async function updateClipping(
    userId: string,
    clippingId: string,
    { note }: UpdateClippingInput,
  ): Promise<Clipping | null> {
    if (note !== undefined && note.length > MAX_NOTE_LENGTH) throw new NoteTooLongError();
    if (!UUID.test(clippingId)) return null;
    const [updated] = await db
      .update(clippings)
      .set({ ...(note === undefined ? {} : { note }), updatedAt: clock.now() })
      .where(and(eq(clippings.id, clippingId), eq(clippings.userId, userId), live))
      .returning(clippingColumns);
    return updated ? toClipping(updated) : null;
  }

  /** One of the user's clippings, or null when they have no such clipping. */
  async function getClipping(userId: string, clippingId: string): Promise<Clipping | null> {
    if (!UUID.test(clippingId)) return null;
    const [row] = await db
      .select(clippingColumns)
      .from(clippings)
      .where(and(eq(clippings.id, clippingId), eq(clippings.userId, userId), live));
    return row ? toClipping(row) : null;
  }

  /**
   * Hides the clipping from every read until `restoreClipping` brings it back, so a delete can be
   * undone. Returns false when the user has no such clipping, or it is already deleted.
   */
  async function deleteClipping(userId: string, clippingId: string): Promise<boolean> {
    if (!UUID.test(clippingId)) return false;
    const now = clock.now();
    const deleted = await db
      .update(clippings)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(clippings.id, clippingId), eq(clippings.userId, userId), live))
      .returning({ id: clippings.id });
    return deleted.length > 0;
  }

  /** Undoes `deleteClipping`. Returns false when the user has no such deleted clipping. */
  async function restoreClipping(userId: string, clippingId: string): Promise<boolean> {
    if (!UUID.test(clippingId)) return false;
    const restored = await db
      .update(clippings)
      .set({ deletedAt: null, updatedAt: clock.now() })
      .where(
        and(
          eq(clippings.id, clippingId),
          eq(clippings.userId, userId),
          isNotNull(clippings.deletedAt),
        ),
      )
      .returning({ id: clippings.id });
    return restored.length > 0;
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
    const [row] = await db
      .select(clippingColumns)
      .from(clippings)
      .where(eq(clippings.id, clippingId));
    if (!row || row.status !== "pending") return "skipped";

    let read: PageSummary;
    let meaning: number[] | null = null;
    try {
      const page = await fetcher.fetchPage(row.url);
      read = await summarizer.summarize({ url: row.url, ...page });
      // The reading stands without an embedding: search finds the clipping by its words, and the
      // daily sweep embeds it later. A retry would only read the page and call Haiku again.
      meaning = await embed(documentText(read), "document").catch((error: unknown) => {
        console.error(`Couldn't embed clipping ${clippingId}; saving it without`, error);
        return null;
      });
    } catch (error) {
      if (!lastAttempt) throw error;
      const now = clock.now();
      await db
        .update(clippings)
        .set(statusChange("failed", now))
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
        embedding: meaning,
        ...statusChange("ready", now),
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
      .set(statusChange("pending", now))
      .where(
        and(
          eq(clippings.id, clippingId),
          eq(clippings.userId, userId),
          eq(clippings.status, "failed"),
          live,
        ),
      )
      .returning(clippingColumns);
    if (!restarted) return getClipping(userId, clippingId);

    try {
      await jobs.requestEnrichment(restarted.id);
    } catch (error) {
      // Don't leave it pending with no job behind it, and let the caller see the failure. The
      // restart above stamped the status time, so the sweep counts from there.
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
    const stuckBefore = subHours(now, STUCK_AFTER_HOURS);
    const stuck = db
      .select({ id: clippings.id })
      .from(clippings)
      .where(
        and(
          inArray(clippings.status, ["pending", "failed"]),
          lt(clippings.statusChangedAt, stuckBefore),
          live,
        ),
      )
      .limit(SWEEP_BATCH_SIZE);
    const restarted = await db
      .update(clippings)
      .set(statusChange("pending", now))
      .where(inArray(clippings.id, stuck))
      .returning({ id: clippings.id });

    const ids = restarted.map((row) => row.id);
    const results = await Promise.allSettled(ids.map((id) => jobs.requestEnrichment(id)));
    for (const result of results) {
      if (result.status === "rejected") console.error("Couldn't request enrichment", result.reason);
    }
    return ids;
  }

  /**
   * For the daily cron: embeds ready clippings that have no embedding (saved before search by
   * meaning, or when the embedder was down), and returns how many. A batch is capped like the
   * sweep's, and stops at the first failure, which is most likely the provider being down.
   */
  async function embedMissing(): Promise<number> {
    const missing = await db
      .select(clippingColumns)
      .from(clippings)
      .where(and(eq(clippings.status, "ready"), isNull(embedding), live))
      .orderBy(desc(clippings.createdAt))
      .limit(EMBED_BATCH_SIZE);
    let count = 0;
    for (const row of missing) {
      let vector: number[];
      try {
        vector = await embed(documentText(row), "document");
      } catch (error) {
        console.error(`Couldn't embed clipping ${row.id}; stopping for today`, error);
        break;
      }
      // Only while still missing: enrichment may have written one in the meantime.
      const [updated] = await db
        .update(clippings)
        .set({ embedding: vector })
        .where(and(eq(clippings.id, row.id), isNull(embedding)))
        .returning({ id: clippings.id });
      if (updated) count += 1;
    }
    return count;
  }

  /**
   * For the daily cron: removes for good the clippings deleted more than a day ago, and returns how
   * many. A batch is capped like the sweep's, so a backlog drains over several days.
   */
  async function purgeDeleted(): Promise<number> {
    const deletedBefore = subHours(clock.now(), PURGE_AFTER_HOURS);
    const expired = and(isNotNull(clippings.deletedAt), lt(clippings.deletedAt, deletedBefore));
    const batch = db
      .select({ id: clippings.id })
      .from(clippings)
      .where(expired)
      .limit(PURGE_BATCH_SIZE);
    // `expired` again on the delete itself: a save of the same URL may revive a row in between.
    const purged = await db
      .delete(clippings)
      .where(and(inArray(clippings.id, batch), expired))
      .returning({ id: clippings.id });
    return purged.length;
  }

  return {
    saveClipping,
    listClippings,
    searchClippings,
    relatedClippings,
    exportClippings,
    updateClipping,
    getClipping,
    deleteClipping,
    restoreClipping,
    enrichClipping,
    retryEnrichment,
    sweepStuck,
    embedMissing,
    purgeDeleted,
  };
}

export type ClippingsService = ReturnType<typeof createClippingsService>;
